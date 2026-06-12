import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("web and native Ready Gate surfaces render shared vibe chips from existing profile data", () => {
  const helper = read("apps/mobile/lib/readyGateSharedVibes.ts");
  const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
  const overlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  // PR 8.5: ready screen split; read the family.
  const standalone = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
    .map(read)
    .join("\n");

  assert.match(helper, /from\('video_sessions'\)[\s\S]+participant_1_id, participant_2_id/);
  assert.match(helper, /from\('profile_vibes'\)[\s\S]+vibe_tags\(label\)/);
  // The shared-vibes helper now delegates the profile read to the shared
  // partner-profile lib (same viewer-scoped RPC, one owner).
  assert.match(helper, /fetchVideoDatePartnerProfile\(/);
  assert.match(
    read("apps/mobile/lib/videoDatePartnerProfile.ts"),
    /rpc\('get_profile_for_viewer'/,
  );
  assert.match(helper, /resolvePartnerId/);

  for (const source of [overlay, standalone]) {
    assert.match(source, /fetchReadyGateSharedVibes/);
    assert.match(source, /sharedVibes\.map/);
    assert.match(source, /sharedVibeChip/);
  }

  assert.match(webOverlay, /let cancelled = false;[\s\S]+setPartnerPhotos\(null\);[\s\S]+setPartnerAvatarUrl\(null\);[\s\S]+setSharedVibes\(\[\]\);/);
  assert.match(webOverlay, /if \(cancelled \|\| !snapshot\.ok \|\| !snapshot\.partnerId\) return;/);
  assert.match(webOverlay, /if \(cancelled\) return;[\s\S]+profile_vibes/);
  assert.match(webOverlay, /toLowerCase\(\)/);
  assert.match(webOverlay, /sharedVibes\.map/);
});

test("queue promotion copy is removed with post-date instant-next", () => {
  const queueCopy = read("shared/matching/videoDatePhase4Ux.ts");
  const readyGateContract = read("docs/contracts/event-lobby-ready-queue-contract.md");

  assert.equal(existsSync(join(root, "shared/matching/matchQueueDrainReasonCopy.ts")), false);
  assert.doesNotMatch(queueCopy, /match_queued/);
  assert.match(readyGateContract, /Removed Queue Drain/);
});

test("Ready Gate transition failures use shared multi-device conflict copy", () => {
  const sharedCopy = read("shared/matching/readyGateDiagnosticCopy.ts");
  const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  // PR 8.5: ready screen split; read the family.
  const nativeRoute = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
    .map(read)
    .join("\n");

  assert.match(sharedCopy, /READY_GATE_TRANSITION_STALE_OR_CONFLICT_SIGNALS/);
  assert.match(sharedCopy, /SURFACE_CLAIM_CONFLICT/i);
  assert.match(sharedCopy, /Another \$\{surface\} already changed this Ready Gate/);
  for (const source of [webOverlay, nativeOverlay, nativeRoute]) {
    assert.match(source, /resolveReadyGateTransitionFailureCopy/);
    assert.match(source, /multi_device_conflict/);
  }
});

test("admin ops expose notification and outbox health without treating push telemetry as transactional truth", () => {
  const adminOps = read("supabase/functions/admin-video-date-ops/index.ts");

  assert.match(adminOps, /notification_outbox_health/);
  assert.match(adminOps, /video_date_provider_outbox/);
  assert.match(adminOps, /video_date_provider_outbox_failure_log/);
  assert.match(adminOps, /video_date_provider_dead_letters/);
  assert.match(adminOps, /notification_log/);
  assert.match(adminOps, /push_notification_events/);
  assert.match(adminOps, /not authoritative for transactional send-notification rows/);
  assert.match(adminOps, /const pushTelemetryAffectsStatus = !eventId/);
  assert.match(adminOps, /PUSH_PROVIDER_FAILURE_STATUSES = new Set\(\["failed", "bounced"\]\)/);
  assert.match(adminOps, /PUSH_PROVIDER_FAILURE_STATUSES\.has\(status\) \|\| Boolean\(row\.error_code\)/);
  assert.match(adminOps, /fetchRowsForSessionIds/);
  assert.match(adminOps, /for \(let i = 0; i < uniqueIds\.length; i \+= 500\)/);
  assert.match(adminOps, /\.select\(select\)\.in\("session_id", chunk\)/);
  assert.doesNotMatch(adminOps, /eventSessionIds[\s\S]{0,120}slice\(0, 500\)/);
  assert.match(adminOps, /status_affects_window: pushTelemetryAffectsStatus/);
  assert.match(adminOps, /top_statuses: topStringCounts\(pushTelemetry\.rows/);
  assert.match(adminOps, /sourceError \|\| sessionFilterUnavailable \|\| sessionFilterTruncated/);
  assert.match(adminOps, /kind_filter:\s*\["notification\.send"\]/);
});

test("production validation script and docs cover remote parity and live QA", () => {
  const script = read("scripts/verify-ready-gate-production-parity.mjs");
  const packageJson = read("package.json");
  const docs = read("docs/ready-gate-production-validation.md");
  const parityAudit = read("docs/phase5-parity-audit.md");

  assert.match(packageJson, /verify:ready-gate-prod-parity/);
  assert.match(script, /--require-remote/);
  assert.match(script, /supabase", \["migration", "list", "--linked"\]/);
  assert.match(script, /supabase", \["db", "push", "--linked", "--dry-run"\]/);
  assert.match(script, /supabase", \["functions", "list"\]/);

  for (const liveCase of [
    "Daily provider outage",
    "Stale push tap",
    "Event ends during Ready Gate",
    "Queued promotion while backgrounded",
    "Multi-device Ready/Snooze/Step away conflict",
    "OneSignal send failure",
  ]) {
    assert.match(docs, new RegExp(liveCase));
  }

  assert.doesNotMatch(parityAudit, /No timer, no snooze, no shared vibes/);
  assert.doesNotMatch(parityAudit, /Ready Gate:\*\* Timer, snooze \(needs useReadyGate-style backend\)/);
  assert.match(parityAudit, /timer, partner photo, shared vibes, Ready\/Snooze\/Skip/);
});
