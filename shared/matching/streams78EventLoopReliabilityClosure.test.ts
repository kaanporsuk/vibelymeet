import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
}

function listFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];

  return readdirSync(abs).flatMap((entry) => {
    const path = join(dir, entry);
    const fullPath = join(root, path);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (["node_modules", ".expo", "dist", "build", "coverage"].includes(entry)) return [];
      return listFiles(path);
    }
    return [path];
  });
}

const reportPath = "docs/investigations/streams-7-8-event-loop-reliability.md";
const branchDeltaPath = "docs/branch-deltas/fix-streams-7-8-event-loop-reliability-closure.md";
const report = read(reportPath);
const branchDelta = read(branchDeltaPath);

const stream78Artifacts = [
  "supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql",
  "supabase/validation/swipe_retry_idempotency_notification_dedupe.sql",
  "supabase/functions/swipe-actions/index.ts",
  "supabase/functions/_shared/matching/videoSessionFlow.ts",
  "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
  "docs/branch-deltas/fix-swipe-retry-idempotency-notification-dedupe.md",
  "src/pages/EventLobby.tsx",
  "src/hooks/useMatchQueue.ts",
  "src/hooks/useActiveSession.ts",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/lib/useActiveSession.ts",
  "shared/matching/realtimeSubscriptionTightening.test.ts",
  "docs/branch-deltas/fix-realtime-subscription-tightening.md",
];

const realtimeSurfaces = [
  "src/pages/EventLobby.tsx",
  "src/hooks/useMatchQueue.ts",
  "src/hooks/useActiveSession.ts",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/lib/useActiveSession.ts",
];

const forbiddenVideoSessionFields = [
  "ready_gate_status",
  "ready_participant_1_at",
  "ready_participant_2_at",
  "ready_gate_expires_at",
  "snoozed_by",
  "snooze_expires_at",
  "state",
  "phase",
  "ended_at",
  "ended_reason",
];

const forbiddenRegistrationFields = [
  "queue_status",
  "current_room_id",
  "current_partner_id",
];

function assertNoForbiddenSupabaseWrites(paths: string[], table: string, fields: readonly string[]) {
  const fieldPattern = fields.join("|");
  const mutationPattern = new RegExp(
    String.raw`\.from\(\s*['"]${table}['"]\s*\)[\s\S]{0,1400}\.(?:update|insert|upsert)\(\s*(?:\{[\s\S]{0,900})?(?:${fieldPattern})`,
    "m",
  );

  for (const path of paths) {
    assert.doesNotMatch(read(path), mutationPattern, `${path} must not directly mutate ${table} lifecycle fields`);
  }
}

test("investigation report records PASS verdict and no repair recommendation", () => {
  assert.match(report, /## Executive Verdict: PASS/);
  assert.match(report, /No material defect, broad undocumented event-level subscription, or material validation failure was found/);
  assert.match(report, /No repair stream is recommended for Streams 7-8 from this audit/);
  assert.match(report, /no Docker/i);
  assert.match(report, /no local Supabase/i);
  assert.match(report, /no Supabase cloud mutation/i);
  assert.match(report, /no deploy/i);
});

test("closure branch delta documents Mode C docs-test-only scope and no deploy", () => {
  assert.match(branchDelta, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /Mode C/i);
  assert.match(branchDelta, /docs\/test-only/i);
  assert.match(branchDelta, /Supabase migration requirement:\s*not required/i);
  assert.match(branchDelta, /Edge Function deploy requirement:\s*not required/i);
  assert.match(branchDelta, /web\/static deploy requirement:\s*not required/i);
  assert.match(branchDelta, /env vars added\/changed:\s*none/i);
  assert.match(branchDelta, /native module changes:\s*none/i);
  assert.match(branchDelta, /`expo-av`:\s*not used/i);
  assert.match(branchDelta, /production data-mutating smoke:\s*not run/i);
});

test("Stream 7-8 artifacts remain present and preserve closure-critical contracts", () => {
  for (const path of stream78Artifacts) {
    assert.equal(exists(path), true, `${path} should exist`);
  }

  assert.match(read("supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql"), /handle_swipe_idempotency:/);
  assert.match(read("supabase/validation/swipe_retry_idempotency_notification_dedupe.sql"), /pg_get_functiondef/);
  assert.match(read("supabase/functions/swipe-actions/index.ts"), /shouldSuppressSwipeNotification/);
  assert.match(read("supabase/functions/_shared/matching/videoSessionFlow.ts"), /"already_swiped"/);
  assert.match(read("shared/matching/realtimeSubscriptionTightening.test.ts"), /avoid broad event-level video_sessions realtime/);
});

test("closure adds no Supabase migration, validation SQL, Edge Function, or config artifact", () => {
  const suspiciousSupabaseArtifacts = [
    ...listFiles("supabase/migrations"),
    ...listFiles("supabase/validation"),
    ...listFiles("supabase/functions"),
  ].filter((path) => /streams?[-_]?7[-_]?8|event[-_]?loop[-_]?reliability[-_]?closure/i.test(path));

  assert.deepEqual(suspiciousSupabaseArtifacts, [], "docs/test-only closure must not add Supabase artifacts");
  assert.match(branchDelta, /Edge Functions changed\/deployed:\s*not required/i);
});

test("realtime and swipe closure proof has no broad client write or subscription drift", () => {
  for (const path of realtimeSurfaces) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /\.on\(\s*["']postgres_changes["'][\s\S]{0,320}table:\s*["']video_sessions["'][\s\S]{0,320}filter:\s*`event_id=eq\./,
      `${path} must not use broad event-level video_sessions realtime`,
    );
    assert.match(source, /participant_1_id=eq\.\$\{(?:user\.id|userId)\}/, `${path} should subscribe to participant_1_id`);
    assert.match(source, /participant_2_id=eq\.\$\{(?:user\.id|userId)\}/, `${path} should subscribe to participant_2_id`);
  }

  assertNoForbiddenSupabaseWrites(realtimeSurfaces, "video_sessions", forbiddenVideoSessionFields);
  assertNoForbiddenSupabaseWrites(realtimeSurfaces, "event_registrations", forbiddenRegistrationFields);
  assert.match(read("src/hooks/useSwipeAction.ts"), /case "already_swiped"/);
  assert.match(read("apps/mobile/app/event/[eventId]/lobby.tsx"), /case 'already_swiped'/);
});

test("closure introduces no env vars, native modules, or expo-av usage", () => {
  for (const path of ["package.json", "apps/mobile/package.json"]) {
    assert.doesNotMatch(read(path), /"expo-av"\s*:/, `${path} must not add expo-av`);
  }

  for (const path of [
    ...listFiles("src"),
    ...listFiles("apps/mobile"),
    ...listFiles("shared"),
    ...listFiles("supabase/functions"),
  ]) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    assert.doesNotMatch(
      read(path),
      /(?:from|require\(|import\()\s*['"]expo-av['"]/,
      `${path} must not import expo-av`,
    );
  }

  assert.doesNotMatch(branchDelta, /new env var|added env var|service role key/i);
});
