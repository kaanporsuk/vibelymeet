import test from "node:test";
import assert from "node:assert/strict";

const runtimeEnv = {
  url: process.env.VIDEO_DATE_RLS_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
  anonKey: process.env.VIDEO_DATE_RLS_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
  sessionId: process.env.VIDEO_DATE_RLS_SESSION_ID ?? "",
  participantJwt: process.env.VIDEO_DATE_RLS_PARTICIPANT_JWT ?? "",
  nonParticipantJwt: process.env.VIDEO_DATE_RLS_NON_PARTICIPANT_JWT ?? "",
};

const hasRuntimeEnv = Object.values(runtimeEnv).every(Boolean);

async function subscribeStatus(jwt: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(runtimeEnv.url, runtimeEnv.anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const channel = client.channel(`session:${runtimeEnv.sessionId}`, {
    config: { private: true },
  });
  const result = await new Promise<{ status: string; error: unknown }>((resolve) => {
    const timeout = setTimeout(() => resolve({ status: "TIMED_OUT", error: null }), 8_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        resolve({ status, error: error ?? null });
      }
    });
  });
  await client.removeChannel(channel);
  return result;
}

test(
  "runtime Realtime RLS allows only session participants on private session channels",
  { skip: hasRuntimeEnv ? false : "set VIDEO_DATE_RLS_* env vars to run against a synthetic linked Supabase project" },
  async () => {
    const participant = await subscribeStatus(runtimeEnv.participantJwt);
    assert.equal(participant.status, "SUBSCRIBED");

    const nonParticipant = await subscribeStatus(runtimeEnv.nonParticipantJwt);
    assert.notEqual(nonParticipant.status, "SUBSCRIBED");
    assert.match(`${nonParticipant.status} ${String(nonParticipant.error ?? "")}`, /CHANNEL_ERROR|TIMED_OUT|CLOSED|ACCESS_DENIED|403/i);
  },
);
