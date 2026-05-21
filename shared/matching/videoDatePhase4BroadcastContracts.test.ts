import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeVideoDateSessionBroadcastEvent,
  resolveVideoDateSessionSeqDecision,
  videoDateSessionTopic,
} from "./videoDateSessionChannel";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522003000_video_date_phase4_private_broadcast.sql"),
  "utf8",
);
const sessionChannel = readFileSync(
  join(root, "shared/matching/videoDateSessionChannel.ts"),
  "utf8",
);
const webReadyGate = readFileSync(join(root, "src/hooks/useReadyGate.ts"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const nativeReadyGate = readFileSync(join(root, "apps/mobile/lib/readyGateApi.ts"), "utf8");
const nativeVideoDateApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const handshakePersistence = readFileSync(
  join(root, "shared/matching/videoDateHandshakePersistence.ts"),
  "utf8",
);
const packageJson = readFileSync(join(root, "package.json"), "utf8");

test("PR 4.1 broadcasts only sanitized participant-visible session events to private topics", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.broadcast_video_session_event_v2\(\)/);
  assert.match(migration, /WHEN \(NEW\.visibility = 'participants'\)/);
  assert.match(migration, /IF TG_OP <> 'INSERT' OR NEW\.visibility IS DISTINCT FROM 'participants' THEN/);
  assert.match(migration, /NEW\.sanitized_payload/);
  assert.doesNotMatch(migration, /NEW\.payload/);
  assert.match(migration, /PERFORM realtime\.send\(/);
  assert.match(migration, /'video_session_event'/);
  assert.match(migration, /'session:' \|\| NEW\.session_id::text/);
  assert.match(migration, /,\s*true\s*\)/);
  assert.doesNotMatch(migration, /realtime\.broadcast_changes/);
  assert.doesNotMatch(migration, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("PR 4.2 realtime RLS denies non-participant session channel reads and client sends", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_realtime_topic_is_session/);
  assert.match(migration, /\^session:\[0-9a-f\]\{8\}/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_can_access_session_topic/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(migration, /p_user_id/);
  assert.match(migration, /vs\.id = v_session_id/);
  assert.match(migration, /vs\.participant_1_id = v_user_id OR vs\.participant_2_id = v_user_id/);
  assert.match(migration, /ALTER TABLE realtime\.messages ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /Video date participants can receive session broadcasts/);
  assert.match(migration, /realtime\.messages\.extension = 'broadcast'/);
  assert.match(migration, /public\.video_date_can_access_session_topic\(\(SELECT realtime\.topic\(\)\)\)/);
  assert.match(migration, /Video date session broadcast read guard/);
  assert.match(migration, /AS RESTRICTIVE[\s\S]+FOR SELECT/);
  assert.match(migration, /Video date clients cannot send session broadcasts/);
  assert.match(migration, /AS RESTRICTIVE[\s\S]+FOR INSERT/);
  assert.match(migration, /WITH CHECK \([\s\S]+NOT public\.video_date_realtime_topic_is_session/);
});

test("PR 4.3 web and native use the shared private session channel helper", () => {
  assert.match(sessionChannel, /VIDEO_DATE_SESSION_CHANNEL_EVENT = "video_session_event"/);
  assert.match(sessionChannel, /VIDEO_DATE_SESSION_TOPIC_PREFIX = "session:"/);
  assert.match(sessionChannel, /client\.channel\(topic, \{ config: \{ private: true \} \}\)/);
  assert.match(sessionChannel, /\.on\("broadcast", \{ event: VIDEO_DATE_SESSION_CHANNEL_EVENT \}/);

  for (const source of [webReadyGate, webVideoDate, nativeReadyGate, nativeVideoDateApi]) {
    assert.match(source, /useFeatureFlag\(["']video_date\.broadcast_v2["']\)/);
    assert.match(source, /createVideoDateSessionChannel/);
    assert.match(source, /resolveVideoDateSessionSeqDecision/);
  }
});

test("PR 4.4 sequence gaps refetch token-free snapshots before normal reconciliation", () => {
  for (const source of [webReadyGate, webVideoDate, nativeReadyGate, nativeVideoDateApi]) {
    assert.match(source, /decision\.action === ["']gap["']/);
    assert.match(source, /fetchVideoDateSnapshot\(sessionId|fetchVideoDateSnapshot\(id/);
    assert.match(source, /includeToken: false/);
    assert.match(
      source,
      /snapshot\.ok[\s\S]+sessionSeqRef\.current = (?:snapshot\.seq|Math\.max\(sessionSeqRef\.current \?\? 0, snapshot\.seq\))/,
    );
  }

  assert.equal(videoDateSessionTopic("11111111-1111-4111-8111-111111111111"), "session:11111111-1111-4111-8111-111111111111");
  assert.deepEqual(resolveVideoDateSessionSeqDecision(null, 7), {
    action: "gap",
    sessionSeq: 7,
    expectedSeq: null,
  });
  assert.deepEqual(resolveVideoDateSessionSeqDecision(7, 7), {
    action: "duplicate",
    sessionSeq: 7,
  });
  assert.deepEqual(resolveVideoDateSessionSeqDecision(7, 8), {
    action: "accept",
    sessionSeq: 8,
  });
  assert.deepEqual(resolveVideoDateSessionSeqDecision(7, 10), {
    action: "gap",
    sessionSeq: 10,
    expectedSeq: 8,
  });
});

test("Phase 4 consumers seed and reset session sequence state across web and native surfaces", () => {
  assert.match(webReadyGate, /\.select\("[^"]*session_seq[^"]*"\)/);
  assert.match(nativeReadyGate, /\.select\(\s*'[^']*session_seq[^']*'/);
  assert.match(nativeVideoDateApi, /\.select\(\s*'[^']*session_seq[^']*'/);
  assert.match(webVideoDate, /\.select\("[^"]*session_seq[^"]*"\)/);
  assert.match(handshakePersistence, /VIDEO_DATE_HANDSHAKE_TRUTH_SELECT =[\s\S]*session_seq/);

  assert.match(webReadyGate, /sessionSeqRef\.current = null/);
  assert.match(webVideoDate, /sessionSeqRef\.current = null/);
  assert.match(nativeReadyGate, /sessionSeqRef\.current = null/);
  assert.match(nativeVideoDateApi, /sessionSeqRef\.current = null/);
});

test("broadcast payload normalizer accepts database envelope and rejects raw or malformed payloads", () => {
  const event = normalizeVideoDateSessionBroadcastEvent({
    payload: {
      schemaVersion: 1,
      id: 42,
      sessionId: "11111111-1111-4111-8111-111111111111",
      sessionSeq: 9,
      kind: "ready_gate_both_ready",
      at: "2026-05-21T18:00:00Z",
      actor: "22222222-2222-4222-8222-222222222222",
      payload: { ready_gate_status: "both_ready" },
      correlationId: "33333333-3333-4333-8333-333333333333",
    },
  });
  assert.equal(event?.kind, "ready_gate_both_ready");
  assert.equal(event?.payload.ready_gate_status, "both_ready");

  assert.equal(normalizeVideoDateSessionBroadcastEvent({ payload: { schemaVersion: 1, id: 1 } }), null);
  assert.equal(
    normalizeVideoDateSessionBroadcastEvent({
      schemaVersion: 1,
      id: 2,
      sessionId: "11111111-1111-4111-8111-111111111111",
      sessionSeq: -1,
      kind: "bad_seq",
    }),
    null,
  );
});

test("Phase 4 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase4BroadcastContracts\.test\.ts/);
});
