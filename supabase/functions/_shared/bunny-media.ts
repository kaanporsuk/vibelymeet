/**
 * Shared Bunny media provider helpers.
 *
 * Centralises all Bunny Stream and Bunny Storage delete operations so that
 * no Edge Function scatters raw `fetch(DELETE …)` calls.  Every delete is
 * idempotent: a 404 from Bunny (asset already gone) is treated as success.
 *
 * Usage:
 *   import { deleteBunnyStreamVideo, deleteBunnyStorageFile } from "../_shared/bunny-media.ts";
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BunnyDeleteResult {
  success: boolean;
  /** HTTP status from Bunny, null if network error or skipped */
  httpStatus: number | null;
  /** true when the asset was already gone (404/410) — still counts as success */
  alreadyGone: boolean;
  /** Human-readable detail for logging */
  detail: string;
  /** Raw error message if success=false */
  error?: string;
}

// ─── Env helpers ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`[bunny-media] missing required env: ${name}`);
  return v;
}

function optionalEnv(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

/**
 * Build a Bunny CDN URL for a Bunny Storage object path. Supports pull-zone
 * setups where the storage zone is exposed under an extra CDN path prefix.
 */
export function bunnyCdnUrl(storagePath: string): string {
  const host = requireEnv("BUNNY_CDN_HOSTNAME")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+|\/+$/g, "");
  const prefix = optionalEnv("BUNNY_CDN_PATH_PREFIX").replace(/^\/+|\/+$/g, "");
  const normalizedPath = storagePath.trim().replace(/^\/+/, "");

  if (!host) throw new Error("[bunny-media] missing required env: BUNNY_CDN_HOSTNAME");
  if (!normalizedPath || normalizedPath.includes("..")) {
    throw new Error("[bunny-media] rejected invalid CDN storage path");
  }

  const pathPart = prefix ? `${prefix}/${normalizedPath}` : normalizedPath;
  return `https://${host}/${pathPart}`;
}

// ─── Bunny Stream (vibe videos) ─────────────────────────────────────────────

/**
 * Delete a video from Bunny Stream by its GUID.
 *
 * Endpoint: DELETE https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}
 *
 * Idempotent: 404 → success (already deleted).
 */
export async function deleteBunnyStreamVideo(videoId: string): Promise<BunnyDeleteResult> {
  const libraryId = requireEnv("BUNNY_STREAM_LIBRARY_ID");
  const apiKey = requireEnv("BUNNY_STREAM_API_KEY");

  const url = `https://video.bunnycdn.com/library/${libraryId}/videos/${encodeURIComponent(videoId)}`;

  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "AccessKey": apiKey },
    });

    const alreadyGone = res.status === 404 || res.status === 410;

    if (res.ok || alreadyGone) {
      return {
        success: true,
        httpStatus: res.status,
        alreadyGone,
        detail: alreadyGone
          ? `Bunny Stream video ${videoId} already deleted (${res.status})`
          : `Bunny Stream video ${videoId} deleted (${res.status})`,
      };
    }

    const body = await res.text().catch(() => "");
    return {
      success: false,
      httpStatus: res.status,
      alreadyGone: false,
      detail: `Bunny Stream DELETE failed for ${videoId}: ${res.status}`,
      error: body.slice(0, 500),
    };
  } catch (err) {
    return {
      success: false,
      httpStatus: null,
      alreadyGone: false,
      detail: `Bunny Stream network error for ${videoId}`,
      error: String(err).slice(0, 500),
    };
  }
}

// ─── Bunny Storage (photos, voice, chat-videos, event covers) ───────────────

/**
 * Delete a file from Bunny Storage by its path within the storage zone.
 *
 * Endpoint: DELETE https://storage.bunnycdn.com/{storageZone}/{path}
 *
 * Idempotent: 404 → success (already deleted).
 */
