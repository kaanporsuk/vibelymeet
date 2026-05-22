// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function hmacSha256Base64(secretBytes: Uint8Array, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
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

function hasSecretishKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return key.toLowerCase().includes("token") ||
    key.toLowerCase().includes("secret") ||
    normalized.includes("apikey");
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

  let payload: JsonObject;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isObject(parsed)) {
      return json({ ok: false, error: "payload_must_be_object" }, 400);
    }
    payload = parsed;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (isDailyVerificationProbe(payload)) {
    return json({ ok: true, test: true });
  }

  const providerEventId = providerEventIdFromPayload(payload);
  const eventType = eventTypeFromPayload(payload);
  if (!providerEventId || !eventType) {
    return json({ ok: false, error: "provider_event_id_or_type_missing" }, 400);
  }

  const roomName = roomNameFromPayload(payload);
  let data: Record<string, unknown> | null = null;
  try {
    const supabase = createServiceClient();
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
    return json({ ok: false, error: "webhook_record_failed" }, 500);
  }

  if (data?.ok === false) {
    return json({ ok: false, error: data.error ?? "webhook_rejected" }, 400);
  }

  return json({
    ok: true,
    duplicate: data?.duplicate === true,
    state: data?.state ?? data?.processingState ?? null,
    result: data?.result ?? data?.processingResult ?? null,
  });
});
