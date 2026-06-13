import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 2026-06-13 post-rebuild validation follow-ups.
//
// 1. Vibe-questions transport exception: the ice-breaker state lives in
//    video_sessions columns and is NOT emitted on the per-session broadcast
//    topic (neither vibe RPC appends a video_session_events row, and no
//    video_sessions trigger fires for those columns — verified against the
//    live project 2026-06-13). Until the RPCs gain a broadcast emit (needs a
//    migration), exactly two narrow postgres_changes listeners are sanctioned
//    on the date surface: web IceBreakerCard + native date/[id]. See
//    docs/video-date-architecture.md "Realtime".
//
// 2. Size-regrowth pins: the rebuild accepted three judged-partial
//    decompositions (PR 7.5 / 8.5 ledgers). Their size is frozen at the
//    accepted LOC plus ~5% headroom so regrowth is caught in review.
//
// 3. PR #1322-#1330 review follow-ups: keep web pre-room media preflight until
//    prewarm has live app-acquired tracks, filter terminal in_survey fallback
//    before ordering/limit, and keep the latency forensics SQL channel safe.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const webVideoCallStart = read("src/hooks/videoCall/useVideoDateStartCall.ts");
const webDailyPrewarm = read("src/lib/videoDateDailyPrewarm.ts");
const webTerminalRecovery = read("src/pages/videoDate/useTerminalSurveyRecovery.ts");
const latencyForensics = read("scripts/video-date-latency-forensics.mjs");

const VIBE_CHANNEL = /channel\(`vibe-questions-\$\{sessionId\}`\)/;

