// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp",
};

const SIGNATURE_HEADER = "x-webhook-signature";
const TIMESTAMP_HEADER = "x-webhook-timestamp";
const MAX_TIMESTAMP_SKEW_MS = 2 * 60 * 1000;

type JsonObject = Record<string, unknown>;
type SupabaseRpcError = { code?: string; message: string };
type SupabaseServiceClient = {
  rpc: (
    functionName: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: JsonObject | null; error: SupabaseRpcError | null }>;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function base64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function hmacSha256Base64(secretBytes: Uint8Array, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secretBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return base64(signature);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hex(digest);
}

function timestampMillis(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric > 10_000_000_000) return Math.trunc(numeric);
  return Math.trunc(numeric * 1000);
}

async function verifyDailySignature(req: Request, rawBody: string): Promise<
  {
    ok: true;
    timestamp: Date;
  } | {
    ok: false;
    status: number;
    error: string;
    skewMs?: number;
  }
> {
  const webhookSecret = Deno.env.get("DAILY_WEBHOOK_SECRET")?.trim();
  if (!webhookSecret) {
    return { ok: false, status: 503, error: "webhook_secret_missing" };
  }
  const webhookSecretBytes = base64ToBytes(webhookSecret);
  if (!webhookSecretBytes) {
    return { ok: false, status: 503, error: "webhook_secret_invalid" };
  }

  const timestampHeader = req.headers.get(TIMESTAMP_HEADER);
  const timestampMs = timestampMillis(timestampHeader);
  if (timestampMs == null) {
    return { ok: false, status: 401, error: "timestamp_missing" };
  }

  const skewMs = Math.abs(Date.now() - timestampMs);
  if (skewMs > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, status: 401, error: "timestamp_out_of_range", skewMs };
  }

  const expected = await hmacSha256Base64(
    webhookSecretBytes,
    `${timestampHeader}.${rawBody}`,
  );
  const received = req.headers.get(SIGNATURE_HEADER)?.trim() ?? null;
  if (!received || !safeEqual(received, expected)) {
    return { ok: false, status: 401, error: "signature_invalid" };
  }

  return { ok: true, timestamp: new Date(timestampMs) };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function isDailyVerificationProbe(payload: JsonObject): boolean {
  return payload.test === "test" && Object.keys(payload).length === 1;
}

const SECRETISH_EXACT_KEYS = new Set([
  "password",
  "authorization",
  "authheader",
  "jwt",
  "servicerole",
  "safetydetails",
  "safetyreason",
  "reportreason",
  "reportdetails",
  "idempotencykey",
  "dailytoken",
  "meetingtoken",
  "accesstoken",
  "refreshtoken",
]);

function hasSecretishKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[^a-z0-9]+/g, "");
  return lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("bearer") ||
    normalized.includes("apikey") ||
    SECRETISH_EXACT_KEYS.has(normalized);
}

function sanitizeWebhookPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWebhookPayload(item));
  }
  if (!isObject(value)) return value;

  const sanitized: JsonObject = {};
  const redactedFields: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (hasSecretishKey(key)) {
      redactedFields.push(key);
      continue;
    }
    sanitized[key] = sanitizeWebhookPayload(child);
  }
  if (redactedFields.length > 0) {
    sanitized.redacted_fields = redactedFields;
  }
  return sanitized;
}

function sanitizedPayloadObject(value: unknown, payloadHash: string): JsonObject {
  const sanitized = sanitizeWebhookPayload(value);
  if (isObject(sanitized)) return sanitized;
  return {
    raw_body_sha256: payloadHash,
    payload_type: Array.isArray(value) ? "array" : typeof value,
  };
}

function rawBodyDlqPayload(rawBody: string, payloadHash: string): JsonObject {
  return {
    raw_body_sha256: payloadHash,
    raw_body_bytes: new TextEncoder().encode(rawBody).byteLength,
  };
}

function nestedObject(root: JsonObject, ...path: string[]): JsonObject | null {
  let current: unknown = root;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = current[key];
  }
  return asObject(current);
}

function nestedString(root: JsonObject, ...path: string[]): string | null {
  let current: unknown = root;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = current[key];
  }
  return asString(current);
}

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    const stringValue = asString(value);
    if (stringValue) return stringValue;
  }
  return null;
}

function roomNameFromPayload(payload: JsonObject): string | null {
  const nestedPayload = asObject(payload.payload);
  const room = asObject(payload.room);
  const payloadRoom = nestedPayload ? asObject(nestedPayload.room) : null;
  const properties = asObject(payload.properties);
  const payloadProperties = nestedPayload
    ? asObject(nestedPayload.properties)
    : null;

  return firstString(
    payload.room_name,
    payload.roomName,
    payload.room,
    room?.name,
    nestedPayload?.room_name,
    nestedPayload?.roomName,
    nestedPayload?.room,
    payloadRoom?.name,
    properties?.room_name,
    properties?.roomName,
    payloadProperties?.room_name,
    payloadProperties?.roomName,
  );
}

