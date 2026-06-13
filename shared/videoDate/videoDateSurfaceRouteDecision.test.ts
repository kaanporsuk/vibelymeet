import assert from "node:assert/strict";
import test from "node:test";

import { createVideoDateNavigationIntents } from "./navigationIntents";
import {
  decideVideoDateSurfaceRoute,
  type VideoDateRouteSurface,
} from "./routeDecision";
import type { VideoDateRouteSessionTruth } from "../matching/videoDateRouteDecision";

const SESSION_ID = "session-1";
const PROFILE_ID = "user-a";
const EVENT_ID = "event-1";

function truth(
  overrides: Partial<VideoDateRouteSessionTruth> = {},
): VideoDateRouteSessionTruth {
  return {
    id: SESSION_ID,
    event_id: EVENT_ID,
    participant_1_id: PROFILE_ID,
    participant_2_id: "user-b",
    daily_room_name: null,
    daily_room_url: null,
    date_started_at: null,
    ended_at: null,
    ended_reason: null,
    entry_started_at: null,
    phase: null,
    ready_gate_expires_at: null,
    ready_gate_status: null,
    state: null,
    ...overrides,
  };
}

const DATE_CAPABLE = truth({
  state: "entry",
  entry_started_at: new Date().toISOString(),
  daily_room_name: "date-session-1",
  daily_room_url: "https://vibelyapp.daily.co/date-session-1",
});

const READY_GATE_ACTIVE = truth({
  ready_gate_status: "ready",
  ready_gate_expires_at: Date.now() + 60_000,
});

const TERMINAL_SURVEY = truth({
  state: "ended",
  ended_at: new Date().toISOString(),
  ended_reason: "ended_from_client",
  date_started_at: new Date().toISOString(),
  participant_1_joined_at: new Date().toISOString(),
  participant_2_joined_at: new Date().toISOString(),
  participant_1_remote_seen_at: new Date().toISOString(),
  participant_2_remote_seen_at: new Date().toISOString(),
});

const TERMINAL_NO_SURVEY = truth({
  state: "ended",
  ended_at: new Date().toISOString(),
  ended_reason: "ready_gate_expired",
});

const TERMINAL_PROVIDER_ABSENCE_CONFIRMED_DATE = truth({
  state: "ended",
  ended_at: new Date().toISOString(),
  ended_reason: "provider_absence_after_confirmed_encounter",
  date_started_at: new Date().toISOString(),
});

const TERMINAL_DATE_STARTED_ONLY = truth({
  state: "ended",
  ended_at: new Date().toISOString(),
  ended_reason: "completed",
  date_started_at: new Date().toISOString(),
});

function decide(
  surface: VideoDateRouteSurface,
  sessionTruth: VideoDateRouteSessionTruth | null,
  options: {
    intents?: ReturnType<typeof createVideoDateNavigationIntents>;
    routeStateForceSurvey?: boolean;
    queueStatus?: string | null;
    userFeedbackSubmitted?: boolean;
  } = {},
) {
  const intents = options.intents ?? createVideoDateNavigationIntents();
  return {
    intents,
    decision: decideVideoDateSurfaceRoute({
      surface,
      sessionId: SESSION_ID,
      profileId: PROFILE_ID,
      intents,
      routeStateForceSurvey: options.routeStateForceSurvey,
      canonicalInput: {
        eventId: EVENT_ID,
        truth: sessionTruth,
        registration: {
          queue_status: options.queueStatus ?? null,
          current_room_id: SESSION_ID,
          event_id: EVENT_ID,
        },
        userFeedbackSubmitted: options.userFeedbackSubmitted,
      },
    }),
  };
}

test("date-capable truth owns the route: hydration/ready surfaces navigate to date, date surface stays", () => {
  for (const surface of [
    "route_hydration",
    "ready_redirect",
  ] as VideoDateRouteSurface[]) {
    const { decision, intents } = decide(surface, DATE_CAPABLE);
    assert.equal(decision.target, "date");
    assert.equal(decision.navigate, true, surface);
    assert.equal(intents.isVideoDateRouteOwned(SESSION_ID, PROFILE_ID), true);
  }
  const { decision } = decide("date_route", DATE_CAPABLE);
  assert.equal(decision.target, "date");
  assert.equal(decision.navigate, false);
  assert.equal(decision.suppressedBy, "same_route");
});

test("terminal survey truth pins the survey owner with forceSurvey and route ownership", () => {
  const { decision, intents } = decide("route_hydration", TERMINAL_SURVEY);
  assert.equal(decision.target, "survey");
  assert.equal(decision.forceSurvey, true);
  assert.equal(decision.navigate, true);
  assert.equal(intents.isVideoDateRouteOwned(SESSION_ID, PROFILE_ID), true);

  const pinned = decide("route_hydration", TERMINAL_SURVEY, {
    routeStateForceSurvey: true,
  });
  assert.equal(pinned.decision.navigate, false, "already pinned: no re-navigation loop");
  assert.equal(pinned.decision.suppressedBy, "same_route");

  const onDate = decide("date_route", TERMINAL_SURVEY);
  assert.equal(onDate.decision.navigate, false, "date route opens the survey in place");
});

