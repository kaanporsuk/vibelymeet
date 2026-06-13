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

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const VIBE_CHANNEL = /channel\(`vibe-questions-\$\{sessionId\}`\)/;

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