function eventTypeFromPayload(payload: JsonObject): string | null {
  return firstString(
    payload.type,
    payload.event_type,
    payload.eventType,
    payload.event,
    nestedString(payload, "payload", "type"),
    nestedString(payload, "payload", "event_type"),
    nestedString(payload, "payload", "eventType"),
  );
}

function providerEventIdFromPayload(payload: JsonObject): string | null {
  return firstString(
    payload.id,
    payload.event_id,
    payload.eventId,
    nestedString(payload, "event", "id"),
    nestedString(payload, "payload", "id"),
    nestedString(payload, "payload", "event_id"),
    nestedString(payload, "payload", "eventId"),
  );
}

function participantObject(payload: JsonObject): JsonObject | null {
  return (
    asObject(payload.participant) ??
      nestedObject(payload, "payload", "participant") ??
      nestedObject(payload, "data", "participant")
  );
}

function participantProviderId(payload: JsonObject): string | null {
  const participant = participantObject(payload);
  return firstString(
    participant?.id,
    participant?.session_id,
    participant?.sessionId,
    payload.participant_id,
    payload.participantId,
    nestedString(payload, "payload", "participant_id"),
    nestedString(payload, "payload", "participantId"),
    // Daily's live participant.* events carry the participant session id at
    // payload.payload.session_id (no participant object); mirrors the tail of
    // public.video_date_daily_provider_session_id_from_event_v1 so the stored
    // column equals what that extractor already derives from the raw payload.
    nestedString(payload, "payload", "session_id"),
    nestedString(payload, "payload", "sessionId"),
  );
}

function participantUserId(payload: JsonObject): string | null {
  const participant = participantObject(payload);
  return firstString(
    participant?.user_id,
    participant?.userId,
    payload.user_id,
    payload.userId,
    nestedString(payload, "payload", "user_id"),
    nestedString(payload, "payload", "userId"),
  );
}

function parseProviderTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      return new Date(millis).toISOString();
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  return null;
}

function occurredAtFromPayload(payload: JsonObject, fallback: Date): string {
  return (
    parseProviderTimestamp(payload.created_at) ??
      parseProviderTimestamp(payload.createdAt) ??
      parseProviderTimestamp(payload.timestamp) ??
      parseProviderTimestamp(payload.event_ts) ??
      parseProviderTimestamp(nestedString(payload, "payload", "created_at")) ??
      parseProviderTimestamp(nestedString(payload, "payload", "timestamp")) ??
      fallback.toISOString()
  );
}

function createServiceClient(): SupabaseServiceClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("supabase_service_env_missing");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SupabaseServiceClient;
}

async function recordWebhookSecurityMetric(params: {
  error: string;
  status: number;
  latencyMs: number;
  skewMs?: number;
}) {
  try {
    const supabase = createServiceClient();
    await supabase.rpc("record_event_loop_observability", {
      p_operation: "video_date_daily_webhook",
      p_outcome: "blocked",
      p_reason_code: params.error === "timestamp_out_of_range"
        ? "signature_rejected_stale"
        : "signature_rejected",
      p_latency_ms: params.latencyMs,
      p_event_id: null,
      p_actor_id: null,
      p_session_id: null,
      p_detail: {
        status: params.status,
        error: params.error,
        skew_ms: typeof params.skewMs === "number" ? Math.trunc(params.skewMs) : null,
        max_timestamp_skew_ms: MAX_TIMESTAMP_SKEW_MS,
      },
    });
  } catch {
    // Signature failures must fail closed even if telemetry is unavailable.
  }
}

