import test from "node:test";
import assert from "node:assert/strict";

const runtimeEnv = {
  url:
    process.env.VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "",
  anonKey:
    process.env.VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    "",
  participantJwt:
    process.env.VIDEO_DATE_PUBLIC_API_RLS_PARTICIPANT_JWT ?? "",
  sessionId: process.env.VIDEO_DATE_PUBLIC_API_RLS_SESSION_ID ?? "",
  terminalSessionId:
    process.env.VIDEO_DATE_PUBLIC_API_RLS_TERMINAL_SESSION_ID ?? "",
  missingRoomSessionId:
    process.env.VIDEO_DATE_PUBLIC_API_RLS_MISSING_ROOM_SESSION_ID ?? "",
  markReadySessionId:
    process.env.VIDEO_DATE_PUBLIC_API_RLS_MARK_READY_SESSION_ID ?? "",
};

const hasRuntimeEnv = [
  runtimeEnv.url,
  runtimeEnv.anonKey,
  runtimeEnv.participantJwt,
  runtimeEnv.sessionId,
].every(Boolean);

type JsonRecord = Record<string, unknown>;
type PostgrestRpcResult = {
  fn: string;
  label: string;
  status: number;
  text: string;
  json: unknown;
};

const structuredKeys = [
  "ok",
  "success",
  "error",
  "reason",
  "code",
  "error_code",
  "terminal",
  "retryable",
  "session_id",
  "server_now_ms",
];

function apiUrl(path: string): string {
  return `${runtimeEnv.url.replace(/\/$/, "")}/rest/v1/rpc/${path}`;
}

async function postRpc(
  fn: string,
  args: JsonRecord,
  label: string,
): Promise<PostgrestRpcResult> {
  const response = await fetch(apiUrl(fn), {
    method: "POST",
    headers: {
      apikey: runtimeEnv.anonKey,
      authorization: `Bearer ${runtimeEnv.participantJwt}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { fn, label, status: response.status, text, json };
}

function assertStructuredJson(result: PostgrestRpcResult): void {
  assert.ok(
    result.status < 500,
    `${result.label} should not expose raw 5xx via PostgREST: ${result.status} ${result.text}`,
  );
  assert.ok(
    result.json && typeof result.json === "object" && !Array.isArray(result.json),
    `${result.label} should return structured JSON, got ${result.text}`,
  );
  const payload = result.json as JsonRecord;
  assert.ok(
    structuredKeys.some((key) => key in payload),
    `${result.label} should include a lifecycle JSON discriminator`,
  );
}

function invalidSessionId(): string {
  return "00000000-0000-4000-8000-000000000000";
}

test(
  "PostgREST lifecycle RPCs fail soft with structured JSON for duplicate, terminal, and invalid states",
  {
    skip: hasRuntimeEnv
      ? false
      : "set VIDEO_DATE_PUBLIC_API_RLS_* env vars to run authenticated PostgREST lifecycle probes",
  },
  async () => {
    const runId = `postgrest-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const activeSessionId = runtimeEnv.sessionId;
    const invalidId = invalidSessionId();
    const terminalSessionId = runtimeEnv.terminalSessionId;
    const missingRoomSessionId = runtimeEnv.missingRoomSessionId || invalidId;
    const markReadySessionId = runtimeEnv.markReadySessionId;

    const cases: Array<Promise<PostgrestRpcResult>> = [
      postRpc(
        "claim_video_date_surface",
        {
          p_session_id: activeSessionId,
          p_surface: "postgrest_probe",
          p_client_instance_id: runId,
          p_takeover: false,
          p_ttl_seconds: 5,
        },
        "duplicate surface claim first pass",
      ),
      postRpc(
        "claim_video_date_surface",
        {
          p_session_id: activeSessionId,
          p_surface: "postgrest_probe",
          p_client_instance_id: runId,
          p_takeover: false,
          p_ttl_seconds: 5,
        },
        "duplicate surface claim second pass",
      ),
      postRpc(
        "mark_video_date_daily_alive",
        {
          p_session_id: activeSessionId,
          p_owner_id: "postgrest-probe",
          p_owner_state: "joined",
          p_entry_attempt_id: runId,
          p_call_instance_id: runId,
          p_provider_session_id: `provider-${runId}`,
        },
        "duplicate Daily alive first pass",
      ),
      postRpc(
        "mark_video_date_daily_alive",
        {
          p_session_id: activeSessionId,
          p_owner_id: "postgrest-probe",
          p_owner_state: "joined",
          p_entry_attempt_id: runId,
          p_call_instance_id: runId,
          p_provider_session_id: `provider-${runId}`,
        },
        "duplicate Daily alive second pass",
      ),
      postRpc(
        "video_date_transition",
        {
          p_session_id: activeSessionId,
          p_action: "postgrest_invalid_probe",
          p_reason: runId,
        },
        "invalid transition action",
      ),
      postRpc(
        "video_session_mark_ready_v2",
        {
          p_session_id: invalidId,
          p_idempotency_key: runId,
          p_request_hash: runId,
        },
        "invalid mark-ready session",
      ),
      postRpc(
        "mark_video_date_daily_alive",
        {
          p_session_id: invalidId,
          p_owner_id: "postgrest-probe",
          p_owner_state: "joined",
          p_entry_attempt_id: runId,
          p_call_instance_id: runId,
          p_provider_session_id: `provider-${runId}`,
        },
        "invalid Daily alive session",
      ),
      postRpc(
        "claim_video_date_surface",
        {
          p_session_id: missingRoomSessionId,
          p_surface: "postgrest_probe",
          p_client_instance_id: runId,
          p_takeover: false,
          p_ttl_seconds: 5,
        },
        "invalid or missing-room surface claim",
      ),
      postRpc(
        "video_date_transition",
        {
          p_session_id: invalidId,
          p_action: "join",
          p_reason: runId,
        },
        "invalid transition session",
      ),
    ];

    if (markReadySessionId) {
      cases.push(
        postRpc(
          "video_session_mark_ready_v2",
          {
            p_session_id: markReadySessionId,
            p_idempotency_key: runId,
            p_request_hash: runId,
          },
          "duplicate mark-ready first pass",
        ),
        postRpc(
          "video_session_mark_ready_v2",
          {
            p_session_id: markReadySessionId,
            p_idempotency_key: runId,
            p_request_hash: runId,
          },
          "duplicate mark-ready second pass",
        ),
      );
    }

    if (terminalSessionId) {
      cases.push(
        postRpc(
          "video_session_mark_ready_v2",
          {
            p_session_id: terminalSessionId,
            p_idempotency_key: runId,
            p_request_hash: runId,
          },
          "terminal mark-ready",
        ),
        postRpc(
          "mark_video_date_daily_alive",
          {
            p_session_id: terminalSessionId,
            p_owner_id: "postgrest-probe",
            p_owner_state: "joined",
            p_entry_attempt_id: runId,
            p_call_instance_id: runId,
            p_provider_session_id: `provider-${runId}`,
          },
          "terminal Daily alive",
        ),
        postRpc(
          "claim_video_date_surface",
          {
            p_session_id: terminalSessionId,
            p_surface: "postgrest_probe",
            p_client_instance_id: runId,
            p_takeover: false,
            p_ttl_seconds: 5,
          },
          "terminal surface claim",
        ),
        postRpc(
          "video_date_transition",
          {
            p_session_id: terminalSessionId,
            p_action: "join",
            p_reason: runId,
          },
          "terminal transition",
        ),
      );
    }

    const results = await Promise.all(cases);
    for (const result of results) {
      assertStructuredJson(result);
    }
  },
);
