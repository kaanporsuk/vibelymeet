import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  adminJsonResponse,
  authenticateAdminRequest,
  sanitizeErrorMessage,
  type AdminSupabaseClient,
} from "../_shared/adminAuth.ts";
import {
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

/**
 * Path resolution must stay aligned with `src/lib/proofSelfieUrl.ts` (resolveProofSelfieObjectPathForSigning).
 */
const PROOF_SELFIES_BUCKET = "proof-selfies";
const BUCKET_PREFIX = `${PROOF_SELFIES_BUCKET}/`;
const SIGNED_SELFIE_TTL_SECONDS = 3600;
const DIRECT_SELFIE_REVALIDATION_SECONDS = 900;
const TRUSTED_DIRECT_SELFIE_ORIGIN_ENVS = [
  "ADMIN_PROOF_SELFIE_TRUSTED_ORIGINS",
  "BUNNY_CDN_HOSTNAME",
  "BUNNY_STREAM_CDN_HOSTNAME",
  "BUNNY_CHAT_STREAM_CDN_HOSTNAME",
  "BUNNY_ARCHIVE_CDN_HOSTNAME",
] as const;
const UUID_FOLDER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProofSelfieStoredShape =
  | "empty"
  | "raw_object_key"
  | "bucket_prefixed_key"
  | "supabase_storage_proof_selfies"
  | "supabase_storage_public_missing_bucket"
  | "supabase_storage_other_bucket"
  | "absolute_non_supabase"
  | "unusable";

function isAbsoluteMediaUrl(raw: string): boolean {
  const p = raw.trim();
  return (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  );
}

function trustedOriginFromValue(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.includes("*")) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function trustedDirectSelfieOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const envName of TRUSTED_DIRECT_SELFIE_ORIGIN_ENVS) {
    const raw = Deno.env.get(envName)?.trim();
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const origin = trustedOriginFromValue(part);
      if (origin) origins.add(origin);
    }
  }
  return origins;
}

function isTrustedDirectSelfieUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return false;
    return trustedDirectSelfieOrigins().has(url.origin.toLowerCase());
  } catch {
    return false;
  }
}

function looksLikeSupabaseStorageUrl(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname;
    return h.includes("supabase.co") || h.includes("supabase.in");
  } catch {
    return false;
  }
}

function decodePathSeg(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function objectPathFromSupabaseStoragePathname(pathname: string): {
  objectPath: string | null;
  shape: ProofSelfieStoredShape;
} {
  const p = pathname.replace(/\/+$/, "");

  const explicit = p.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/proof-selfies\/(.+)$/i,
  );
  if (explicit) {
    const inner = decodePathSeg(explicit[1]).replace(/^\/+/, "");
    return inner
      ? { objectPath: inner, shape: "supabase_storage_proof_selfies" }
      : { objectPath: null, shape: "unusable" };
  }

  const generic = p.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i,
  );
  if (generic) {
    const first = generic[1];
    const rest = decodePathSeg(generic[2]).replace(/^\/+/, "");
    if (first.toLowerCase() === PROOF_SELFIES_BUCKET) {
      return rest
        ? { objectPath: rest, shape: "supabase_storage_proof_selfies" }
        : { objectPath: null, shape: "unusable" };
    }
    if (UUID_FOLDER.test(first) && rest) {
      return {
        objectPath: `${first}/${rest}`,
        shape: "supabase_storage_public_missing_bucket",
      };
    }
    return { objectPath: null, shape: "supabase_storage_other_bucket" };
  }

  return { objectPath: null, shape: "unusable" };
}

function resolveProofSelfieObjectPathForSigning(raw: string | null | undefined): {
  objectPath: string | null;
  shape: ProofSelfieStoredShape;
} {
  if (raw == null || raw.trim() === "") return { objectPath: null, shape: "empty" };
  const t = raw.trim();

  if (isAbsoluteMediaUrl(t)) {
    if (!looksLikeSupabaseStorageUrl(t)) {
      return { objectPath: null, shape: "absolute_non_supabase" };
    }
    try {
      const { pathname } = new URL(t);
      return objectPathFromSupabaseStoragePathname(pathname);
    } catch {
      return { objectPath: null, shape: "unusable" };
    }
  }

  let p = t.replace(/^\/+/, "");
  const hadBucketPrefix = p.startsWith(BUCKET_PREFIX);
  if (hadBucketPrefix) p = p.slice(BUCKET_PREFIX.length);
  if (!p) return { objectPath: null, shape: "unusable" };
  return {
    objectPath: p,
    shape: hadBucketPrefix ? "bucket_prefixed_key" : "raw_object_key",
  };
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return adminJsonResponse(req, body, status);
}

type SignOutcome =
  | { kind: "signed"; signedUrl: string; expiresAt: string }
  | { kind: "direct"; url: string; expiresAt: string }
  | { kind: "fail"; message: string; shape: ProofSelfieStoredShape };