async function recordWebhookDlq(
  supabase: SupabaseServiceClient | null,
  params: {
    payloadHash: string;
    sanitizedPayload: JsonObject;
    errorClass: string;
    errorMessage?: string | null;
    retryable?: boolean;
    providerEventId?: string | null;
    eventType?: string | null;
    roomName?: string | null;
    signatureTimestamp?: Date | null;
  },
): Promise<void> {
  try {
    const client = supabase ?? createServiceClient();
    const { data, error } = await client.rpc("record_video_date_webhook_dlq_v1", {
      p_provider: "daily",
      p_provider_event_id: params.providerEventId ?? null,
      p_event_type: params.eventType ?? null,
      p_room_name: params.roomName ?? null,
      p_payload_hash: params.payloadHash,
      p_sanitized_payload: params.sanitizedPayload,
      p_error_class: params.errorClass,
      p_error_message: params.errorMessage ?? null,
      p_retryable: params.retryable === true,
      p_signature_timestamp: params.signatureTimestamp?.toISOString() ?? null,
    });
    if (error) {
      console.error(
        "video-date-daily-webhook dlq_error",
        JSON.stringify({
          errorClass: params.errorClass,
          providerEventId: params.providerEventId ?? null,
          code: error.code,
          message: error.message,
        }),
      );
      return;
    }
    if (data?.ok === false) {
      console.error(
        "video-date-daily-webhook dlq_rejected",
        JSON.stringify({
          errorClass: params.errorClass,
          providerEventId: params.providerEventId ?? null,
          rejection: typeof data.error === "string" ? data.error : "unknown_error",
        }),
      );
    }
  } catch (error) {
    console.error(
      "video-date-daily-webhook dlq_unavailable",
      JSON.stringify({
        errorClass: params.errorClass,
        providerEventId: params.providerEventId ?? null,
        message: error instanceof Error ? error.message : "unknown_error",
      }),
    );
  }
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const rawBody = await req.text();
  const signature = await verifyDailySignature(req, rawBody);
  if (!signature.ok) {
    if (signature.error === "timestamp_out_of_range") {
      await recordWebhookSecurityMetric({
        error: signature.error,
        status: signature.status,
        latencyMs: Date.now() - startedAt,
        skewMs: signature.skewMs,
      });
    }
    return json({ ok: false, error: signature.error }, signature.status);
  }

  const payloadHash = await sha256Hex(rawBody);
  let payload: JsonObject;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isObject(parsed)) {
      await recordWebhookDlq(null, {
        payloadHash,
        sanitizedPayload: rawBodyDlqPayload(rawBody, payloadHash),
        errorClass: "payload_must_be_object",
        errorMessage: "Daily webhook payload root was not a JSON object",
        signatureTimestamp: signature.timestamp,
      });
      return json({ ok: false, error: "payload_must_be_object" }, 400);
    }
    payload = parsed;
  } catch {
    await recordWebhookDlq(null, {
      payloadHash,
      sanitizedPayload: rawBodyDlqPayload(rawBody, payloadHash),
      errorClass: "invalid_json",
      errorMessage: "Daily webhook payload could not be parsed as JSON",
      signatureTimestamp: signature.timestamp,
    });
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (isDailyVerificationProbe(payload)) {
    return json({ ok: true, test: true });
  }

  const providerEventId = providerEventIdFromPayload(payload);
  const eventType = eventTypeFromPayload(payload);
  if (!providerEventId || !eventType) {
    await recordWebhookDlq(null, {
      payloadHash,
      sanitizedPayload: sanitizedPayloadObject(payload, payloadHash),
      errorClass: "provider_event_id_or_type_missing",
      errorMessage: "Daily webhook payload was missing provider event id or event type",
      providerEventId,
      eventType,
      roomName: roomNameFromPayload(payload),
      signatureTimestamp: signature.timestamp,
    });
    return json({ ok: false, error: "provider_event_id_or_type_missing" }, 400);
  }

  const roomName = roomNameFromPayload(payload);
  const sanitizedPayload = sanitizedPayloadObject(payload, payloadHash);
  let data: Record<string, unknown> | null = null;
  let supabase: SupabaseServiceClient | null = null;
  try {
    supabase = createServiceClient();
    const result = await supabase.rpc(
      "record_video_date_daily_webhook_event_v2",
      {
        p_provider_event_id: providerEventId,
        p_event_type: eventType,
        p_room_name: roomName,
        p_provider_participant_id: participantProviderId(payload),
        p_provider_user_id: participantUserId(payload),
        p_occurred_at: occurredAtFromPayload(payload, signature.timestamp),
        p_payload: sanitizeWebhookPayload(payload),
        p_signature_timestamp: signature.timestamp.toISOString(),
      },
    );

    if (result.error) {
      console.error(
        "video-date-daily-webhook db_error",
        JSON.stringify({
          eventType,
          roomName,
          code: result.error.code,
          message: result.error.message,
        }),
      );
      await recordWebhookDlq(supabase, {
        payloadHash,
        sanitizedPayload,
        errorClass: "webhook_record_failed",
        errorMessage: result.error.message,
        retryable: true,
        providerEventId,
        eventType,
        roomName,
        signatureTimestamp: signature.timestamp,
      });
      return json({ ok: false, error: "webhook_record_failed" }, 500);
    }

    data = result.data;
  } catch (error) {
    console.error(
      "video-date-daily-webhook handler_error",
      JSON.stringify({
        eventType,
        roomName,
        message: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    await recordWebhookDlq(supabase, {
      payloadHash,
      sanitizedPayload,
      errorClass: "webhook_record_failed",
      errorMessage: error instanceof Error ? error.message : "unknown_error",
      retryable: true,
      providerEventId,
      eventType,
      roomName,
      signatureTimestamp: signature.timestamp,
    });
    return json({ ok: false, error: "webhook_record_failed" }, 500);
  }

  if (data?.ok === false) {
    const error = typeof data.error === "string"
      ? data.error
      : "webhook_rejected";
    await recordWebhookDlq(supabase, {
      payloadHash,
      sanitizedPayload,
      errorClass: error,
      errorMessage: error,
      providerEventId,
      eventType,
      roomName,
      signatureTimestamp: signature.timestamp,
    });
    return json({ ok: false, error }, 400);
  }

  return json({
    ok: true,
    duplicate: data?.duplicate === true,
    state: data?.state ?? data?.processingState ?? null,
    result: data?.result ?? data?.processingResult ?? null,
  });
});
