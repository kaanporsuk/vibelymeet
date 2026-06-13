import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOBBY_FOREGROUND_STAMP_FLOOR_MS,
  lobbyForegroundStampKey,
  resetLobbyForegroundStampThrottle,
  shouldStampLobbyForeground,
} from "./lobbyForegroundStampThrottle";

// 2026-06-12 acceptance-run follow-ups (tag vd-accept-20260612-297055).
// Pins the four fixes so they cannot silently regress:
//   1a. video_date_transition's terminal in_survey re-stamp is feedback-guarded.
//   1b. clients release a feedback-complete registration instead of looping
//       lobby <-> /date (plus the lobby forced-survey re-navigation damper).
//   2.  the Daily webhook maps the participant session id from the real
//       nested payload shape into provider_participant_id.
//   3.  benign notification.send failures classify non-paging in the single
//       alert path.
//   4.  mark_lobby_foreground is floor-throttled on both platforms.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const transitionGuardMigration = read(
  "supabase/migrations/20260612211818_vd_accept_followup_transition_survey_feedback_guard.sql",
);
const transitionHeadFixture = read(
  "supabase/contract-fixtures/2026-06/functions/public-heads/video_date_transition.sql",
);
const alertsMigration = read(
  "supabase/migrations/20260612212014_vd_accept_followup_benign_notification_failures_non_paging.sql",
);
const dailyWebhook = read("supabase/functions/video-date-daily-webhook/index.ts");
const webTerminalRecovery = read("src/pages/videoDate/useTerminalSurveyRecovery.ts");
const webLobby = read("src/pages/EventLobby.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");

