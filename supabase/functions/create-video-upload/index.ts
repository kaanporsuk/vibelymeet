import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { logVibeVideo } from "../_shared/vibe-video-logs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getProjectRef(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

type AdminSupabaseClient = SupabaseClient<any, "public", any>;

type OrphanCleanupContext = Record<string, string | number | boolean | null>;
type CreateVideoUploadRequestBody = {
  context?: unknown;
  client_request_id?: unknown;
  clientRequestId?: unknown;
  duration_ms?: unknown;
  aspect_ratio?: unknown;
  source_bytes?: unknown;
  mime_type?: unknown;
};

type CleanupCreatedVideoArgs = {
  adminSupabase: AdminSupabaseClient;
  libraryId: string;
  apiKey: string;
  videoId: string;
  userId: string;
  projectRef: string;
  reason: string;
  context?: OrphanCleanupContext;
  requireDurableBeforeImmediate?: boolean;
};
type ReusableVibeVideoUploadAttempt = {
  id?: unknown;
  provider_object_id?: unknown;
  status?: unknown;
  draft_media_session_id?: unknown;
  media_asset_id?: unknown;
  upload_context?: unknown;
  attempt_count?: unknown;
};
type DurableReusableUploadAttemptState = {
  attempt: ReusableVibeVideoUploadAttempt | null;
  currentProfileVideoId: string | null;
  durable: boolean;
  waitedMs: number;
  errorCode: string | null;
};

