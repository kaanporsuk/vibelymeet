import test from "node:test";
import assert from "node:assert/strict";

const runtimeEnv = {
  url: process.env.VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
  anonKey: process.env.VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
  eventId: process.env.VIDEO_DATE_PUBLIC_API_RLS_EVENT_ID ?? "",
  userId: process.env.VIDEO_DATE_PUBLIC_API_RLS_USER_ID ?? "",
  otherUserId: process.env.VIDEO_DATE_PUBLIC_API_RLS_OTHER_USER_ID ?? "",
  participantJwt: process.env.VIDEO_DATE_PUBLIC_API_RLS_PARTICIPANT_JWT ?? "",
  nonParticipantJwt: process.env.VIDEO_DATE_PUBLIC_API_RLS_NON_PARTICIPANT_JWT ?? "",
  sessionId: process.env.VIDEO_DATE_PUBLIC_API_RLS_SESSION_ID ?? "",
  terminalSessionId: process.env.VIDEO_DATE_PUBLIC_API_RLS_TERMINAL_SESSION_ID ?? "",
  missingRoomSessionId: process.env.VIDEO_DATE_PUBLIC_API_RLS_MISSING_ROOM_SESSION_ID ?? "",
  otherPaymentEventId: process.env.VIDEO_DATE_PUBLIC_API_RLS_OTHER_PAYMENT_EVENT_ID ?? "",
  otherCheckoutSessionId: process.env.VIDEO_DATE_PUBLIC_API_RLS_OTHER_CHECKOUT_SESSION_ID ?? "",
};

const requiredRuntimeEnv = [
  runtimeEnv.url,
  runtimeEnv.anonKey,
  runtimeEnv.eventId,
  runtimeEnv.userId,
  runtimeEnv.otherUserId,
  runtimeEnv.participantJwt,
  runtimeEnv.nonParticipantJwt,
  runtimeEnv.sessionId,
];
const hasRuntimeEnv = requiredRuntimeEnv.every(Boolean);

type RuntimeResult = {
  data?: unknown;
  error?: { message?: string; code?: string; status?: number; name?: string } | null;
};
type RuntimeClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RuntimeResult>;
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => PromiseLike<RuntimeResult>;
    };
  };
  functions: {
    invoke: (fn: string, options?: { body?: Record<string, unknown> }) => PromiseLike<RuntimeResult>;
  };
};

function hasDeniedError(result: RuntimeResult): boolean {
  const text = `${result.error?.code ?? ""} ${result.error?.status ?? ""} ${result.error?.name ?? ""} ${result.error?.message ?? ""}`;
  return /42501|401|403|permission|denied|forbidden|not authenticated|not_authenticated|access denied|functionshttperror|non-2xx/i.test(text);
}

function assertDenied(result: RuntimeResult, label: string): void {
  if (result.error) {
    assert.equal(hasDeniedError(result), true, `${label} should fail with an auth/permission error`);
    return;
  }
  const payload = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : null;
  assert.equal(payload?.ok, false, `${label} should not return ok`);
  assert.match(String(payload?.error ?? payload?.reason ?? ""), /not_authenticated|not_participant|forbidden|access denied|session_not_active|room_not_ready/i);
}

function assertUnavailable(result: RuntimeResult, label: string): void {
  assert.ok(result.error, `${label} should fail because the RPC is removed`);
  const text = `${result.error?.code ?? ""} ${result.error?.status ?? ""} ${result.error?.name ?? ""} ${result.error?.message ?? ""}`;
  assert.match(text, /404|42883|not found|not exist|could not find|schema cache/i, `${label} should fail as unavailable`);
}

function payloadRecord(result: RuntimeResult): Record<string, unknown> {
  return result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
}

test(
  "runtime public API RLS denies anon/cross-user access and keeps worker tables private",
  {
    skip: hasRuntimeEnv
      ? false
      : "set VIDEO_DATE_PUBLIC_API_RLS_* env vars to run against a seeded linked Supabase project",
  },
  async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(runtimeEnv.url, runtimeEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as RuntimeClient;
    const participant = createClient(runtimeEnv.url, runtimeEnv.anonKey, {
      global: { headers: { Authorization: `Bearer ${runtimeEnv.participantJwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as RuntimeClient;
    const nonParticipant = createClient(runtimeEnv.url, runtimeEnv.anonKey, {
      global: { headers: { Authorization: `Bearer ${runtimeEnv.nonParticipantJwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as RuntimeClient;

    assertDenied(
      await anon.rpc("get_event_deck_v3", {
        p_event_id: runtimeEnv.eventId,
        p_user_id: runtimeEnv.userId,
        p_limit: 1,
      }),
      "anon deck v3",
    );
    assertDenied(
      await participant.rpc("get_event_deck_v3", {
        p_event_id: runtimeEnv.eventId,
        p_user_id: runtimeEnv.otherUserId,
        p_limit: 1,
      }),
      "cross-user deck v3",
    );
    assertUnavailable(
      await participant.rpc("get_video_date_queue_hint_v1", {
        p_event_id: runtimeEnv.eventId,
        p_user_id: runtimeEnv.otherUserId,
      }),
      "removed queue hint",
    );
    assertDenied(
      await anon.rpc("get_event_ticket_payment_status_v1", { p_event_id: runtimeEnv.eventId }),
      "anon payment status",
    );

    for (const table of ["video_date_provider_outbox", "stripe_event_ticket_refunds"]) {
      assertDenied(await anon.from(table).select("id").limit(1), `anon ${table} select`);
      assertDenied(await participant.from(table).select("id").limit(1), `authenticated ${table} select`);
    }

    const nonParticipantToken = await nonParticipant.functions.invoke("video-date-token-refresh", {
      body: { session_id: runtimeEnv.sessionId },
    });
    assertDenied(nonParticipantToken, "non-participant token refresh");

    if (runtimeEnv.terminalSessionId) {
      const terminalToken = await participant.functions.invoke("video-date-token-refresh", {
        body: { session_id: runtimeEnv.terminalSessionId },
      });
      assertDenied(terminalToken, "terminal-session token refresh");
    }

    if (runtimeEnv.missingRoomSessionId) {
      const missingRoomToken = await participant.functions.invoke("video-date-token-refresh", {
        body: { session_id: runtimeEnv.missingRoomSessionId },
      });
      assertDenied(missingRoomToken, "missing-room token refresh");
    }

    if (runtimeEnv.otherPaymentEventId && runtimeEnv.otherCheckoutSessionId) {
      const ownViewOfOtherPaymentEvent = await participant.rpc("get_event_ticket_payment_status_v1", {
        p_event_id: runtimeEnv.otherPaymentEventId,
      });
      assert.equal(
        ownViewOfOtherPaymentEvent.error,
        null,
        `payment status should be caller-scoped and callable: ${ownViewOfOtherPaymentEvent.error?.message ?? "unknown"}`,
      );
      const payload = payloadRecord(ownViewOfOtherPaymentEvent);
      assert.equal(JSON.stringify(payload).includes(runtimeEnv.otherCheckoutSessionId), false);
    }
  },
);
