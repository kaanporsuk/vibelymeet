import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const sprint0DocPath = join(
  repoRoot,
  "docs/audits/video-date-sprint0-baseline-risk-map-2026-05-25.md",
);
const activeDocMapPath = join(repoRoot, "docs/active-doc-map.md");
const packageJsonPath = join(repoRoot, "package.json");

const sprint0Doc = readFileSync(sprint0DocPath, "utf8");
const activeDocMap = readFileSync(activeDocMapPath, "utf8");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  scripts?: Record<string, string>;
};

const requiredSections = [
  "## Sprint 0 Deliverables",
  "## Journey Map",
  "## State Ownership Matrix",
  "## Surface Parity Matrix",
  "## Feature Flag Matrix",
  "## Baseline Verification Commands",
  "## Ranked Risk Map",
  "## Sprint 0 Exit Criteria",
];

for (const section of requiredSections) {
  assert.ok(
    sprint0Doc.includes(section),
    `Sprint 0 baseline is missing section ${section}`,
  );
}

const requiredJourneyStages = [
  "Event discovery and registration",
  "Event lobby",
  "Vibe video swipe deck",
  "Swipe persistence and queueing",
  "Ready Gate trigger",
  "Daily room preparation",
  "Warm-up period",
  "Active video date",
  "Post-date survey and verdict",
  "Continue to next date or deck",
  "Nudges, reminders, and safety",
];

for (const stage of requiredJourneyStages) {
  assert.ok(
    sprint0Doc.includes(stage),
    `Sprint 0 journey map must cover ${stage}`,
  );
}

const requiredSurfaces = [
  "src/pages/EventLobby.tsx",
  "src/components/session/SessionRouteHydration.tsx",
  "src/hooks/useEventDeck.ts",
  "src/hooks/useSwipeAction.ts",
  "src/hooks/useMatchQueue.ts",
  "src/components/lobby/ReadyGateOverlay.tsx",
  "src/pages/ReadyRedirect.tsx",
  "src/pages/VideoDate.tsx",
  "src/components/video-date/PostDateSurvey.tsx",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/app/ready/[id].tsx",
  "apps/mobile/app/date/[id].tsx",
  "apps/mobile/components/video-date/PostDateSurvey.tsx",
  "apps/mobile/lib/videoDateApi.ts",
  "apps/mobile/lib/readyGateApi.ts",
  "swipe-actions",
  "daily-room",
  "video-date-daily-webhook",
  "video-date-outbox-drainer",
  "video-date-deadline-finalizer",
  "video-date-room-cleanup",
  "video-date-orphan-room-cleanup",
  "video-date-snapshot",
  "video-date-token-refresh",
  "admin-video-date-ops",
  "synthetic-video-date-monitor",
  "Daily",
  "Supabase",
];

for (const surface of requiredSurfaces) {
  assert.ok(
    sprint0Doc.includes(surface),
    `Sprint 0 baseline must name critical surface ${surface}`,
  );
}

const requiredFilePaths = [
  "src/pages/EventLobby.tsx",
  "src/pages/ReadyRedirect.tsx",
  "src/pages/VideoDate.tsx",
  "src/components/lobby/ReadyGateOverlay.tsx",
  "src/components/session/SessionRouteHydration.tsx",
  "src/components/video-date/PostDateSurvey.tsx",
  "src/hooks/useEventDeck.ts",
  "src/hooks/useSwipeAction.ts",
  "src/hooks/useMatchQueue.ts",
  "src/hooks/useReadyGate.ts",
  "src/hooks/useVideoCall.ts",
  "src/hooks/useVideoDateReadiness.ts",
  "src/lib/videoDateQueueHint.ts",
  "src/lib/videoDatePrepareEntry.ts",
  "src/lib/videoDateDailyPrewarm.ts",
  "src/lib/videoDateTokenRefresh.ts",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/app/ready/[id].tsx",
  "apps/mobile/app/date/[id].tsx",
  "apps/mobile/components/video-date/PostDateSurvey.tsx",
  "apps/mobile/lib/eventsApi.ts",
  "apps/mobile/lib/readyGateApi.ts",
  "apps/mobile/lib/videoDateApi.ts",
  "shared/matching/activeSession.ts",
  "shared/matching/postDateContinuity.ts",
  "shared/matching/readyGateReadiness.ts",
  "shared/matching/videoDateDeckPrefetch.ts",
  "shared/matching/videoDatePhase4Ux.ts",
  "shared/matching/videoDatePrepareEntry.ts",
  "shared/matching/videoDateRecoveryAdvisor.ts",
  "shared/matching/videoDateSessionChannel.ts",
  "shared/matching/videoDateSnapshot.ts",
  "shared/matching/videoDateTimeline.ts",
  "shared/matching/videoDatePublicApi.ts",
  "supabase/functions/daily-room/index.ts",
  "supabase/functions/swipe-actions/index.ts",
  "supabase/functions/video-date-daily-webhook/index.ts",
  "supabase/functions/video-date-outbox-drainer/index.ts",
  "supabase/functions/video-date-deadline-finalizer/index.ts",
  "supabase/functions/video-date-room-cleanup/index.ts",
  "supabase/functions/video-date-orphan-room-cleanup/index.ts",
  "supabase/functions/video-date-snapshot/index.ts",
  "supabase/functions/video-date-token-refresh/index.ts",
  "supabase/functions/admin-video-date-ops/index.ts",
  "supabase/functions/synthetic-video-date-monitor/index.ts",
];

