import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  createMediaReference,
  MEDIA_FAMILIES,
  PROVIDERS,
  REF_TYPES,
  registerMediaAsset,
} from "./media-lifecycle.ts";

export const CHAT_VIBE_CLIP_MAX_DURATION_MS = 30_000;
export const CHAT_VIBE_CLIP_DURATION_TOLERANCE_MS = 250;
export const CHAT_VIBE_CLIP_MAX_SOURCE_BYTES = 200 * 1024 * 1024;
export const CHAT_VIBE_CLIP_SOFT_SOURCE_BYTES = 75 * 1024 * 1024;
export const CHAT_VIBE_CLIP_TUS_TTL_SECONDS = 60 * 60;

const SUPPORTED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/m4v",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/mp2t",
  "video/mpeg",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  ts: "video/mp2t",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
};

export type ChatVibeClipStatus = "uploading" | "processing" | "ready" | "failed";

type ChatVibeClipLogLevel = "info" | "warn" | "error";
type SafeLogValue = string | number | boolean | null | undefined;
type ChatVibeClipLogFields = Record<string, SafeLogValue>;

const SENSITIVE_LOG_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|apikey|accesskey|headers?|url|uri|path|(?:^|_)(?:file|filename)(?:$|_))/i;

function sanitizeLogFields(fields: ChatVibeClipLogFields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_LOG_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

function logChatVibeClipLifecycle(
  level: ChatVibeClipLogLevel,
  event: string,
  fields: ChatVibeClipLogFields = {},
): void {
  const payload = JSON.stringify({
    scope: "chat_vibe_clip_upload",
    function: "_shared/chat-vibe-clips",
    event,
    ...sanitizeLogFields(fields),
  });

  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.info(payload);
  }
}

function isTerminalChatVibeClipStatus(status: ChatVibeClipStatus): boolean {
  return status === "ready" || status === "failed";
}

function shouldIgnoreProviderStatus(currentStatus: ChatVibeClipStatus, nextStatus: ChatVibeClipStatus): boolean {
  if (currentStatus === "ready" && nextStatus !== "ready") return true;
  if (currentStatus === "failed" && !isTerminalChatVibeClipStatus(nextStatus)) return true;
  return false;
}

export type ChatVibeClipUploadRow = {
  id: string;
  match_id: string;
  sender_id: string;
  client_request_id: string;
  media_asset_id: string | null;
  provider_object_id: string;
  published_message_id: string | null;
  duration_ms: number;
  aspect_ratio: number | string | null;
  source_bytes: number | null;
  mime_type: string | null;
  status: ChatVibeClipStatus;
  error_detail: string | null;
  captions: unknown | null;
  expires_at: string;
};

export type ChatStreamConfig = {
  libraryId: string;
  apiKey: string;
  cdnHostname: string;
  collectionId: string | null;
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function normalizeChatVibeClipCaptions(value: unknown): string | Record<string, unknown> | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text.slice(0, 5_000) : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const text = typeof source.text === "string" && source.text.trim() ? source.text.trim().slice(0, 5_000) : null;
  const language = typeof source.language === "string" && source.language.trim()
    ? source.language.trim().slice(0, 16)
    : undefined;
  const cues = Array.isArray(source.cues)
    ? source.cues.slice(0, 120).map((cue) => {
      if (!cue || typeof cue !== "object" || Array.isArray(cue)) return null;
      const cueRecord = cue as Record<string, unknown>;
      const cueText = typeof cueRecord.text === "string" && cueRecord.text.trim()
        ? cueRecord.text.trim().slice(0, 1_000)
        : null;
      if (!cueText) return null;
      const startMs = typeof cueRecord.startMs === "number" && Number.isFinite(cueRecord.startMs)
        ? Math.max(0, Math.floor(cueRecord.startMs))
        : undefined;
      const endMs = typeof cueRecord.endMs === "number" && Number.isFinite(cueRecord.endMs)
        ? Math.max(startMs ?? 0, Math.floor(cueRecord.endMs))
        : undefined;
      return { text: cueText, ...(startMs !== undefined ? { startMs } : {}), ...(endMs !== undefined ? { endMs } : {}) };
    }).filter((cue): cue is { text: string; startMs?: number; endMs?: number } => !!cue)
    : [];
  if (!text && cues.length === 0) return null;
  return {
    ...(text ? { text } : {}),
    ...(language ? { language } : {}),
    ...(cues.length ? { cues } : {}),
  };
}

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function getChatStreamConfig(): ChatStreamConfig | null {
  const libraryId = Deno.env.get("BUNNY_CHAT_STREAM_LIBRARY_ID")?.trim();
  const apiKey = Deno.env.get("BUNNY_CHAT_STREAM_API_KEY")?.trim();
  const cdnHostname = Deno.env.get("BUNNY_CHAT_STREAM_CDN_HOSTNAME")?.trim();
  if (!libraryId || !apiKey || !cdnHostname) return null;
  return {
    libraryId,
    apiKey,
    cdnHostname: normalizeHostname(cdnHostname),
    collectionId: Deno.env.get("BUNNY_CHAT_STREAM_COLLECTION_ID")?.trim() || null,
  };
}