/** Best-effort size from Storage list metadata (service role). Undefined if unknown. */
async function proofSelfieObjectSizeBytesFromList(
  service: AdminSupabaseClient,
  objectPath: string,
): Promise<number | undefined> {
  const i = objectPath.indexOf("/");
  if (i <= 0) return undefined;
  const folder = objectPath.slice(0, i);
  const name = objectPath.slice(i + 1);
  if (!name) return undefined;
  const { data: files, error } = await service.storage
    .from(PROOF_SELFIES_BUCKET)
    .list(folder, { limit: 200 });
  if (error || !files?.length) return undefined;
  const hit = files.find((f) => f.name === name);
  const meta = hit?.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const size = (meta as Record<string, unknown>).size;
  return typeof size === "number" ? size : undefined;
}

async function tryResolveSelfieDisplayUrl(
  service: AdminSupabaseClient,
  raw: string,
): Promise<SignOutcome> {
  const { objectPath, shape } = resolveProofSelfieObjectPathForSigning(raw);

  if (objectPath) {
    const sizeBytes = await proofSelfieObjectSizeBytesFromList(service, objectPath);
    if (sizeBytes === 0) {
      return {
        kind: "fail",
        message:
          "Proof selfie file is empty (0-byte upload). Ask the user to retake and resubmit from the app.",
        shape,
      };
    }
    const { data, error } = await service.storage
      .from(PROOF_SELFIES_BUCKET)
      .createSignedUrl(objectPath, SIGNED_SELFIE_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return {
        kind: "fail",
        message: sanitizeErrorMessage(error?.message ?? "Could not create signed URL for proof selfie"),
        shape,
      };
    }
    return {
      kind: "signed",
      signedUrl: data.signedUrl,
      expiresAt: new Date(Date.now() + SIGNED_SELFIE_TTL_SECONDS * 1000).toISOString(),
    };
  }

  if (shape === "absolute_non_supabase") {
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return {
        kind: "fail",
        message:
          "Stored selfie is not an object key and valid direct display is only allowed for trusted HTTPS media URLs",
        shape,
      };
    }
    if (!isTrustedDirectSelfieUrl(trimmed)) {
      return {
        kind: "fail",
        message:
          "Stored selfie URL is not on an allowed proof-selfie media origin. Ask the user to resubmit verification from the app.",
        shape,
      };
    }
    return {
      kind: "direct",
      url: trimmed,
      expiresAt: new Date(Date.now() + DIRECT_SELFIE_REVALIDATION_SECONDS * 1000).toISOString(),
    };
  }

  return {
    kind: "fail",
    message: "Could not derive proof-selfies object path from stored selfie value",
    shape,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) return auth.response;

    let body: { verification_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { success: false, error: "Invalid JSON body" }, 400);
    }

    const verificationId = body.verification_id;
    if (!verificationId || typeof verificationId !== "string") {
      return jsonResponse(req, { success: false, error: "Missing verification_id" }, 400);
    }

    const { data: verification, error: fetchErr } = await auth.context.adminClient
      .from("photo_verifications")
      .select("id, user_id, selfie_url")
      .eq("id", verificationId)
      .maybeSingle();

    if (fetchErr) {
      console.error("admin-proof-selfie-sign lookup failed:", sanitizeErrorMessage(fetchErr.message));
      return jsonResponse(
        req,
        { success: false, error: "Could not load verification selfie metadata" },
        500,
      );
    }

    if (!verification) {
      return jsonResponse(
        req,
        { success: false, error: "Verification not found" },
        404,
      );
    }

    const { data: profile } = await auth.context.adminClient
      .from("profiles")
      .select("proof_selfie_url")
      .eq("id", verification.user_id)
      .maybeSingle();

    const verificationSelfie = (verification.selfie_url as string) ?? "";
    const profileSelfie = profile?.proof_selfie_url ?? "";

    let outcome = await tryResolveSelfieDisplayUrl(auth.context.adminClient, verificationSelfie);
    if (
      outcome.kind === "fail" &&
      profileSelfie.length > 0 &&
      profileSelfie !== verificationSelfie
    ) {
      outcome = await tryResolveSelfieDisplayUrl(auth.context.adminClient, profileSelfie);
    }

    if (outcome.kind === "signed") {
      return jsonResponse(
        req,
        { success: true, signedUrl: outcome.signedUrl, expires_at: outcome.expiresAt },
        200,
      );
    }
    if (outcome.kind === "direct") {
      return jsonResponse(req, { success: true, directUrl: outcome.url, expires_at: outcome.expiresAt }, 200);
    }

    return jsonResponse(
      req,
      {
        success: false,
        error: sanitizeErrorMessage(outcome.message),
        shape: outcome.shape,
      },
      422,
    );
  } catch (err) {
    console.error("admin-proof-selfie-sign:", sanitizeErrorMessage(err));
    return jsonResponse(req, { success: false, error: "Server error" }, 500);
  }
});