for (const filePath of requiredFilePaths) {
  assert.ok(
    existsSync(join(repoRoot, filePath)),
    `Sprint 0 critical path no longer exists: ${filePath}`,
  );
}

const requiredStateOwners = [
  "event_registrations",
  "event_swipes",
  "video_sessions",
  "date_feedback",
  "matches",
  "Reporting/blocking",
  "Daily room and token",
  "Notifications and nudges",
];

for (const stateOwner of requiredStateOwners) {
  assert.ok(
    sprint0Doc.includes(stateOwner),
    `Sprint 0 state ownership matrix must include ${stateOwner}`,
  );
}

const requiredFlags = [
  "video_date.snapshot_v2",
  "video_date.deck_deal_v2",
  "video_date.readiness_v2",
  "video_date.micro_verdict_v2",
  "video_date.broadcast_v2",
  "video_date.timeline_v2",
  "video_date.daily_webhooks_v2",
  "video_date.extension_mutual_v2",
  "video_date.safety_always_on_v2",
  "video_date.multi_device_v2",
  "video_date.outbox_v2.mark_ready",
  "video_date.outbox_v2.forfeit",
  "video_date.outbox_v2.continue_handshake",
  "video_date.outbox_v2.handshake_auto_promote",
  "video_date.outbox_v2.date_timeout",
  "video_date.outbox_v2.submit_verdict",
  "video_date.outbox_v2.extension",
  "video_date.outbox_v2.safety",
  "video_date.outbox_v2.drain_match_queue",
  "video_date.deck_prefetch_polish_v2",
  "video_date.lobby_timeline_v2",
  "video_date.post_date_instant_next_v2",
  "video_date.broadcast_batched_v2",
  "video_date.resilience_v2",
  "video_date.daily_call_singleton_v2",
  "video_date.daily_token_refresh_v2",
  "video_date.push_payload_v2",
  "video_date.multi_device_dedup_v2",
  "video_date.push_open_dedupe_v1",
  "video_date.deck_optimistic_v1",
  "video_date.ready_gate_resilient_clock_v1",
  "video_date.verdict_confirm_v2",
  "video_date.verdict_confirm_v1",
  "video_date.outbox_lease_refresh_v2",
  "video_date.deadline_partial_unique_v2",
  "video_date.orphan_safety_interlock_v2",
  "video_date.circuit_breaker_v2",
];

for (const flag of requiredFlags) {
  assert.ok(
    sprint0Doc.includes(flag),
    `Sprint 0 feature flag matrix must include ${flag}`,
  );
}

const requiredRisks = [
  "Multiple navigation and convergence owners",
  "Ready status taxonomy drift",
  "Daily configuration fallback",
  "Prewarm timeout ambiguity",
  "Post-date exact-once and next-route continuity",
  "Broadcast and polling gaps",
  "Multi-device conflicts",
  "Safety/report reachability",
  "Queue and match duplicate creation",
  "Observability not tied to user journey",
];

for (const risk of requiredRisks) {
  assert.ok(
    sprint0Doc.includes(risk),
    `Sprint 0 ranked risk map must include ${risk}`,
  );
}

assert.ok(
  activeDocMap.includes(
    "docs/audits/video-date-sprint0-baseline-risk-map-2026-05-25.md",
  ),
  "Active doc map must reference the Sprint 0 Video Date baseline",
);

assert.ok(
  packageJson.scripts?.["test:video-date-v4"]?.includes(
    "videoDateSprint0BaselineContracts.test.ts",
  ),
  "test:video-date-v4 must include the Sprint 0 baseline contract test",
);

console.log("Video Date Sprint 0 baseline contract passed.");