export function normalizeHostname(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
}

export function normalizeDeclaredVideoMime(mimeType: unknown, fileName: unknown): string | null {
  const declared = typeof mimeType === "string" ? mimeType.split(";")[0].trim().toLowerCase() : "";
  if (SUPPORTED_MIME_TYPES.has(declared)) return declared;

  const name = typeof fileName === "string" ? fileName.trim().toLowerCase() : "";
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return EXTENSION_MIME_TYPES[ext] ?? null;
}

export function validateChatVibeClipCreateInput(input: {
  matchId: unknown;
  clientRequestId: unknown;
  durationMs: unknown;
  sourceBytes: unknown;
  mimeType: unknown;
  fileName: unknown;
}): { ok: true; mimeType: string; durationMs: number; sourceBytes: number | null } | { ok: false; error: string } {
  if (!isUuid(input.matchId)) return { ok: false, error: "invalid_match_id" };
  if (!isUuid(input.clientRequestId)) return { ok: false, error: "client_request_id_required" };

  const durationMs = typeof input.durationMs === "number" ? Math.round(input.durationMs) : Number.NaN;
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > CHAT_VIBE_CLIP_MAX_DURATION_MS + CHAT_VIBE_CLIP_DURATION_TOLERANCE_MS
  ) {
    return { ok: false, error: "duration_too_long" };
  }

  let sourceBytes: number | null = null;
  if (input.sourceBytes != null) {
    sourceBytes = typeof input.sourceBytes === "number" ? Math.round(input.sourceBytes) : Number.NaN;
    if (!Number.isFinite(sourceBytes) || sourceBytes <= 0) return { ok: false, error: "invalid_source_bytes" };
    if (sourceBytes > CHAT_VIBE_CLIP_MAX_SOURCE_BYTES) return { ok: false, error: "source_too_large" };
  }

  const normalizedMime = normalizeDeclaredVideoMime(input.mimeType, input.fileName);
  if (!normalizedMime) return { ok: false, error: "unsupported_video_type" };

  return { ok: true, mimeType: normalizedMime, durationMs, sourceBytes };
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createTusSignature(params: {
  libraryId: string;
  apiKey: string;
  expirationTime: number;
  videoId: string;
}): Promise<string> {
  return sha256Hex(`${params.libraryId}${params.apiKey}${params.expirationTime}${params.videoId}`);
}

export function mapBunnyStatusToChatClipStatus(status: unknown): ChatVibeClipStatus {
  if (status === 3 || status === 4) return "ready";
  if (status === 5 || status === 8) return "failed";
  return "processing";
}

export async function pairIsBlocked(
  admin: SupabaseClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const { data: a, error: aError } = await admin
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userA)
    .eq("blocked_id", userB)
    .maybeSingle();
  if (aError) throw aError;
  if (a?.id) return true;

  const { data: b, error: bError } = await admin
    .from("blocked_users")
    .select("id")
    .eq("blocker_id", userB)
    .eq("blocked_id", userA)
    .maybeSingle();
  if (bError) throw bError;
  return Boolean(b?.id);
}

export async function verifyChatVibeClipMatch(
  admin: SupabaseClient,
  matchId: string,
  senderId: string,
): Promise<
  | { ok: true; recipientId: string }
  | { ok: false; error: "match_not_found" | "access_denied" | "blocked_pair" | "block_check_failed" }