test("1a: transition terminal in_survey stamp carries the pair feedback guard (migration + live fixture)", () => {
  for (const [label, source] of [
    ["migration", transitionGuardMigration],
    ["fixture", transitionHeadFixture],
  ] as const) {
    assert.match(
      source,
      /v_survey_feedback_complete := v_should_open_survey\s+AND EXISTS \(\s*SELECT 1\s+FROM public\.date_feedback df1/,
      `${label} computes the pair feedback-complete guard`,
    );
    assert.match(
      source,
      /IF v_should_open_survey AND NOT v_survey_feedback_complete THEN/,
      `${label} stamps in_survey only while a verdict is still missing`,
    );
    assert.match(
      source,
      /'terminal_survey_already_complete'/,
      `${label} records guard activations with a distinct observability reason`,
    );
    assert.match(
      source,
      /jsonb_build_object\('survey_required', v_should_open_survey AND NOT v_survey_feedback_complete\)/,
      `${label} reports the guarded survey_required in the transition result`,
    );
  }
});

test("1b: web terminal recovery releases a feedback-complete registration before bouncing", () => {
  const releaseStart = webTerminalRecovery.indexOf(
    "terminal_survey_complete_registration_release",
  );
  assert.notEqual(releaseStart, -1, "release breadcrumb present");
  assert.match(
    webTerminalRecovery,
    /const releaseFeedbackCompleteRegistration = useCallback\([\s\S]+?update_participant_status[\s\S]+?p_status: "browsing"/,
    "release goes through the canonical own-row RPC",
  );
  assert.match(
    webTerminalRecovery,
    /leaveFeedbackCompleteTerminalSurvey\(source, sessionRow, \{\s*releaseRegistration: Boolean\(verdict\?\.id\),\s*\}\)/,
    "terminal-session release remains verdict-gated",
  );
});

test("1b: native terminal recovery mirrors the verdict-gated release", () => {
  assert.match(
    nativeDateRoute,
    /ownVerdict\?\.id[\s\S]+?update_participant_status[\s\S]+?p_status: "browsing"/,
    "native bounce branch releases via update_participant_status when own verdict exists",
  );
  assert.match(nativeDateRoute, /terminal_survey_complete_registration_release/);
});

test("1b: both lobbies damp same-session forced-survey re-navigation", () => {
  for (const [label, source] of [
    ["web", webLobby],
    ["native", nativeLobby],
  ] as const) {
    assert.match(
      source,
      /FORCED_SURVEY_RENAVIGATION_DAMPER_MS = 10_000/,
      `${label} declares the damper window`,
    );
    assert.match(
      source,
      /lobby_forced_survey_renavigation_damped/,
      `${label} logs damped re-navigations`,
    );
    assert.match(
      source,
      /forcedSurveyNavigationRef\.current = \{\s*sessionId[\s\S]{0,40}atMs: nowMs,?\s*\}/,
      `${label} records the last forced-survey navigation`,
    );
  }
});

test("2: Daily webhook maps the nested participant session id into provider_participant_id", () => {
  const fnStart = dailyWebhook.indexOf("function participantProviderId(");
  assert.notEqual(fnStart, -1);
  const fnBody = dailyWebhook.slice(fnStart, dailyWebhook.indexOf("\n}", fnStart));
  assert.match(
    fnBody,
    /nestedString\(payload, "payload", "session_id"\)/,
    "reads Daily's payload.payload.session_id (the real participant.* shape)",
  );
  assert.match(fnBody, /nestedString\(payload, "payload", "sessionId"\)/);
  assert.match(
    fnBody,
    /video_date_daily_provider_session_id_from_event_v1/,
    "documents the DB extractor the mapping mirrors",
  );
});

test("3: benign notification.send failures classify non-paging in the single alert path", () => {
  assert.match(
    alertsMigration,
    /CREATE OR REPLACE VIEW public\.vw_video_date_lease_recovery_health/,
  );
  assert.match(
    alertsMigration,
    /CREATE OR REPLACE VIEW public\.vw_video_date_recovery_alerts/,
  );
  assert.match(
    alertsMigration,
    /o\.kind = 'notification\.send'::text\s+AND o\.last_error = ANY \(ARRAY\['notification_no_preferences'::text, 'notification_no_player_id'::text\]\)/,
    "benign set is exactly the two known no-recipient reasons",
  );
  assert.match(
    alertsMigration,
    /WHEN \(\(h\.failed_count - h\.benign_failed_count\) > 0 OR h\.expired_lease_count > 5\) THEN 'page'::text/,
    "page severity requires non-benign failures",
  );
  assert.match(
    alertsMigration,
    /'benignFailedCount', h\.benign_failed_count/,
    "details expose the benign count",
  );
  assert.match(
    alertsMigration,
    /REVOKE ALL ON public\.vw_video_date_recovery_alerts FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    alertsMigration,
    /GRANT SELECT ON public\.vw_video_date_recovery_alerts TO service_role/,
  );
});

test("4: both lobby foreground stampers run behind the shared floor throttle", () => {
  for (const [label, source] of [
    ["web", webLobby],
    ["native", nativeLobby],
  ] as const) {
    assert.match(
      source,
      /from "@clientShared\/matching\/lobbyForegroundStampThrottle"/,
      `${label} imports the shared throttle`,
    );
    assert.match(
      source,
      /if \(!shouldStampLobbyForeground\(stampKey\)\) return;[\s\S]{0,200}mark_lobby_foreground/,
      `${label} consults the floor before the RPC`,
    );
  }
});

test("4: throttle floor suppresses bursts and re-admits after the window", () => {
  resetLobbyForegroundStampThrottle();
  const key = lobbyForegroundStampKey("user-1", "event-1");
  const otherKey = lobbyForegroundStampKey("user-1", "event-2");
  const t0 = 1_000_000;
  assert.equal(shouldStampLobbyForeground(key, t0), true, "first call passes");
  assert.equal(shouldStampLobbyForeground(key, t0 + 500), false, "burst suppressed");
  assert.equal(
    shouldStampLobbyForeground(key, t0 + LOBBY_FOREGROUND_STAMP_FLOOR_MS - 1),
    false,
    "still inside the floor",
  );
  assert.equal(shouldStampLobbyForeground(otherKey, t0 + 600), true, "keys are independent");
  assert.equal(
    shouldStampLobbyForeground(key, t0 + LOBBY_FOREGROUND_STAMP_FLOOR_MS),
    true,
    "re-admitted at the floor boundary",
  );
  assert.ok(
    LOBBY_FOREGROUND_STAMP_FLOOR_MS < 30_000,
    "floor stays below the 30s interval so periodic stamps are never starved",
  );
  resetLobbyForegroundStampThrottle();
});

// ---- Round 2 (2026-06-12, same acceptance-run lineage) ----------------------

const releasePointerMigration = read(
  "supabase/migrations/20260612221535_vd_accept2_release_clears_terminal_room_pointer.sql",
);
const perParticipantMigration = read(
  "supabase/migrations/20260612221536_vd_accept2_per_participant_survey_stamp.sql",
);
const reasonRenameMigration = read(
  "supabase/migrations/20260612221537_vd_accept2_lobby_foreground_reason_rename.sql",
);
const backfillMigration = read(
  "supabase/migrations/20260612221538_vd_accept2_backfill_webhook_provider_participant_id.sql",
);
const remoteSeenFixture = read(
  "supabase/contract-fixtures/2026-06/functions/public-heads/mark_video_date_remote_seen.sql",
);

test("2a: releasing onto a terminal session clears the stale room pointer", () => {
  assert.match(releasePointerMigration, /v_clear_room boolean := false/);
  assert.match(
    releasePointerMigration,
    /current_room_id = CASE WHEN v_clear_room THEN NULL ELSE current_room_id END/,
  );
  assert.match(
    releasePointerMigration,
    /vs\.ended_at IS NOT NULL\s+OR vs\.state::text = 'ended'/,
  );
});

const releaseGuardPassthroughMigration = read(
  "supabase/migrations/20260613131415_vd_release_guard_passthrough_terminal_room_pointer.sql",
);

test("2a-followup: the in-gate release guard falls through once the session is terminal (PR #1316 review)", () => {
  // The first guard must block a self-downgrade only while the session is LIVE.
  // Without the terminal NOT EXISTS exclusion an in_ready_gate/in_entry/in_date
  // registration pointing at an ended session never reaches v_clear_room — the
  // exact stale-pointer trap 2a set out to clear. Pin the passthrough so a
  // later body recreate cannot silently drop it.
  assert.match(
    releaseGuardPassthroughMigration,
    /v_current_status IN \('in_ready_gate', 'in_entry', 'in_date'\)[\s\S]{0,200}AND NOT EXISTS \([\s\S]{0,240}vs\.ended_at IS NOT NULL[\s\S]{0,80}OR vs\.state::text = 'ended'/,
    "first guard must carry the terminal-session NOT EXISTS passthrough",
  );
  assert.match(
    releaseGuardPassthroughMigration,
    /current_room_id = CASE WHEN v_clear_room THEN NULL ELSE current_room_id END/,
    "recreated body preserves the v_clear_room clear-pointer contract",
  );
});

test("2b: survey stamps are per-participant (own verdict blocks own re-stamp)", () => {
  const perRowGuard = /df_row\.user_id = event_registrations\.profile_id/;
  assert.match(perParticipantMigration, perRowGuard);
  assert.equal(
    (perParticipantMigration.match(/df_row\.user_id = event_registrations\.profile_id/g) ?? []).length,
    3,
    "all three stamp sites carry the per-row guard (transition deep + outer, remote_seen)",
  );
  assert.match(transitionHeadFixture, perRowGuard);
  assert.match(remoteSeenFixture, perRowGuard);
});

test("2d: terminal-recovery release retries transient failures on both platforms", () => {
  assert.match(
    webTerminalRecovery,
    /for \(let attempt = 0; attempt < 3; attempt \+= 1\)[\s\S]{0,400}update_participant_status/,
  );
  assert.match(
    nativeDateRoute,
    /for \(let attemptIdx = 0; attemptIdx < 3; attemptIdx \+= 1\)[\s\S]{0,500}update_participant_status/,
  );
});

test("2e/2g: backfill uses the canonical extractor; foreground reason is renamed", () => {
  assert.match(
    backfillMigration,
    /SET provider_participant_id = public\.video_date_daily_provider_session_id_from_event_v1\(/,
  );
  assert.match(reasonRenameMigration, /'lobby_foreground_stamped',/);
  assert.doesNotMatch(reasonRenameMigration.split("-- ")
    .filter((s) => !s.startsWith("VD ") && !s.includes("vestigial")).join("-- "),
    /'queued_auto_promotion_removed',/);
});

test("4a/4b: live-gate harness and fixture drift checker are committed and wired", () => {
  const harness = read("scripts/video-date-live-gate.mjs");
  const drift = read("scripts/check-contract-fixture-drift.mjs");
  const pkg = read("package.json");
  assert.match(harness, /vd-gate-/);
  assert.match(harness, /zero-residue/);
  assert.match(harness, /--stale-stamp-check/);
  assert.match(drift, /DROPPED_HISTORY/);
  assert.match(drift, /pg_get_functiondef/);
  assert.match(pkg, /"livegate:video-date":/);
  assert.match(pkg, /"check:contract-fixture-drift":/);
});