test("provider absence after a confirmed date is survey-due even if remote-seen fields are absent", () => {
  const { decision, intents } = decide(
    "date_route",
    TERMINAL_PROVIDER_ABSENCE_CONFIRMED_DATE,
  );
  assert.equal(decision.target, "survey");
  assert.equal(decision.forceSurvey, true);
  assert.equal(decision.navigate, false);
  assert.equal(decision.reason, "ended_pending_survey");
  assert.equal(intents.isVideoDateRouteOwned(SESSION_ID, PROFILE_ID), true);

  const completed = decide("date_route", TERMINAL_DATE_STARTED_ONLY);
  assert.equal(
    completed.decision.target,
    "ended",
    "generic terminal rows still need encounter exposure beyond date_started_at",
  );

  const ownFeedbackVisible = decide(
    "date_route",
    TERMINAL_PROVIDER_ABSENCE_CONFIRMED_DATE,
    { userFeedbackSubmitted: true },
  );
  assert.equal(ownFeedbackVisible.decision.target, "ended");
});

test("registration in_survey continuity wins even without ended truth", () => {
  const { decision } = decide("route_hydration", DATE_CAPABLE, {
    queueStatus: "in_survey",
  });
  assert.equal(decision.target, "survey");
  assert.equal(decision.forceSurvey, true);
});

test("terminal without survey truth releases the entry latch and stops bouncing", () => {
  const intents = createVideoDateNavigationIntents();
  intents.markVideoDateEntryPipelineStarted(SESSION_ID);
  const { decision } = decide("route_hydration", TERMINAL_NO_SURVEY, { intents });
  assert.equal(decision.target, "ended");
  assert.equal(decision.navigate, false);
  assert.equal(intents.isDateEntryTransitionActive(SESSION_ID), false);
  assert.ok(decision.appliedIntents.includes("entry_latch_cleared"));
});

test("entry latch suppresses ready_gate/lobby bounces while the pipeline is live", () => {
  const intents = createVideoDateNavigationIntents();
  intents.markVideoDateEntryPipelineStarted(SESSION_ID);
  const { decision } = decide("route_hydration", READY_GATE_ACTIVE, { intents });
  assert.equal(decision.target, "date");
  assert.equal(decision.navigate, false);
  assert.equal(decision.suppressedBy, "entry_latch");
  assert.equal(
    intents.isVideoDateRouteOwned(SESSION_ID, PROFILE_ID),
    true,
    "latch suppression re-arms route ownership",
  );
});

test("route ownership suppresses not-startable bounces on the date surface", () => {
  const intents = createVideoDateNavigationIntents();
  intents.markVideoDateRouteOwned(SESSION_ID, PROFILE_ID);
  const { decision } = decide("date_route", READY_GATE_ACTIVE, { intents });
  assert.equal(decision.target, "date");
  assert.equal(decision.navigate, false);
  assert.equal(decision.suppressedBy, "route_ownership");
});

test("ready_redirect with route ownership navigates back to the owned date route", () => {
  const intents = createVideoDateNavigationIntents();
  intents.markVideoDateRouteOwned(SESSION_ID, PROFILE_ID);
  const { decision } = decide("ready_redirect", READY_GATE_ACTIVE, { intents });
  assert.equal(decision.target, "date");
  assert.equal(decision.navigate, true);
  assert.equal(decision.suppressedBy, "route_ownership");
});

test("without suppression, active ready gate routes to ready and clears date intents", () => {
  const intents = createVideoDateNavigationIntents();
  intents.markDateEntryTransition(SESSION_ID, 1_000);
  // Expire the latch so suppression does not apply.
  const expired = createVideoDateNavigationIntents();
  const { decision } = decide("route_hydration", READY_GATE_ACTIVE, {
    intents: expired,
  });
  assert.equal(decision.target, "ready");
  assert.equal(decision.navigate, true);
  assert.ok(decision.appliedIntents.includes("entry_latch_cleared"));
  assert.ok(decision.appliedIntents.includes("route_ownership_cleared"));

  const hosting = decide("ready_redirect", READY_GATE_ACTIVE);
  assert.equal(hosting.decision.target, "ready");
  assert.equal(
    hosting.decision.navigate,
    false,
    "ready_redirect hosts the Ready Gate itself",
  );
});

test("not routeable truth falls back to lobby and clears the latch", () => {
  const { decision } = decide("route_hydration", truth());
  assert.equal(decision.target, "lobby");
  assert.equal(decision.navigate, true);
  assert.equal(decision.canonical?.target, "lobby");
});