> {
  const { data: match, error } = await admin
    .from("matches")
    .select("id, profile_id_1, profile_id_2")
    .eq("id", matchId)
    .maybeSingle();
  if (error || !match) return { ok: false, error: "match_not_found" };
  if (match.profile_id_1 !== senderId && match.profile_id_2 !== senderId) return { ok: false, error: "access_denied" };

  const recipientId = match.profile_id_1 === senderId ? match.profile_id_2 : match.profile_id_1;
  try {
    if (await pairIsBlocked(admin, senderId, recipientId)) return { ok: false, error: "blocked_pair" };
  } catch {
    return { ok: false, error: "block_check_failed" };
  }
  return { ok: true, recipientId };
}

async function ensureReference(admin: SupabaseClient, params: {
  assetId: string;
  refType: string;
  refTable: string;
  refId: string;
  refKey?: string | null;
}): Promise<void> {
  logChatVibeClipLifecycle("info", "media_reference_lookup_started", {
    asset_id: params.assetId,
    ref_type: params.refType,
    ref_table: params.refTable,
    ref_id: params.refId,
    ref_key: params.refKey ?? null,
  });
  const { data: existing, error } = await admin
    .from("media_references")
    .select("id")
    .eq("asset_id", params.assetId)
    .eq("ref_type", params.refType)
    .eq("ref_table", params.refTable)
    .eq("ref_id", params.refId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    logChatVibeClipLifecycle("error", "media_reference_lookup_failed", {
      asset_id: params.assetId,
      ref_type: params.refType,
      ref_table: params.refTable,
      ref_id: params.refId,
      ref_key: params.refKey ?? null,
      error_code: error.message,
    });
    throw error;
  }
  if (existing?.id) {
    logChatVibeClipLifecycle("info", "media_reference_already_active", {
      asset_id: params.assetId,
      ref_type: params.refType,
      ref_table: params.refTable,
      ref_id: params.refId,
      ref_key: params.refKey ?? null,
      reference_id: String(existing.id),
    });
    return;
  }

  const created = await createMediaReference(admin, params);
  if (!created.success) {
    logChatVibeClipLifecycle("error", "media_reference_create_failed", {
      asset_id: params.assetId,
      ref_type: params.refType,
      ref_table: params.refTable,
      ref_id: params.refId,
      ref_key: params.refKey ?? null,
      error_code: created.error ?? "media_reference_create_failed",
    });
    throw new Error(created.error ?? "media_reference_create_failed");
  }
  logChatVibeClipLifecycle("info", "media_reference_created", {
    asset_id: params.assetId,
    ref_type: params.refType,
    ref_table: params.refTable,
    ref_id: params.refId,
    ref_key: params.refKey ?? null,
  });
}

async function ensureParticipantRetentionReferences(admin: SupabaseClient, upload: ChatVibeClipUploadRow, assetId: string) {
  const { data, error } = await admin.rpc("ensure_chat_media_retention_states_for_match", {
    p_match_id: upload.match_id,
  });
  if (error) {
    logChatVibeClipLifecycle("error", "retention_states_lookup_failed", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      asset_id: assetId,
      provider_object_id: upload.provider_object_id,
      error_code: error.message,
    });
    throw error;
  }
  const rows = Array.isArray(data) ? data as Array<{ state_id?: string; participant_user_key?: string }> : [];
  logChatVibeClipLifecycle("info", "retention_states_loaded", {
    upload_id: upload.id,
    client_request_id: upload.client_request_id,
    match_id: upload.match_id,
    sender_id: upload.sender_id,
    asset_id: assetId,
    provider_object_id: upload.provider_object_id,
    retention_state_count: rows.filter((row) => row.state_id).length,
  });
  for (const row of rows) {
    if (!row.state_id) continue;
    await ensureReference(admin, {
      assetId,
      refType: REF_TYPES.CHAT_PARTICIPANT_RETENTION,
      refTable: "chat_media_retention_states",
      refId: row.state_id,
      refKey: row.participant_user_key ?? null,
    });
  }
  logChatVibeClipLifecycle("info", "retention_references_ensured", {
    upload_id: upload.id,
    client_request_id: upload.client_request_id,
    match_id: upload.match_id,
    sender_id: upload.sender_id,
    asset_id: assetId,
    provider_object_id: upload.provider_object_id,
    retention_state_count: rows.filter((row) => row.state_id).length,
  });
}