export async function deleteBunnyStorageFile(storagePath: string): Promise<BunnyDeleteResult> {
  const storageZone = requireEnv("BUNNY_STORAGE_ZONE");
  const apiKey = requireEnv("BUNNY_STORAGE_API_KEY");

  // Prevent path traversal
  if (storagePath.includes("..")) {
    return {
      success: false,
      httpStatus: null,
      alreadyGone: false,
      detail: `Rejected path with traversal: ${storagePath}`,
      error: "path_traversal_rejected",
    };
  }

  const url = `https://storage.bunnycdn.com/${storageZone}/${storagePath}`;

  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "AccessKey": apiKey },
    });

    const alreadyGone = res.status === 404 || res.status === 410;

    if (res.ok || alreadyGone) {
      return {
        success: true,
        httpStatus: res.status,
        alreadyGone,
        detail: alreadyGone
          ? `Bunny Storage file ${storagePath} already deleted (${res.status})`
          : `Bunny Storage file ${storagePath} deleted (${res.status})`,
      };
    }

    const body = await res.text().catch(() => "");
    return {
      success: false,
      httpStatus: res.status,
      alreadyGone: false,
      detail: `Bunny Storage DELETE failed for ${storagePath}: ${res.status}`,
      error: body.slice(0, 500),
    };
  } catch (err) {
    return {
      success: false,
      httpStatus: null,
      alreadyGone: false,
      detail: `Bunny Storage network error for ${storagePath}`,
      error: String(err).slice(0, 500),
    };
  }
}

// ─── Supabase Storage (legacy paths, future-proofing) ───────────────────────

/**
 * Delete a file from Supabase Storage by bucket and path.
 *
 * Uses the service-role admin client.  Idempotent: missing file → success.
 */
export async function deleteSupabaseStorageFile(
  bucket: string,
  filePath: string,
): Promise<BunnyDeleteResult> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (filePath.includes("..")) {
    return {
      success: false,
      httpStatus: null,
      alreadyGone: false,
      detail: `Rejected Supabase path with traversal: ${filePath}`,
      error: "path_traversal_rejected",
    };
  }

  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${filePath}`;

  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
    });

    const alreadyGone = res.status === 404 || res.status === 400;

    if (res.ok || alreadyGone) {
      return {
        success: true,
        httpStatus: res.status,
        alreadyGone,
        detail: alreadyGone
          ? `Supabase Storage ${bucket}/${filePath} already gone (${res.status})`
          : `Supabase Storage ${bucket}/${filePath} deleted (${res.status})`,
      };
    }

    const body = await res.text().catch(() => "");
    return {
      success: false,
      httpStatus: res.status,
      alreadyGone: false,
      detail: `Supabase Storage DELETE failed for ${bucket}/${filePath}: ${res.status}`,
      error: body.slice(0, 500),
    };
  } catch (err) {
    return {
      success: false,
      httpStatus: null,
      alreadyGone: false,
      detail: `Supabase Storage network error for ${bucket}/${filePath}`,
      error: String(err).slice(0, 500),
    };
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Dispatch a delete to the correct provider based on the provider string.
 * This is what the delete-job worker calls.
 */
export async function deleteMediaAsset(
  provider: string,
  providerObjectId: string | null,
  providerPath: string | null,
): Promise<BunnyDeleteResult> {
  switch (provider) {
    case "bunny_stream": {
      if (!providerObjectId) {
        return {
          success: false,
          httpStatus: null,
          alreadyGone: false,
          detail: "bunny_stream delete requires provider_object_id",
          error: "missing_provider_object_id",
        };
      }
      return deleteBunnyStreamVideo(providerObjectId);
    }
    case "bunny_storage": {
      if (!providerPath) {
        return {
          success: false,
          httpStatus: null,
          alreadyGone: false,
          detail: "bunny_storage delete requires provider_path",
          error: "missing_provider_path",
        };
      }
      return deleteBunnyStorageFile(providerPath);
    }
    case "supabase_storage": {
      if (!providerPath) {
        return {
          success: false,
          httpStatus: null,
          alreadyGone: false,
          detail: "supabase_storage delete requires provider_path",
          error: "missing_provider_path",
        };
      }
      // Path format: "bucket/rest/of/path"
      const slashIdx = providerPath.indexOf("/");
      if (slashIdx < 1) {
        return {
          success: false,
          httpStatus: null,
          alreadyGone: false,
          detail: `Invalid supabase_storage path format: ${providerPath}`,
          error: "invalid_path_format",
        };
      }
      const bucket = providerPath.slice(0, slashIdx);
      const filePath = providerPath.slice(slashIdx + 1);
      return deleteSupabaseStorageFile(bucket, filePath);
    }
    default:
      return {
        success: false,
        httpStatus: null,
        alreadyGone: false,
        detail: `Unknown provider: ${provider}`,
        error: "unknown_provider",
      };
  }
}