const REUSABLE_ATTEMPT_LINK_WAIT_DELAYS_MS = [150, 300, 600, 1_000] as const;
const EXPECTED_TUS_CREDENTIAL_TTL_MS = 60 * 60 * 1000;

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function isValidVideoGuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function isReusableVibeVideoUploadAttemptStatus(value: unknown): boolean {
  return value === "uploading" || value === "processing" || value === "ready";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalPositiveInteger(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const next = Math.trunc(value);
  return next > 0 && next <= max ? next : null;
}

function optionalPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function durableAttemptSessionId(attempt: ReusableVibeVideoUploadAttempt | null | undefined): string | null {
  const value = attempt?.draft_media_session_id;
  return stringValue(value);
}

function durableAttemptMediaAssetId(attempt: ReusableVibeVideoUploadAttempt | null | undefined): string | null {
  const value = attempt?.media_asset_id;
  return stringValue(value);
}

function durableAttemptProviderObjectId(attempt: ReusableVibeVideoUploadAttempt | null | undefined): string | null {
  const value = attempt?.provider_object_id;
  return stringValue(value);
}

function uploadAttemptStatus(attempt: ReusableVibeVideoUploadAttempt | null | undefined): string | null {
  const value = attempt?.status;
  return typeof value === "string" ? value : null;
}

function isDurablyLinkedUploadAttempt(
  attempt: ReusableVibeVideoUploadAttempt | null | undefined,
  currentProfileVideoId: string | null,
): boolean {
  const sessionId = durableAttemptSessionId(attempt);
  const mediaAssetId = durableAttemptMediaAssetId(attempt);
  const providerObjectId = durableAttemptProviderObjectId(attempt);
  return Boolean(sessionId && (mediaAssetId || (providerObjectId && providerObjectId === currentProfileVideoId)));
}

async function readReusableUploadAttemptState(
  adminSupabase: AdminSupabaseClient,
  userId: string,
  clientRequestId: string,
): Promise<{
  attempt: ReusableVibeVideoUploadAttempt | null;
  currentProfileVideoId: string | null;
  errorCode: string | null;
}> {
  const [attemptResult, profileResult] = await Promise.all([
    adminSupabase
      .from("vibe_video_uploads")
      .select("id,provider_object_id,status,draft_media_session_id,media_asset_id,upload_context,attempt_count")
      .eq("user_id", userId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle(),
    adminSupabase
      .from("profiles")
      .select("bunny_video_uid")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (attemptResult.error) {
    return {
      attempt: null,
      currentProfileVideoId: null,
      errorCode: attemptResult.error.code ?? "attempt_lookup_failed",
    };
  }

  return {
    attempt: attemptResult.data as ReusableVibeVideoUploadAttempt | null,
    currentProfileVideoId: profileResult.error ? null : stringValue(profileResult.data?.bunny_video_uid),
    errorCode: null,
  };
}

async function waitForDurableReusableUploadAttempt(
  adminSupabase: AdminSupabaseClient,
  params: {
    userId: string;
    clientRequestId: string;
    initialAttempt: ReusableVibeVideoUploadAttempt;
    initialProfileVideoId: string | null;
  },
): Promise<DurableReusableUploadAttemptState> {
  let attempt: ReusableVibeVideoUploadAttempt | null = params.initialAttempt;
  let currentProfileVideoId = params.initialProfileVideoId;
  let waitedMs = 0;

  if (
    isReusableVibeVideoUploadAttemptStatus(uploadAttemptStatus(attempt)) &&
    isDurablyLinkedUploadAttempt(attempt, currentProfileVideoId)
  ) {
    return { attempt, currentProfileVideoId, durable: true, waitedMs, errorCode: null };
  }

  for (const delayMs of REUSABLE_ATTEMPT_LINK_WAIT_DELAYS_MS) {
    await sleep(delayMs);
    waitedMs += delayMs;
    const next = await readReusableUploadAttemptState(adminSupabase, params.userId, params.clientRequestId);
    if (next.errorCode) {
      return { attempt, currentProfileVideoId, durable: false, waitedMs, errorCode: next.errorCode };
    }

    attempt = next.attempt;
    currentProfileVideoId = next.currentProfileVideoId;
    if (
      isReusableVibeVideoUploadAttemptStatus(uploadAttemptStatus(attempt)) &&
      isDurablyLinkedUploadAttempt(attempt, currentProfileVideoId)
    ) {
      return { attempt, currentProfileVideoId, durable: true, waitedMs, errorCode: null };
    }
  }

  return { attempt, currentProfileVideoId, durable: false, waitedMs, errorCode: null };
}

function uploadAttemptStateRefreshFailureResponse(params: {
  userId: string;
  clientRequestId: string;
  projectRef: string;
  attempt: ReusableVibeVideoUploadAttempt;
  state: DurableReusableUploadAttemptState;
  status: string | null;
}): Response {
  logVibeVideo("error", "create_video_upload_attempt_state_refresh_failed", {
    user_id: params.userId,
    client_request_id: params.clientRequestId,
    upload_attempt_id: stringValue(params.attempt.id),
    video_guid: durableAttemptProviderObjectId(params.attempt),
    status: params.status,
    waited_ms: params.state.waitedMs,
    has_media_session: !!durableAttemptSessionId(params.attempt),
    has_media_asset: !!durableAttemptMediaAssetId(params.attempt),
    profile_linked: durableAttemptProviderObjectId(params.attempt) === params.state.currentProfileVideoId,
    error_code: params.state.errorCode ?? "attempt_state_refresh_failed",
    project_ref: params.projectRef,
  });
  return json(
    {
      success: false,
      error: "Failed to refresh upload attempt state",
      code: "upload_attempt_state_refresh_failed",
    },
    500,
  );
}

function parseClientRequestId(body: CreateVideoUploadRequestBody): {
  ok: true;
  clientRequestId: string;
  wasProvided: boolean;
} | { ok: false; error: string } {
  const raw = body.client_request_id ?? body.clientRequestId;
  if (raw == null || raw === "") {
    return { ok: true, clientRequestId: globalThis.crypto.randomUUID(), wasProvided: false };
  }
  if (!isUuid(raw)) return { ok: false, error: "invalid_client_request_id" };
  return { ok: true, clientRequestId: raw.trim(), wasProvided: true };
}

async function createTusSignature(libraryId: string, apiKey: string, expirationTime: number, videoId: string) {
  const signatureInput = `${libraryId}${apiKey}${expirationTime}${videoId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureInput);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enqueueDurableOrphanCleanup(
  adminSupabase: AdminSupabaseClient,
  videoId: string,
  userId: string,
  projectRef: string,
  reason: string,
  context: OrphanCleanupContext,
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await adminSupabase.rpc(
      "enqueue_vibe_video_orphan_delete",
      {
        p_user_id: userId,
        p_video_id: videoId,
        p_reason: reason,
        p_context: context,
      },
    );

    if (error) {
      logVibeVideo("error", "create_video_upload_durable_orphan_cleanup_failed", {
        user_id: userId,
        video_guid: videoId,
        reason,
        project_ref: projectRef,
        error_code: error.code ?? "orphan_cleanup_rpc_failed",
      });
      return null;
    }

    const result = data as Record<string, unknown> | null;
    if (result?.success === true) {
      logVibeVideo("warn", "create_video_upload_durable_orphan_cleanup_enqueued", {
        user_id: userId,
        video_guid: videoId,
        reason,
        project_ref: projectRef,
        skipped: result.skipped === true,
        skip_reason: typeof result.reason === "string" ? result.reason : null,
      });
      return result;
    }

    logVibeVideo("error", "create_video_upload_durable_orphan_cleanup_failed", {
      user_id: userId,
      video_guid: videoId,
      reason,
      project_ref: projectRef,
      error_code: typeof result?.error === "string" ? result.error : "orphan_cleanup_not_enqueued",
    });
    return result;
  } catch (cleanupErr) {
    logVibeVideo("error", "create_video_upload_durable_orphan_cleanup_failed", {
      user_id: userId,
      video_guid: videoId,
      reason,
      project_ref: projectRef,
      error_code: cleanupErr instanceof Error ? cleanupErr.name : "unknown",
    });
    return null;
  }
}

async function cleanupCreatedVideo({
  adminSupabase,
  libraryId,
  apiKey,
  videoId,
  userId,
  projectRef,
  reason,
  context = {},
  requireDurableBeforeImmediate = false,
}: CleanupCreatedVideoArgs) {
  const durableCleanup = await enqueueDurableOrphanCleanup(
    adminSupabase,
    videoId,
    userId,
    projectRef,
    reason,
    context,
  );

  if (durableCleanup?.skipped === true) {
    logVibeVideo("warn", "create_video_upload_cleanup_created_video_skipped", {
      user_id: userId,
      video_guid: videoId,
      reason,
      project_ref: projectRef,
      skip_reason: typeof durableCleanup.reason === "string" ? durableCleanup.reason : "durable_cleanup_skipped",
    });
    return;
  }

  if (durableCleanup?.success !== true && requireDurableBeforeImmediate) {
    logVibeVideo("error", "create_video_upload_cleanup_created_video_skipped", {
      user_id: userId,
      video_guid: videoId,
      reason,
      project_ref: projectRef,
      skip_reason: "durable_cleanup_required",
    });
    return;
  }

  try {
    const deleteResponse = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
      {
        method: "DELETE",
        headers: { "AccessKey": apiKey },
      },
    );

    logVibeVideo("warn", "create_video_upload_cleanup_created_video", {
      user_id: userId,
      video_guid: videoId,
      reason,
      bunny_status: deleteResponse.status,
      project_ref: projectRef,
    });
  } catch (cleanupErr) {
    logVibeVideo("error", "create_video_upload_cleanup_failed", {
      user_id: userId,
      video_guid: videoId,
      reason,
      project_ref: projectRef,
      error_code: cleanupErr instanceof Error ? cleanupErr.name : "unknown",
    });
  }
}

async function markVibeVideoUploadAttemptFailed(
  adminSupabase: AdminSupabaseClient,
  uploadAttemptId: string | null,
  providerObjectId: string,
  userId: string,
  projectRef: string,
  errorDetail: string,
) {
  if (!uploadAttemptId) return;
  const { error } = await adminSupabase
    .from("vibe_video_uploads")
    .update({ status: "failed", error_detail: errorDetail })
    .eq("id", uploadAttemptId)
    .eq("provider_object_id", providerObjectId);

  if (error) {
    logVibeVideo("error", "create_video_upload_attempt_fail_mark_failed", {
      user_id: userId,
      video_guid: providerObjectId,
      upload_attempt_id: uploadAttemptId,
      project_ref: projectRef,
      error_code: error.code ?? "attempt_fail_mark_failed",
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    logVibeVideo("warn", "create_video_upload_rejected", {
      reason: "method_not_allowed",
      method: req.method,
    });
    return json({ success: false, error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));
  let createdVideoId: string | null = null;
  let uploadCredentialsReturned = false;
  let cleanupFailurePath = "post_bunny_create_unexpected";
  let cleanupUserId: string | null = null;
  let cleanupLibraryId: string | null = null;
  let cleanupApiKey: string | null = null;
  let cleanupAdminSupabase: AdminSupabaseClient | null = null;
  let cleanupUploadAttemptId: string | null = null;

  try {
    logVibeVideo("info", "create_video_upload_request_received", {
      project_ref: projectRef,
      method: req.method,
    });
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      logVibeVideo("warn", "create_video_upload_rejected", {
        project_ref: projectRef,
        reason: "auth_header_missing",
      });
      return json({ success: false, error: "No authorization header", code: "auth_header_missing" }, 401);
    }

    // Parse body once (before auth, since body stream is single-consume)
    let uploadContext: "onboarding" | "profile_studio" = "profile_studio";
    let requestBody: CreateVideoUploadRequestBody = {};
    let durationMs: number | null = null;
    let aspectRatio: number | null = null;
    let sourceBytes: number | null = null;
    let mimeType: string | null = null;
    try {
      const parsedBody = await req.json();
      requestBody = parsedBody && typeof parsedBody === "object"
        ? parsedBody as CreateVideoUploadRequestBody
        : {};
      const body = requestBody;
      if (body?.context === "onboarding") uploadContext = "onboarding";
      durationMs = optionalPositiveInteger(body.duration_ms, 30_250);
      aspectRatio = optionalPositiveNumber(body.aspect_ratio);
      sourceBytes = optionalPositiveInteger(body.source_bytes, 209_715_200);
      mimeType = typeof body.mime_type === "string" && body.mime_type.trim()
        ? body.mime_type.trim().slice(0, 120)
        : null;
    } catch {
      // No body or non-JSON — default to profile_studio
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      logVibeVideo("warn", "create_video_upload_rejected", {
        project_ref: projectRef,
        reason: "unauthorized",
      });
      return json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401);
    }
    logVibeVideo("info", "create_video_upload_auth_resolved", {
      project_ref: projectRef,
      user_id: user.id,
      upload_context: uploadContext,
    });
    cleanupUserId = user.id;

    const clientRequest = parseClientRequestId(requestBody);
    if (!clientRequest.ok) {
      logVibeVideo("warn", "create_video_upload_rejected", {
        project_ref: projectRef,
        user_id: user.id,
        reason: clientRequest.error,
      });
      return json({ success: false, error: clientRequest.error, code: clientRequest.error }, 400);
    }
    const clientRequestId = clientRequest.clientRequestId;
    logVibeVideo("info", "create_video_upload_client_request_resolved", {
      project_ref: projectRef,
      user_id: user.id,
      client_request_id: clientRequestId,
      client_request_id_provided: clientRequest.wasProvided,
    });

    const libraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    const apiKey = Deno.env.get("BUNNY_STREAM_API_KEY");
    const cdnHostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");

    if (!libraryId || !apiKey || !cdnHostname) {
      logVibeVideo("error", "create_video_upload_missing_bunny_config", {
        user_id: user.id,
        project_ref: projectRef,
        has_library_id: !!libraryId,
        has_api_key: !!apiKey,
        has_cdn_hostname: !!cdnHostname,
      });
      return json(
        { success: false, error: "Bunny credentials not configured", code: "missing_bunny_secret" },
        503,
      );
    }
    cleanupLibraryId = libraryId;
    cleanupApiKey = apiKey;

    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    cleanupAdminSupabase = adminSupabase;

    // ── Profile gate ─────────────────────────────────────────────────────────
    const { data: profileRow, error: profileReadError } = await adminSupabase
      .from("profiles")
      .select("id,name,age,gender,bunny_video_uid")
      .eq("id", user.id)
      .maybeSingle();
    if (profileReadError) {
      logVibeVideo("error", "create_video_upload_profile_lookup_failed", {
        user_id: user.id,
        project_ref: projectRef,
        error_code: profileReadError.code ?? "profile_lookup_failed",
      });
      return json(
        { success: false, error: "Failed to read profile state", code: "profile_lookup_failed" },
        500,
      );
    }

    if (!profileRow) {
      logVibeVideo("warn", "create_video_upload_profile_missing", {
        user_id: user.id,
        project_ref: projectRef,
      });
      return json(
        { success: false, error: "Profile is missing for current user", code: "profile_missing" },
        409,
      );
    }

    if (profileRow.name == null || profileRow.age == null || profileRow.gender == null) {
      logVibeVideo("warn", "create_video_upload_profile_incomplete", {
        user_id: user.id,
        project_ref: projectRef,
        has_name: profileRow.name != null,
        has_age: profileRow.age != null,
        has_gender: profileRow.gender != null,
      });
      return json(
        {
          success: false,
          error: "Profile is incomplete for video upload",
          code: "profile_incomplete",
        },
        409,
      );
    }

    const existingVideoId = profileRow.bunny_video_uid;

    if (clientRequest.wasProvided) {
      const { data: existingAttempt, error: existingAttemptError } = await adminSupabase
        .from("vibe_video_uploads")
        .select("id,provider_object_id,status,draft_media_session_id,media_asset_id,upload_context")
        .eq("user_id", user.id)
        .eq("client_request_id", clientRequestId)
        .maybeSingle();

      if (existingAttemptError) {
        logVibeVideo("error", "create_video_upload_attempt_lookup_failed", {
          user_id: user.id,
          client_request_id: clientRequestId,
          project_ref: projectRef,
          error_code: existingAttemptError.code ?? "attempt_lookup_failed",
        });
        return json(
          { success: false, error: "Failed to read upload attempt", code: "upload_attempt_lookup_failed" },
          500,
        );
      }

      if (existingAttempt?.provider_object_id) {
        let reusableAttempt = existingAttempt as ReusableVibeVideoUploadAttempt;
        let existingStatus = uploadAttemptStatus(reusableAttempt);
        if (!isReusableVibeVideoUploadAttemptStatus(existingStatus)) {
          logVibeVideo("warn", "create_video_upload_attempt_terminal_reuse_rejected", {
            user_id: user.id,
            client_request_id: clientRequestId,
            upload_attempt_id: stringValue(reusableAttempt.id),
            video_guid: durableAttemptProviderObjectId(reusableAttempt),
            status: existingStatus,
            project_ref: projectRef,
          });
          return json(
            { success: false, error: "Upload attempt is no longer reusable", code: "upload_attempt_terminal" },
            409,
          );
        }

        const reusableState = await waitForDurableReusableUploadAttempt(adminSupabase, {
          userId: user.id,
          clientRequestId,
          initialAttempt: reusableAttempt,
          initialProfileVideoId: stringValue(existingVideoId),
        });
        reusableAttempt = reusableState.attempt ?? reusableAttempt;
        existingStatus = uploadAttemptStatus(reusableAttempt);
        if (reusableState.errorCode) {
          return uploadAttemptStateRefreshFailureResponse({
            userId: user.id,
            clientRequestId,
            projectRef,
            attempt: reusableAttempt,
            state: reusableState,
            status: existingStatus,
          });
        }
        if (!isReusableVibeVideoUploadAttemptStatus(existingStatus)) {
          logVibeVideo("warn", "create_video_upload_attempt_terminal_reuse_rejected", {
            user_id: user.id,
            client_request_id: clientRequestId,
            upload_attempt_id: stringValue(reusableAttempt.id),
            video_guid: durableAttemptProviderObjectId(reusableAttempt),
            status: existingStatus,
            project_ref: projectRef,
          });
          return json(
            { success: false, error: "Upload attempt is no longer reusable", code: "upload_attempt_terminal" },
            409,
          );
        }

        const existingSessionId = durableAttemptSessionId(reusableAttempt);
        if (!reusableState.durable || !existingSessionId) {
          logVibeVideo("warn", "create_video_upload_attempt_reuse_waiting_for_durable_link", {
            user_id: user.id,
            client_request_id: clientRequestId,
            upload_attempt_id: stringValue(reusableAttempt.id),
            video_guid: durableAttemptProviderObjectId(reusableAttempt),
            status: existingStatus,
            waited_ms: reusableState.waitedMs,
            has_media_session: !!existingSessionId,
            has_media_asset: !!durableAttemptMediaAssetId(reusableAttempt),
            profile_linked: durableAttemptProviderObjectId(reusableAttempt) === reusableState.currentProfileVideoId,
            error_code: reusableState.errorCode,
            project_ref: projectRef,
          });
          return json(
            {
              success: false,
              error: "Upload attempt is still being prepared. Please retry.",
              code: "upload_attempt_not_durable",
              retryable: true,
            },
            425,
          );
        }

        const retryVideoId = durableAttemptProviderObjectId(reusableAttempt);
        if (!retryVideoId) {
          return json(
            { success: false, error: "Upload attempt is no longer reusable", code: "upload_attempt_terminal" },
            409,
          );
        }
        const expirationTime = Math.floor(Date.now() / 1000) + 3600;
        const signature = await createTusSignature(libraryId, apiKey, expirationTime, retryVideoId);
        logVibeVideo("info", "create_video_upload_attempt_reused", {
          user_id: user.id,
          client_request_id: clientRequestId,
          video_guid: retryVideoId,
          upload_attempt_id: stringValue(reusableAttempt.id),
          media_session_id: existingSessionId,
          media_asset_id: durableAttemptMediaAssetId(reusableAttempt),
          durable_via_profile: retryVideoId === reusableState.currentProfileVideoId,
          status: existingStatus,
          project_ref: projectRef,
        });
        uploadCredentialsReturned = true;
        return json(
          {
            success: true,
            videoId: retryVideoId,
            libraryId,
            expirationTime,
            signature,
            cdnHostname,
            sessionId: existingSessionId,
            sessionStatus: existingStatus ?? "uploading",
            clientRequestId,
            uploadAttemptId: stringValue(reusableAttempt.id),
            repairableLifecycleState: durableAttemptMediaAssetId(reusableAttempt) == null,
          },
          200,
        );
      }
    }

    // ── Create new Bunny Stream video ────────────────────────────────────────
    const createResponse = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos`,
      {
        method: "POST",
        headers: {
          "AccessKey": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: `vibe-${user.id}-${clientRequestId}` }),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logVibeVideo("error", "create_video_upload_bunny_create_failed", {
        user_id: user.id,
        project_ref: projectRef,
        http_status: createResponse.status,
        error_code: "bunny_create_failed",
        body_snippet_length: errorText.length,
      });
      return json(
        { success: false, error: "Failed to create video on Bunny", code: "bunny_create_failed" },
        502,
      );
    }

    cleanupFailurePath = "bunny_create_response_parse";
    const createPayload = await createResponse.json().catch(() => null) as { guid?: unknown } | null;
    const videoId = typeof createPayload?.guid === "string" ? createPayload.guid.trim() : "";
    if (!isValidVideoGuid(videoId)) {
      logVibeVideo("error", "create_video_upload_bunny_create_invalid_response", {
        user_id: user.id,
        project_ref: projectRef,
        error_code: "bunny_create_invalid_response",
      });
      return json(
        { success: false, error: "Failed to create video on Bunny", code: "bunny_create_invalid_response" },
        502,
      );
    }
    createdVideoId = videoId;
    logVibeVideo("info", "create_video_upload_bunny_video_created", {
      user_id: user.id,
      video_guid: videoId,
      library_id: libraryId,
      project_ref: projectRef,
    });

    // ── TUS signature ────────────────────────────────────────────────────────
    cleanupFailurePath = "tus_signature_generation";
    const expirationTime = Math.floor((Date.now() + EXPECTED_TUS_CREDENTIAL_TTL_MS) / 1000);
    const signature = await createTusSignature(libraryId, apiKey, expirationTime, videoId);

    // Reserve the idempotency row before touching profile/session state. This
    // keeps duplicate client_request_id races from activating a losing upload.
    cleanupFailurePath = "create_vibe_video_upload_attempt";
    const { data: attemptRow, error: attemptCreateError } = await adminSupabase
      .from("vibe_video_uploads")
      .insert({
        user_id: user.id,
        client_request_id: clientRequestId,
        media_asset_id: null,
        draft_media_session_id: null,
        provider_object_id: videoId,
        upload_context: uploadContext,
        status: "uploading",
        expires_at: new Date(expirationTime * 1000).toISOString(),
        duration_ms: durationMs,
        aspect_ratio: aspectRatio,
        source_bytes: sourceBytes,
        mime_type: mimeType,
      })
      .select("id,status")
      .single();

    if (attemptCreateError || !attemptRow) {
      if (clientRequest.wasProvided && attemptCreateError?.code === "23505") {
        const { data: duplicateAttempt, error: duplicateLookupError } = await adminSupabase
          .from("vibe_video_uploads")
          .select("id,provider_object_id,status,draft_media_session_id,media_asset_id,upload_context,attempt_count")
          .eq("user_id", user.id)
          .eq("client_request_id", clientRequestId)
          .maybeSingle();

        if (!duplicateLookupError && duplicateAttempt?.provider_object_id) {
          let reusableAttempt = duplicateAttempt as ReusableVibeVideoUploadAttempt;
          let duplicateStatus = uploadAttemptStatus(reusableAttempt);
          await cleanupCreatedVideo({
            adminSupabase,
            libraryId,
            apiKey,
            videoId,
            userId: user.id,
            projectRef,
            reason: "duplicate_client_request_id",
            context: {
              failure_path: "create_vibe_video_upload_attempt_duplicate",
              upload_context: uploadContext,
            },
            requireDurableBeforeImmediate: true,
          });

          if (!isReusableVibeVideoUploadAttemptStatus(duplicateStatus)) {
            logVibeVideo("warn", "create_video_upload_attempt_terminal_reuse_rejected", {
              user_id: user.id,
              client_request_id: clientRequestId,
              upload_attempt_id: stringValue(reusableAttempt.id),
              video_guid: durableAttemptProviderObjectId(reusableAttempt),
              status: duplicateStatus,
              project_ref: projectRef,
            });
            return json(
              { success: false, error: "Upload attempt is no longer reusable", code: "upload_attempt_terminal" },
              409,
            );
          }
          const uploadAttemptId = stringValue(reusableAttempt.id);
          const { error: attemptCountIncrementError } = uploadAttemptId
            ? await adminSupabase.rpc("increment_vibe_video_upload_attempt_count", {
              p_upload_id: uploadAttemptId,
            })
            : { error: new Error("missing_upload_attempt_id") };
          if (attemptCountIncrementError) {
            logVibeVideo("warn", "create_video_upload_attempt_count_update_failed", {
              user_id: user.id,
              client_request_id: clientRequestId,
              upload_attempt_id: uploadAttemptId,
              project_ref: projectRef,
              error: attemptCountIncrementError.message,
            });
          }

          const reusableState = await waitForDurableReusableUploadAttempt(adminSupabase, {
            userId: user.id,
            clientRequestId,
            initialAttempt: reusableAttempt,
            initialProfileVideoId: stringValue(existingVideoId),
          });
          reusableAttempt = reusableState.attempt ?? reusableAttempt;
          duplicateStatus = uploadAttemptStatus(reusableAttempt);
          if (reusableState.errorCode) {
            return uploadAttemptStateRefreshFailureResponse({
              userId: user.id,
              clientRequestId,
              projectRef,
              attempt: reusableAttempt,
              state: reusableState,
              status: duplicateStatus,
            });
          }
          if (!isReusableVibeVideoUploadAttemptStatus(duplicateStatus)) {
            logVibeVideo("warn", "create_video_upload_attempt_terminal_reuse_rejected", {
              user_id: user.id,
              client_request_id: clientRequestId,
              upload_attempt_id: stringValue(reusableAttempt.id),
              video_guid: durableAttemptProviderObjectId(reusableAttempt),
              status: duplicateStatus,
              project_ref: projectRef,
            });
            return json(
              { success: false, error: "Upload attempt is no longer reusable", code: "upload_attempt_terminal" },
              409,
            );
          }

          const duplicateSessionId = durableAttemptSessionId(reusableAttempt);
          if (!reusableState.durable || !duplicateSessionId) {
            logVibeVideo("warn", "create_video_upload_attempt_reuse_waiting_for_durable_link", {
              user_id: user.id,
              client_request_id: clientRequestId,
              upload_attempt_id: stringValue(reusableAttempt.id),
              video_guid: durableAttemptProviderObjectId(reusableAttempt),
              status: duplicateStatus,
              waited_ms: reusableState.waitedMs,
              has_media_session: !!duplicateSessionId,
              has_media_asset: !!durableAttemptMediaAssetId(reusableAttempt),
              profile_linked: durableAttemptProviderObjectId(reusableAttempt) === reusableState.currentProfileVideoId,
              error_code: reusableState.errorCode,
              project_ref: projectRef,
            });
            return json(
              {
                success: false,
                error: "Upload attempt is still being prepared. Please retry.",
                code: "upload_attempt_not_durable",
                retryable: true,
              },
              425,
            );
          }

          const retryVideoId = durableAttemptProviderObjectId(reusableAttempt);
          if (!retryVideoId) {
            return json(
              { success: false, error: "Upload attempt is no longer reusable", code: "upload_attempt_terminal" },
              409,
            );
          }
          const retryExpirationTime = Math.floor(Date.now() / 1000) + 3600;
          const retrySignature = await createTusSignature(libraryId, apiKey, retryExpirationTime, retryVideoId);
          logVibeVideo("info", "create_video_upload_attempt_reused_after_duplicate", {
            user_id: user.id,
            client_request_id: clientRequestId,
            video_guid: retryVideoId,
            upload_attempt_id: stringValue(reusableAttempt.id),
            media_session_id: duplicateSessionId,
            media_asset_id: durableAttemptMediaAssetId(reusableAttempt),
            durable_via_profile: retryVideoId === reusableState.currentProfileVideoId,
            status: duplicateStatus,
            project_ref: projectRef,
          });
          uploadCredentialsReturned = true;
          return json(
            {
              success: true,
              videoId: retryVideoId,
              libraryId,
              expirationTime: retryExpirationTime,
              signature: retrySignature,
              cdnHostname,
              sessionId: duplicateSessionId,
              sessionStatus: duplicateStatus ?? "uploading",
              clientRequestId,
              uploadAttemptId: stringValue(reusableAttempt.id),
              repairableLifecycleState: durableAttemptMediaAssetId(reusableAttempt) == null,
            },
            200,
          );
        }
      }

      logVibeVideo("error", "create_video_upload_attempt_create_failed", {
        user_id: user.id,
        client_request_id: clientRequestId,
        video_guid: videoId,
        error_code: attemptCreateError?.code ?? "attempt_create_failed",
      });
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "vibe_video_upload_attempt_create_failed",
        context: {
          failure_path: "create_vibe_video_upload_attempt",
          upload_context: uploadContext,
        },
        requireDurableBeforeImmediate: true,
      });
      return json(
        { success: false, error: "Failed to create upload attempt", code: "vibe_video_upload_attempt_create_failed" },
        500,
      );
    }
    cleanupUploadAttemptId = typeof attemptRow.id === "string" ? attemptRow.id : null;

    // ── Create draft media session (server-owned upload tracking) ────────────
    // Uses adminSupabase (service_role) — the RPC is granted to service_role
    // only.  Edge Function authenticates the user; the RPC trusts the caller.
    cleanupFailurePath = "create_media_session";
    const { data: sessionResult, error: sessionError } = await adminSupabase.rpc(
      "create_media_session",
      {
        p_user_id: user.id,
        p_media_type: "vibe_video",
        p_provider_id: videoId,
        p_provider_meta: { libraryId, expirationTime, signature, cdnHostname },
        p_context: uploadContext,
      },
    );

    if (sessionError) {
      logVibeVideo("error", "create_video_upload_media_session_create_failed", {
        user_id: user.id,
        video_guid: videoId,
        error_code: sessionError.code ?? "session_creation_failed",
      });
      await markVibeVideoUploadAttemptFailed(
        adminSupabase,
        cleanupUploadAttemptId,
        videoId,
        user.id,
        projectRef,
        "session_creation_failed",
      );
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "session_creation_failed",
        context: {
          failure_path: "create_media_session_error",
          upload_context: uploadContext,
        },
      });
      return json(
        { success: false, error: "Failed to create durable upload session", code: "media_session_create_failed" },
        500,
      );
    }

    const sr = sessionResult as Record<string, unknown> | null;
    const sessionId = typeof sr?.session_id === "string" ? sr.session_id : null;
    const replacedSessionId = typeof sr?.replaced_session_id === "string" ? sr.replaced_session_id : null;
    const replacedProviderId = typeof sr?.replaced_provider_id === "string" ? sr.replaced_provider_id : null;

    if (sr?.success !== true) {
      logVibeVideo("error", "create_video_upload_media_session_create_rejected", {
        user_id: user.id,
        video_guid: videoId,
        error_code: typeof sr?.error === "string" ? sr.error : "session_rpc_failed",
      });
      await markVibeVideoUploadAttemptFailed(
        adminSupabase,
        cleanupUploadAttemptId,
        videoId,
        user.id,
        projectRef,
        typeof sr?.error === "string" ? sr.error : "session_rpc_failed",
      );
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "session_rpc_failed",
        context: {
          failure_path: "create_media_session_rejected",
          upload_context: uploadContext,
        },
      });
      return json(
        { success: false, error: "Failed to create durable upload session", code: "media_session_create_failed" },
        500,
      );
    }

    if (replacedProviderId && replacedProviderId !== existingVideoId) {
      logVibeVideo("warn", "create_video_upload_old_video_cleanup_deferred", {
        user_id: user.id,
        video_guid: String(replacedProviderId),
        reason: "replaced_provider_not_profile_uid",
      });
    }

    logVibeVideo("info", "create_video_upload_media_session_created", {
      user_id: user.id,
      video_guid: videoId,
      media_session_id: sessionId,
      replaced_media_session_id: replacedSessionId,
      upload_context: uploadContext,
    });

    if (!sessionId) {
      logVibeVideo("error", "create_video_upload_media_session_missing_id", {
        user_id: user.id,
        video_guid: videoId,
        upload_attempt_id: typeof attemptRow.id === "string" ? attemptRow.id : null,
      });
      await markVibeVideoUploadAttemptFailed(
        adminSupabase,
        cleanupUploadAttemptId,
        videoId,
        user.id,
        projectRef,
        "media_session_missing_id",
      );
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "media_session_missing_id",
        context: {
          failure_path: "create_media_session_missing_id",
          upload_context: uploadContext,
        },
      });
      return json(
        { success: false, error: "Failed to create durable upload session", code: "media_session_create_failed" },
        500,
      );
    }

    cleanupFailurePath = "link_vibe_video_upload_attempt_session";
    const { data: sessionLinkedAttemptRow, error: attemptSessionLinkError } = await adminSupabase
      .from("vibe_video_uploads")
      .update({ draft_media_session_id: sessionId })
      .eq("id", attemptRow.id)
      .eq("provider_object_id", videoId)
      .select("id,status")
      .single();

    if (attemptSessionLinkError || !sessionLinkedAttemptRow) {
      logVibeVideo("error", "create_video_upload_attempt_session_link_failed", {
        user_id: user.id,
        client_request_id: clientRequestId,
        video_guid: videoId,
        media_session_id: sessionId,
        upload_attempt_id: typeof attemptRow.id === "string" ? attemptRow.id : null,
        error_code: attemptSessionLinkError?.code ?? "attempt_session_link_failed",
      });
      await adminSupabase.rpc("update_media_session_status", {
        p_provider_id: videoId,
        p_new_status: "failed",
        p_error_detail: "vibe_video_upload_attempt_session_link_failed",
      });
      await markVibeVideoUploadAttemptFailed(
        adminSupabase,
        cleanupUploadAttemptId,
        videoId,
        user.id,
        projectRef,
        "vibe_video_upload_attempt_session_link_failed",
      );
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "vibe_video_upload_attempt_session_link_failed",
        context: {
          failure_path: "link_vibe_video_upload_attempt_session",
          session_id: sessionId,
          upload_context: uploadContext,
        },
        requireDurableBeforeImmediate: true,
      });
      return json(
        { success: false, error: "Failed to link upload attempt", code: "vibe_video_upload_attempt_link_failed" },
        500,
      );
    }

    cleanupFailurePath = "activate_profile_vibe_video";
    const { data: lifecycleResult, error: lifecycleError } = await adminSupabase.rpc(
      "activate_profile_vibe_video",
      {
        p_user_id: user.id,
        p_video_id: videoId,
        p_video_status: "uploading",
      },
    );

    if (lifecycleError) {
      logVibeVideo("error", "create_video_upload_profile_uid_write_failed", {
        user_id: user.id,
        video_guid: videoId,
        media_session_id: sessionId,
        error_code: lifecycleError.code ?? "rpc_error",
      });
      await adminSupabase.rpc("update_media_session_status", {
        p_provider_id: videoId,
        p_new_status: "failed",
        p_error_detail: "profile_update_failed",
      });
      await markVibeVideoUploadAttemptFailed(
        adminSupabase,
        cleanupUploadAttemptId,
        videoId,
        user.id,
        projectRef,
        "profile_update_failed",
      );
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "rpc_error",
        context: {
          failure_path: "activate_profile_vibe_video_error",
          session_id: sessionId,
          upload_context: uploadContext,
        },
      });
      return json(
        { success: false, error: "Failed to persist upload state", code: "profile_update_failed" },
        500,
      );
    }

    const lr = lifecycleResult as Record<string, unknown> | null;
    if (lr?.success !== true) {
      logVibeVideo("error", "create_video_upload_profile_uid_write_rejected", {
        user_id: user.id,
        video_guid: videoId,
        media_session_id: sessionId,
        error_code: typeof lr?.error === "string" ? lr.error : "rpc_rejected",
      });
      await adminSupabase.rpc("update_media_session_status", {
        p_provider_id: videoId,
        p_new_status: "failed",
        p_error_detail: "profile_update_rejected",
      });
      await markVibeVideoUploadAttemptFailed(
        adminSupabase,
        cleanupUploadAttemptId,
        videoId,
        user.id,
        projectRef,
        "profile_update_rejected",
      );
      await cleanupCreatedVideo({
        adminSupabase,
        libraryId,
        apiKey,
        videoId,
        userId: user.id,
        projectRef,
        reason: "rpc_rejected",
        context: {
          failure_path: "activate_profile_vibe_video_rejected",
          session_id: sessionId,
          upload_context: uploadContext,
        },
      });
      return json(
        { success: false, error: "Failed to persist upload state", code: "profile_update_failed" },
        500,
      );
    }
    const mediaAssetId = typeof lr.asset_id === "string" ? lr.asset_id : null;

    const [profileCaptionsUpdate, primaryVideoCaptionsUpdate] = await Promise.all([
      adminSupabase
        .from("profiles")
        .update({ vibe_video_captions: null })
        .eq("id", user.id),
      mediaAssetId
        ? adminSupabase
          .from("profile_vibe_videos")
          .update({ captions: null })
          .eq("asset_id", mediaAssetId)
        : Promise.resolve({ error: null }),
    ]);
    if (profileCaptionsUpdate.error || primaryVideoCaptionsUpdate.error) {
      logVibeVideo("warn", "create_video_upload_captions_sync_failed", {
        user_id: user.id,
        video_guid: videoId,
        media_asset_id: mediaAssetId,
        profile_error_code: profileCaptionsUpdate.error?.code ?? null,
        profile_video_error_code: primaryVideoCaptionsUpdate.error?.code ?? null,
      });
    }

    let sessionStatus = "created";
    cleanupFailurePath = "mark_media_session_uploading";
    const { data: sessionUploadResult, error: sessionUploadError } = await adminSupabase.rpc(
      "update_media_session_status",
      {
        p_provider_id: videoId,
        p_new_status: "uploading",
        p_error_detail: null,
      },
    );
    const sur = sessionUploadResult as Record<string, unknown> | null;
    if (sessionUploadError || sur?.success !== true) {
      logVibeVideo("warn", "create_video_upload_media_session_uploading_mark_failed_but_repairable", {
        user_id: user.id,
        video_guid: videoId,
        media_session_id: sessionId,
        error_code: sessionUploadError?.code ?? (typeof sur?.error === "string" ? sur.error : "session_status_update_failed"),
        repairable_lifecycle_state: true,
      });
    } else {
      sessionStatus = "uploading";
    }

    let attemptAssetLinkRepairable = false;
    if (mediaAssetId) {
      const { data: assetLinkedAttemptRow, error: attemptAssetLinkError } = await adminSupabase
        .from("vibe_video_uploads")
        .update({ media_asset_id: mediaAssetId })
        .eq("id", attemptRow.id)
        .eq("provider_object_id", videoId)
        .select("id,status")
        .single();

      if (attemptAssetLinkError || !assetLinkedAttemptRow) {
        attemptAssetLinkRepairable = true;
        logVibeVideo("warn", "create_video_upload_attempt_asset_link_failed_but_repairable", {
          user_id: user.id,
          client_request_id: clientRequestId,
          video_guid: videoId,
          media_session_id: sessionId,
          upload_attempt_id: typeof attemptRow.id === "string" ? attemptRow.id : null,
          media_asset_id: mediaAssetId,
          error_code: attemptAssetLinkError?.code ?? "attempt_asset_link_failed",
          repairable_lifecycle_state: true,
        });
      }
    } else {
      attemptAssetLinkRepairable = true;
      logVibeVideo("warn", "create_video_upload_attempt_asset_link_skipped_but_repairable", {
        user_id: user.id,
        client_request_id: clientRequestId,
        video_guid: videoId,
        media_session_id: sessionId,
        upload_attempt_id: typeof attemptRow.id === "string" ? attemptRow.id : null,
        repairable_lifecycle_state: true,
      });
    }

    const { error: supersedeError } = await adminSupabase
      .from("vibe_video_uploads")
      .update({ status: "superseded", error_detail: "replaced_by_new_upload" })
      .eq("user_id", user.id)
      .neq("provider_object_id", videoId)
      .in("status", ["uploading", "processing", "ready"]);

    if (supersedeError) {
      logVibeVideo("warn", "create_video_upload_previous_attempt_supersede_failed", {
        user_id: user.id,
        client_request_id: clientRequestId,
        video_guid: videoId,
        upload_attempt_id: typeof attemptRow.id === "string" ? attemptRow.id : null,
        error_code: supersedeError.code ?? "previous_attempt_supersede_failed",
      });
    }

    logVibeVideo("info", "create_video_upload_profile_uid_write_succeeded", {
      user_id: user.id,
      client_request_id: clientRequestId,
      video_guid: videoId,
      media_session_id: sessionId,
      upload_attempt_id: typeof attemptRow.id === "string" ? attemptRow.id : null,
      media_asset_id: mediaAssetId,
      media_session_status: sessionStatus,
      replaced_existing_video: !!existingVideoId,
      project_ref: projectRef,
    });

    uploadCredentialsReturned = true;
    return json(
      {
        success: true,
        videoId,
        libraryId,
        expirationTime,
        signature,
        cdnHostname,
        sessionId,
        sessionStatus,
        clientRequestId,
        uploadAttemptId: attemptRow.id,
        repairableLifecycleState: sessionStatus !== "uploading" || attemptAssetLinkRepairable,
      },
      200,
    );
  } catch (err) {
    if (cleanupAdminSupabase && cleanupUploadAttemptId && createdVideoId && cleanupUserId) {
      await markVibeVideoUploadAttemptFailed(
        cleanupAdminSupabase,
        cleanupUploadAttemptId,
        createdVideoId,
        cleanupUserId,
        projectRef,
        cleanupFailurePath,
      );
    }
    if (
      createdVideoId &&
      !uploadCredentialsReturned &&
      cleanupAdminSupabase &&
      cleanupUserId &&
      cleanupLibraryId &&
      cleanupApiKey
    ) {
      await cleanupCreatedVideo({
        adminSupabase: cleanupAdminSupabase,
        libraryId: cleanupLibraryId,
        apiKey: cleanupApiKey,
        videoId: createdVideoId,
        userId: cleanupUserId,
        projectRef,
        reason: cleanupFailurePath,
        context: {
          failure_path: cleanupFailurePath,
        },
        requireDurableBeforeImmediate: true,
      });
    }

    logVibeVideo("error", "create_video_upload_unexpected_error", {
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return json({ success: false, error: "Internal server error", code: "internal" }, 500);
  }
});