export function chatVibeClipPayload(upload: ChatVibeClipUploadRow, status: ChatVibeClipStatus) {
  const videoId = upload.provider_object_id;
  const aspectRatio =
    typeof upload.aspect_ratio === "number"
      ? upload.aspect_ratio
      : typeof upload.aspect_ratio === "string"
        ? Number(upload.aspect_ratio)
        : null;
  const normalizedAspectRatio =
    typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : null;

  const captions = normalizeChatVibeClipCaptions(upload.captions);
  return {
    v: 3,
    kind: "vibe_clip",
    client_request_id: upload.client_request_id,
    provider: "bunny_stream",
    provider_object_id: videoId,
    playback_ref: `bunny_stream:${videoId}`,
    poster_ref: `bunny_stream:${videoId}:thumbnail`,
    thumbnail_url: `bunny_stream:${videoId}:thumbnail`,
    poster_source: "bunny_stream_thumbnail",
    duration_ms: upload.duration_ms,
    aspect_ratio: normalizedAspectRatio,
    processing_status: status,
    upload_provider: "bunny_stream",
    ...(captions ? { captions } : {}),
  };
}

export async function ensureChatVibeClipMessage(
  admin: SupabaseClient,
  upload: ChatVibeClipUploadRow,
  status: ChatVibeClipStatus = "processing",
): Promise<{ success: true; messageId: string; message: Record<string, unknown> } | { success: false; error: string }> {
  logChatVibeClipLifecycle("info", "message_ensure_started", {
    upload_id: upload.id,
    client_request_id: upload.client_request_id,
    match_id: upload.match_id,
    sender_id: upload.sender_id,
    media_asset_id: upload.media_asset_id ?? null,
    provider_object_id: upload.provider_object_id,
    published_message_id: upload.published_message_id ?? null,
    previous_status: upload.status,
    target_status: status,
  });

  const matchCheck = await verifyChatVibeClipMatch(admin, upload.match_id, upload.sender_id);
  if (!matchCheck.ok) {
    logChatVibeClipLifecycle("warn", "message_ensure_match_rejected", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      provider_object_id: upload.provider_object_id,
      error_code: matchCheck.error,
    });
    await admin
      .from("chat_vibe_clip_uploads")
      .update({ status: "failed", error_detail: matchCheck.error })
      .eq("id", upload.id);
    return { success: false, error: matchCheck.error };
  }

  const selectCols =
    "id, match_id, sender_id, content, created_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, structured_payload";

  let message: Record<string, unknown> | null = null;
  const loadIdempotentMessage = async (): Promise<
    { message: Record<string, unknown> | null; error?: string }
  > => {
    const { data, error } = await admin
      .from("messages")
      .select(selectCols)
      .eq("match_id", upload.match_id)
      .eq("sender_id", upload.sender_id)
      .eq("message_kind", "vibe_clip")
      .contains("structured_payload", { client_request_id: upload.client_request_id })
      .maybeSingle();
    if (error) {
      logChatVibeClipLifecycle("error", "idempotent_message_lookup_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        error_code: error.message,
      });
      return { message: null, error: error.message };
    }
    if (data) {
      logChatVibeClipLifecycle("info", "idempotent_message_found", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        message_id: String(data.id),
      });
    }
    return { message: data ? data as Record<string, unknown> : null };
  };

  if (upload.published_message_id) {
    const { data, error } = await admin
      .from("messages")
      .select(selectCols)
      .eq("id", upload.published_message_id)
      .eq("match_id", upload.match_id)
      .eq("sender_id", upload.sender_id)
      .eq("message_kind", "vibe_clip")
      .maybeSingle();
    if (error) {
      logChatVibeClipLifecycle("error", "published_message_lookup_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        message_id: upload.published_message_id,
        error_code: error.message,
      });
      return { success: false, error: error.message };
    }
    if (data) {
      message = data as Record<string, unknown>;
      logChatVibeClipLifecycle("info", "published_message_loaded", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        message_id: String(data.id),
      });
    }
  }

  if (!message) {
    const idempotent = await loadIdempotentMessage();
    if (idempotent.error) return { success: false, error: idempotent.error };
    message = idempotent.message;
  }

  const payload = chatVibeClipPayload(upload, status);

  const updateExistingMessage = async (existingMessage: Record<string, unknown>): Promise<
    { success: true; message: Record<string, unknown> } | { success: false; error: string }
  > => {
    const { data, error } = await admin
      .from("messages")
      .update({
        video_url: payload.playback_ref,
        video_duration_seconds: Math.max(1, Math.round(upload.duration_ms / 1000)),
        structured_payload: {
          ...((existingMessage.structured_payload && typeof existingMessage.structured_payload === "object")
            ? existingMessage.structured_payload as Record<string, unknown>
            : {}),
          ...payload,
        },
      })
      .eq("id", String(existingMessage.id))
      .select(selectCols)
      .single();
    if (error || !data) {
      logChatVibeClipLifecycle("error", "message_update_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        target_status: status,
        message_id: String(existingMessage.id),
        error_code: error?.message ?? "message_update_failed",
      });
      return { success: false, error: error?.message ?? "message_update_failed" };
    }
    logChatVibeClipLifecycle("info", "message_updated", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      provider_object_id: upload.provider_object_id,
      target_status: status,
      message_id: String(data.id),
    });
    return { success: true, message: data as Record<string, unknown> };
  };

  if (!message) {
    const { data, error } = await admin
      .from("messages")
      .insert({
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        content: "🎬 Vibe Clip",
        message_kind: "vibe_clip",
        video_url: payload.playback_ref,
        video_duration_seconds: Math.max(1, Math.round(upload.duration_ms / 1000)),
        structured_payload: payload,
      })
      .select(selectCols)
      .single();
    if (error || !data) {
      const duplicateClientRequest =
        error?.code === "23505" ||
        /duplicate key|idx_messages_outbound_client_request_id/i.test(error?.message ?? "");
      if (duplicateClientRequest) {
        logChatVibeClipLifecycle("warn", "message_insert_duplicate_requery", {
          upload_id: upload.id,
          client_request_id: upload.client_request_id,
          match_id: upload.match_id,
          sender_id: upload.sender_id,
          provider_object_id: upload.provider_object_id,
          target_status: status,
          error_code: error?.message ?? "message_insert_duplicate",
        });
        const recovered = await loadIdempotentMessage();
        if (recovered.error) return { success: false, error: recovered.error };
        if (recovered.message) {
          const updated = await updateExistingMessage(recovered.message);
          if (!updated.success) return updated;
          message = updated.message;
        } else {
          return { success: false, error: "message_insert_duplicate_missing_row" };
        }
      } else {
        logChatVibeClipLifecycle("error", "message_insert_failed", {
          upload_id: upload.id,
          client_request_id: upload.client_request_id,
          match_id: upload.match_id,
          sender_id: upload.sender_id,
          provider_object_id: upload.provider_object_id,
          target_status: status,
          error_code: error?.message ?? "message_insert_failed",
        });
        return { success: false, error: error?.message ?? "message_insert_failed" };
      }
    } else {
      message = data as Record<string, unknown>;
      logChatVibeClipLifecycle("info", "message_inserted", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        target_status: status,
        message_id: String(data.id),
      });
    }
  } else {
    const updated = await updateExistingMessage(message);
    if (!updated.success) return { success: false, error: updated.error };
    message = updated.message;
  }

  if (!message) return { success: false, error: "message_publish_missing" };
  const messageId = String(message.id);
  let assetId = upload.media_asset_id;
  if (!assetId) {
    const registered = await registerMediaAsset(admin, {
      provider: PROVIDERS.BUNNY_STREAM,
      mediaFamily: MEDIA_FAMILIES.CHAT_VIDEO,
      ownerUserId: upload.sender_id,
      providerObjectId: upload.provider_object_id,
      mimeType: upload.mime_type,
      bytes: upload.source_bytes,
      legacyTable: "messages",
      legacyId: messageId,
      status: "active",
    });
    if (!registered.success || !registered.assetId) {
      logChatVibeClipLifecycle("error", "media_asset_register_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        message_id: messageId,
        error_code: registered.error ?? "asset_register_failed",
      });
      return { success: false, error: registered.error ?? "asset_register_failed" };
    }
    assetId = registered.assetId;
    logChatVibeClipLifecycle("info", "media_asset_registered", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      asset_id: assetId,
      provider_object_id: upload.provider_object_id,
      message_id: messageId,
    });
  } else {
    const { error } = await admin
      .from("media_assets")
      .update({
        status: "active",
        legacy_table: "messages",
        legacy_id: messageId,
        owner_user_id: upload.sender_id,
        media_family: MEDIA_FAMILIES.CHAT_VIDEO,
        provider: PROVIDERS.BUNNY_STREAM,
        provider_object_id: upload.provider_object_id,
        mime_type: upload.mime_type,
        bytes: upload.source_bytes,
        deleted_at: null,
        purge_after: null,
        last_error: null,
      })
      .eq("id", assetId);
    if (error) {
      logChatVibeClipLifecycle("error", "media_asset_update_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        asset_id: assetId,
        provider_object_id: upload.provider_object_id,
        message_id: messageId,
        error_code: error.message,
      });
      return { success: false, error: error.message };
    }
    logChatVibeClipLifecycle("info", "media_asset_updated", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      asset_id: assetId,
      provider_object_id: upload.provider_object_id,
      message_id: messageId,
    });
  }

  try {
    await ensureReference(admin, {
      assetId,
      refType: REF_TYPES.MESSAGE_ATTACHMENT,
      refTable: "messages",
      refId: messageId,
      refKey: "video_url",
    });
    await ensureParticipantRetentionReferences(admin, upload, assetId);
  } catch (error) {
    logChatVibeClipLifecycle("error", "media_reference_ensure_failed", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      asset_id: assetId,
      provider_object_id: upload.provider_object_id,
      message_id: messageId,
      error_code: error instanceof Error ? error.message : "media_reference_failed",
    });
    return { success: false, error: error instanceof Error ? error.message : "media_reference_failed" };
  }

  const { error: uploadUpdateError } = await admin
    .from("chat_vibe_clip_uploads")
    .update({
      media_asset_id: assetId,
      published_message_id: messageId,
      status,
      error_detail: status === "failed" ? "bunny_processing_failed" : null,
    })
    .eq("id", upload.id);
  if (uploadUpdateError) {
    logChatVibeClipLifecycle("error", "upload_publish_state_update_failed", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      asset_id: assetId,
      provider_object_id: upload.provider_object_id,
      message_id: messageId,
      target_status: status,
      error_code: uploadUpdateError.message,
    });
    return { success: false, error: uploadUpdateError.message };
  } else {
    logChatVibeClipLifecycle("info", "upload_publish_state_updated", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      asset_id: assetId,
      provider_object_id: upload.provider_object_id,
      message_id: messageId,
      target_status: status,
    });
  }

  return { success: true, messageId, message };
}

