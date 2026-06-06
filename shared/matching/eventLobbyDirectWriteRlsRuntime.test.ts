import test from "node:test";
import assert from "node:assert/strict";

const runtimeEnv = {
  url: process.env.EVENT_LOBBY_RLS_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
  anonKey: process.env.EVENT_LOBBY_RLS_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
  eventId: process.env.EVENT_LOBBY_RLS_EVENT_ID ?? "",
  userId: process.env.EVENT_LOBBY_RLS_USER_ID ?? "",
  participantJwt: process.env.EVENT_LOBBY_RLS_PARTICIPANT_JWT ?? "",
};

const hasRuntimeEnv = Object.values(runtimeEnv).every(Boolean);

type RuntimeResult = {
  data?: unknown;
  error?: { message?: string; code?: string; status?: number; name?: string } | null;
};

function randomUuid(): `${string}-${string}-${string}-${string}-${string}` {
  return crypto.randomUUID();
}

function deniedText(result: RuntimeResult): string {
  return `${result.error?.code ?? ""} ${result.error?.status ?? ""} ${result.error?.name ?? ""} ${result.error?.message ?? ""}`;
}

function assertDenied(result: RuntimeResult, label: string): void {
  assert.ok(result.error, `${label} must fail, not succeed with ${JSON.stringify(result.data)}`);
  assert.match(
    deniedText(result),
    /42501|401|403|permission|denied|forbidden|row-level security|violates row-level security|not authenticated|not_authenticated|access denied|non-2xx/i,
    `${label} should fail at the auth/RLS boundary, got ${deniedText(result)}`,
  );
}

test(
  "runtime Event Lobby RLS denies direct authenticated writes to authority tables",
  {
    skip: hasRuntimeEnv
      ? false
      : "set EVENT_LOBBY_RLS_* env vars to run against a seeded linked Supabase project",
  },
  async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const participant = createClient(runtimeEnv.url, runtimeEnv.anonKey, {
      global: { headers: { Authorization: `Bearer ${runtimeEnv.participantJwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const registrationRead = await participant
      .from("event_registrations")
      .select("id")
      .eq("profile_id", runtimeEnv.userId)
      .limit(1);
    assert.equal(registrationRead.error, null, `own registration SELECT should remain available: ${registrationRead.error?.message ?? ""}`);

    const noRowEventId = randomUuid();
    assertDenied(
      await participant
        .from("event_registrations")
        .update({ last_active_at: new Date().toISOString() })
        .eq("event_id", noRowEventId)
        .eq("profile_id", runtimeEnv.userId),
      "event_registrations direct update",
    );
    assertDenied(
      await participant
        .from("event_registrations")
        .delete()
        .eq("event_id", noRowEventId)
        .eq("profile_id", runtimeEnv.userId),
      "event_registrations direct delete",
    );
    assertDenied(
      await participant
        .from("event_registrations")
        .insert({ event_id: noRowEventId, profile_id: runtimeEnv.userId }),
      "event_registrations direct insert",
    );

    assertDenied(
      await participant.from("event_swipes").insert({
        event_id: randomUuid(),
        actor_id: runtimeEnv.userId,
        target_id: randomUuid(),
        swipe_type: "vibe",
      }),
      "event_swipes direct insert",
    );

    assertDenied(
      await participant.from("video_sessions").insert({
        event_id: randomUuid(),
        participant_1_id: runtimeEnv.userId,
        participant_2_id: randomUuid(),
      }),
      "video_sessions direct insert",
    );

    assertDenied(
      await participant.from("event_deck_card_reservations").insert({
        event_id: randomUuid(),
        viewer_id: runtimeEnv.userId,
        target_id: randomUuid(),
        deck_token: `runtime-denied-${crypto.randomUUID()}`,
        deck_rank: 1,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      "event_deck_card_reservations direct insert",
    );

    assertDenied(
      await participant.from("event_profile_impressions").insert({
        event_id: randomUuid(),
        viewer_id: runtimeEnv.userId,
        target_id: randomUuid(),
        last_action: "dealt",
        source: "runtime_denied_probe",
      }),
      "event_profile_impressions direct insert",
    );

    assertDenied(
      await participant.from("event_profile_impression_events").insert({
        event_id: randomUuid(),
        viewer_id: runtimeEnv.userId,
        target_id: randomUuid(),
        action: "dealt",
        source: "runtime_denied_probe",
      }),
      "event_profile_impression_events direct insert",
    );
  },
);