// The sanctioned exception is narrow by shape, not just by channel name: an
// UPDATE on public.video_sessions filtered to the single session row. Pinning
// the shape catches a widened subscription (dropped session filter, different
// event/table) that would otherwise still pass the channel-name + count checks.
const VIBE_LISTENER_SHAPE: Array<{ label: string; re: RegExp }> = [
  { label: 'event: "UPDATE"', re: /event:\s*["']UPDATE["']/ },
  { label: 'table: "video_sessions"', re: /table:\s*["']video_sessions["']/ },
  { label: "filter: `id=eq.${sessionId}`", re: /filter:\s*`id=eq\.\$\{sessionId\}`/ },
];

// The full date surface is scanned recursively (not a hard-coded file list)
// so a listener added in any in-call component or sub-hook — present or
// future — is caught.
const DATE_SURFACE_ROOTS = [
  "src/components/video-date",
  "src/pages/VideoDate.tsx",
  "src/pages/videoDate",
  "src/hooks/useVideoCall.ts",
  "src/hooks/videoCall",
  "apps/mobile/app/date",
  "apps/mobile/lib/videoDate",
  "apps/mobile/components/video-date",
] as const;

function collectSourceFiles(path: string): string[] {
  const absolute = join(root, path);
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return collectSourceFiles(child);
    return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

const SANCTIONED_POSTGRES_CHANGES: Record<string, number> = {
  "src/components/video-date/IceBreakerCard.tsx": 1,
  "apps/mobile/app/date/[id].tsx": 1,
};

test("vibe-questions is the single sanctioned postgres_changes exception on the date surface", () => {
  const files = DATE_SURFACE_ROOTS.flatMap(collectSourceFiles);
  // Vacuity guard: a renamed/moved root must fail loudly, not skip silently.
  assert.ok(
    files.length >= 40,
    `date-surface scan found only ${files.length} files — a root moved? Update DATE_SURFACE_ROOTS.`,
  );
  for (const sanctioned of Object.keys(SANCTIONED_POSTGRES_CHANGES)) {
    assert.ok(
      files.includes(sanctioned),
      `date-surface scan no longer covers ${sanctioned} — update DATE_SURFACE_ROOTS / the sanctioned map.`,
    );
  }

  for (const path of files) {
    const source = read(path);
    const expected = SANCTIONED_POSTGRES_CHANGES[path] ?? 0;
    const actual = source.match(/postgres_changes/g)?.length ?? 0;
    assert.equal(
      actual,
      expected,
      `${path}: expected ${expected} postgres_changes subscription(s), found ${actual}. ` +
        "The date surface rides the per-session broadcast topic; the only " +
        "sanctioned postgres_changes listener is vibe-questions (see " +
        "docs/video-date-architecture.md \"Realtime\"). Do not add more.",
    );
  }

  // The two sanctioned listeners stay narrow: same channel name, UPDATE on
  // video_sessions, and the reconnect convergence fallback (the seeding RPC)
  // stays reachable from both clients (web calls it directly; native goes
  // through getOrSeedVibeQuestionState in lib/videoDateApi.ts).
  for (const path of Object.keys(SANCTIONED_POSTGRES_CHANGES)) {
    const source = read(path);
    assert.match(source, VIBE_CHANNEL, `${path} must subscribe on the vibe-questions channel`);
    for (const { label, re } of VIBE_LISTENER_SHAPE) {
      assert.match(
        source,
        re,
        `${path}: the sanctioned postgres_changes listener must keep its narrow shape (${label}). ` +
          "Widening it (dropping the session filter, changing event/table) breaks the " +
          'pinned exception — see docs/video-date-architecture.md "Realtime".',
      );
    }
  }
  assert.match(
    read("src/components/video-date/IceBreakerCard.tsx"),
    /get_or_seed_video_session_vibe_questions/,
    "web IceBreakerCard must keep the RPC fetch fallback for reconnect convergence",
  );
  assert.match(
    read("apps/mobile/app/date/[id].tsx"),
    /getOrSeedVibeQuestionState/,
    "native date screen must keep the RPC fetch fallback for reconnect convergence",
  );
  assert.match(
    read("apps/mobile/lib/videoDateApi.ts"),
    /get_or_seed_video_session_vibe_questions/,
    "native videoDateApi must keep the seeding RPC binding",
  );
});

test("web pre-room media preflight only skips for singleton or live app-acquired prewarm media", () => {
  assert.match(webDailyPrewarm, /export function hasLiveWebVideoDateDailyPrewarmAppMedia/);
  assert.match(
    webDailyPrewarm,
    /getLivePrewarmMediaTracks\(appAcquiredMedia\?\.stream\)/,
  );
  assert.match(
    webVideoCallStart,
    /const prewarmAppAcquiredMediaBeforeRoom =[\s\S]{0,180}hasLiveWebVideoDateDailyPrewarmAppMedia\(\s*prewarmPeekBeforeRoom\.entry\.appAcquiredMedia/s,
  );
  assert.match(
    webVideoCallStart,
    /const reusableDailyPrewarmBeforeRoom =\s*prewarmAppAcquiredMediaBeforeRoom/,
  );
  assert.doesNotMatch(
    webVideoCallStart,
    /const reusableDailyPrewarmBeforeRoom =[\s\S]{0,160}prewarmPendingBeforeRoom/,
  );
  assert.match(webVideoCallStart, /source:[\s\S]{0,120}"daily_prewarm_live_app_media"/);
  assert.doesNotMatch(webVideoCallStart, /source:[\s\S]{0,160}"daily_prewarm_pending"/);
  assert.match(
    webVideoCallStart,
    /const skipMediaPreflightForReusableDailyMedia =[\s\S]{0,120}prewarmHasLiveAppAcquiredMedia/,
  );
});

test("terminal in_survey fallback filters current route before newest-row limit", () => {
  const roomScopedIndex = webTerminalRecovery.indexOf('.eq("current_room_id", id)');
  const nullRoomIndex = webTerminalRecovery.indexOf('.is("current_room_id", null)');
  const eventScopedIndex = webTerminalRecovery.indexOf('.eq("event_id", expectedEventId)');
  const orderIndex = webTerminalRecovery.indexOf('.order("last_active_at"', roomScopedIndex);
  assert.ok(roomScopedIndex > -1, "fallback should first query the current route room");
  assert.ok(nullRoomIndex > roomScopedIndex, "fallback should then query cleared-room survey continuity");
  assert.ok(eventScopedIndex > nullRoomIndex, "cleared-room fallback should be scoped to expected event when known");
  assert.ok(orderIndex > roomScopedIndex, "room/event filters must happen before ordering/limit");
  assert.match(
    webTerminalRecovery,
    /registrationFallbackBaseQuery\(\)[\s\S]{0,120}\.eq\("current_room_id", id\)[\s\S]{0,120}\.order\("last_active_at"/,
  );
  assert.match(
    webTerminalRecovery,
    /registrationFallbackBaseQuery\(\)[\s\S]{0,160}\.is\("current_room_id", null\)[\s\S]{0,120}\.eq\("event_id", expectedEventId\)[\s\S]{0,120}\.order\("last_active_at"/,
  );
});

test("latency forensics validates session ids and uses first provider joins", () => {
  assert.match(latencyForensics, /const UUID_RE = \/\^\[0-9a-f\]/);
  assert.match(latencyForensics, /const validatedSessionArg = sessionArg \? requireUuid\(sessionArg, "session id"\) : null/);
  assert.match(latencyForensics, /if \(validatedSessionArg\) return validatedSessionArg/);
  assert.match(latencyForensics, /return requireUuid\(rows\[0\]\.id, "resolved session id"\)/);
  assert.match(latencyForensics, /const firstJoinByActor = new Map\(\)/);
  assert.match(latencyForensics, /eventType !== "participant\.joined" && eventType !== "participant\.join"/);
  assert.match(latencyForensics, /firstJoinByActor\.set\(actorId, joinedAt\)/);
  assert.match(latencyForensics, /participant1FirstProviderJoin && participant2FirstProviderJoin/);
  assert.doesNotMatch(
    latencyForensics,
    /s\.participant_1_provider_joined_at && s\.participant_2_provider_joined_at/,
  );
});

// Accepted judged-partial decompositions (PR 7.5 / 8.5) frozen at current
// size + ~5% headroom. If a file outgrows its ceiling: decompose, don't grow.
const LOC_CEILINGS: Array<{ path: string; ceiling: number; acceptedLoc: number }> = [
  { path: "apps/mobile/app/date/[id].tsx", ceiling: 7125, acceptedLoc: 6784 },
  { path: "src/pages/VideoDate.tsx", ceiling: 5300, acceptedLoc: 5048 },
  { path: "src/components/lobby/ReadyGateOverlay.tsx", ceiling: 4035, acceptedLoc: 3845 },
];

test("judged-partial decompositions do not regrow past their accepted ceilings", () => {
  for (const { path, ceiling, acceptedLoc } of LOC_CEILINGS) {
    const loc = read(path).split("\n").length;
    assert.ok(
      loc <= ceiling,
      `${path} is ${loc} LOC, over its pinned ceiling of ${ceiling} ` +
        `(accepted at ${acceptedLoc} LOC + ~5% headroom). ` +
        "Decompose, don't grow: extract a sub-hook/component instead of " +
        "adding to this file, then keep the ceiling.",
    );
  }
});