export async function updateChatVibeClipStatusByProvider(
  admin: SupabaseClient,
  providerObjectId: string,
  status: ChatVibeClipStatus,
  errorDetail: string | null = null,
  options: { publishIfProcessing?: boolean; failOnIgnoredFailure?: boolean; failOnIgnoredNonReady?: boolean } = {},
): Promise<{ handled: boolean; messageId?: string | null; error?: string; ignoredProviderStatus?: boolean }> {
  logChatVibeClipLifecycle("info", "provider_status_update_started", {
    provider_object_id: providerObjectId,
    target_status: status,
    error_detail: errorDetail ?? null,
    publish_if_processing: options.publishIfProcessing === true,
  });
  const { data, error } = await admin
    .from("chat_vibe_clip_uploads")
    .select("*")
    .eq("provider_object_id", providerObjectId)
    .maybeSingle();
  if (error) {
    logChatVibeClipLifecycle("error", "provider_upload_lookup_failed", {
      provider_object_id: providerObjectId,
      target_status: status,
      error_code: error.message,
    });
    return { handled: false, error: error.message };
  }
  if (!data) {
    logChatVibeClipLifecycle("info", "provider_upload_not_found", {
      provider_object_id: providerObjectId,
      target_status: status,
    });
    return { handled: false };
  }

  const upload = data as ChatVibeClipUploadRow;
  logChatVibeClipLifecycle("info", "provider_upload_loaded", {
    upload_id: upload.id,
    client_request_id: upload.client_request_id,
    match_id: upload.match_id,
    sender_id: upload.sender_id,
    media_asset_id: upload.media_asset_id ?? null,
    provider_object_id: providerObjectId,
    published_message_id: upload.published_message_id ?? null,
    previous_status: upload.status,
    target_status: status,
  });
  if (shouldIgnoreProviderStatus(upload.status, status)) {
    const shouldFailIgnoredStatus = options.failOnIgnoredNonReady
      ? status !== "ready"
      : options.failOnIgnoredFailure && status === "failed";
    const ignoredError = shouldFailIgnoredStatus
      ? errorDetail ?? `ignored_${status}_provider_status`
      : null;
    logChatVibeClipLifecycle("warn", "stale_provider_status_ignored", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      media_asset_id: upload.media_asset_id ?? null,
      provider_object_id: providerObjectId,
      published_message_id: upload.published_message_id ?? null,
      previous_status: upload.status,
      target_status: status,
      error_code: ignoredError,
    });
    return {
      handled: true,
      messageId: upload.published_message_id,
      ignoredProviderStatus: true,
      ...(ignoredError ? { error: ignoredError } : {}),
    };
  }

  const { error: statusUpdateError } = await admin
    .from("chat_vibe_clip_uploads")
    .update({ status, error_detail: errorDetail })
    .eq("id", upload.id);
  if (statusUpdateError) {
    logChatVibeClipLifecycle("error", "provider_status_update_failed", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      media_asset_id: upload.media_asset_id ?? null,
      provider_object_id: providerObjectId,
      previous_status: upload.status,
      target_status: status,
      error_code: statusUpdateError.message,
    });
    return { handled: true, error: statusUpdateError.message };
  } else {
    logChatVibeClipLifecycle("info", "provider_status_updated", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      media_asset_id: upload.media_asset_id ?? null,
      provider_object_id: providerObjectId,
      previous_status: upload.status,
      target_status: status,
    });
  }

  if (status === "processing" && !upload.published_message_id && !options.publishIfProcessing) {
    logChatVibeClipLifecycle("info", "processing_publish_deferred", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      media_asset_id: upload.media_asset_id ?? null,
      provider_object_id: providerObjectId,
      target_status: status,
    });
    return { handled: true, messageId: null };
  }

  if (status === "ready" || status === "processing") {
    const ensured = await ensureChatVibeClipMessage(admin, { ...upload, status }, status);
    if (!ensured.success) {
      logChatVibeClipLifecycle("error", "provider_message_ensure_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        media_asset_id: upload.media_asset_id ?? null,
        provider_object_id: providerObjectId,
        target_status: status,
        error_code: ensured.error,
      });
      return { handled: true, error: ensured.error };
    }
    logChatVibeClipLifecycle("info", "provider_message_ensured", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      media_asset_id: upload.media_asset_id ?? null,
      provider_object_id: providerObjectId,
      target_status: status,
      message_id: ensured.messageId,
    });
    return { handled: true, messageId: ensured.messageId };
  }

  if (upload.published_message_id) {
    const payload = chatVibeClipPayload(upload, "failed");
    const { error: messageUpdateError } = await admin
      .from("messages")
      .update({ structured_payload: payload })
      .eq("id", upload.published_message_id);
    if (messageUpdateError) {
      logChatVibeClipLifecycle("error", "provider_failed_message_update_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        media_asset_id: upload.media_asset_id ?? null,
        provider_object_id: providerObjectId,
        message_id: upload.published_message_id,
        target_status: status,
        error_code: messageUpdateError.message,
      });
      return { handled: true, error: messageUpdateError.message };
    } else {
      logChatVibeClipLifecycle("info", "provider_failed_message_updated", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        media_asset_id: upload.media_asset_id ?? null,
        provider_object_id: providerObjectId,
        message_id: upload.published_message_id,
        target_status: status,
      });
    }
  }

  return { handled: true, messageId: upload.published_message_id };
}
