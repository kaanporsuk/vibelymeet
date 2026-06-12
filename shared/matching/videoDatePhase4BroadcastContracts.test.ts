import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeVideoDateSessionBroadcastEvent,
  normalizeVideoDateSessionBroadcastEvents,
  resolveVideoDateSessionSeqDecision,
  videoDateSessionTopic,
} from "./videoDateSessionChannel";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522003000_video_date_phase4_private_broadcast.sql"),
  "utf8",
);
const phase5AuditMigration = readFileSync(
  join(root, "supabase/migrations/20260522013000_video_date_phase5_audit_hardening.sql"),
  "utf8",
);
const instantPremiumMigration = readFileSync(
  join(root, "supabase/migrations/20260522193000_video_date_instant_premium_v2_flags_batched_broadcast.sql"),
  "utf8",
);
const sessionChannel = readFileSync(
  join(root, "shared/matching/videoDateSessionChannel.ts"),
  "utf8",
);
const webReadyGate = readFileSync(join(root, "src/hooks/useReadyGate.ts"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webEventLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const nativeReadyGate = readFileSync(join(root, "apps/mobile/lib/readyGateApi.ts"), "utf8");
const nativeVideoDateApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const nativeEventLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const realtimeRlsRuntime = readFileSync(
  join(root, "shared/matching/videoDateRealtimeRlsRuntime.test.ts"),
  "utf8",
);
const handshakePersistence = readFileSync(
  join(root, "shared/matching/videoDateEntryPersistence.ts"),
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
    // PR 6 flag freeze: the private broadcast channel is always on.
    assert.doesNotMatch(source, /useFeatureFlag\(["']video_date\.broadcast_v2["']\)/);
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
      /snapshot\.ok[\s\S]+sessionSeqRef\.current = (?:snapshot\.seq|Math\.max\(\s*sessionSeqRef\.current \?\? 0,\s*snapshot\.seq,?\s*\))/,
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

test("broadcast gap refetch queues follow-up snapshots for newer events that arrive mid-sync", () => {
  assert.match(webVideoDate, /broadcastPendingRefetchSeqRef/);
  assert.match(
    webVideoDate,
    /if \(broadcastRefetchInFlightRef\.current\) \{[\s\S]*broadcastPendingRefetchSeqRef\.current = Math\.max/,
  );
  assert.match(webVideoDate, /let pendingRefetchSeq: number \| null = event\.sessionSeq/);
  assert.doesNotMatch(webVideoDate, /let pendingRefetchSeq: number \| null = null/);
  assert.match(webVideoDate, /while \(pendingRefetchSeq !== null\)/);
  assert.match(webVideoDate, /broadcastPendingRefetchSeqRef\.current = null/);
  assert.match(webVideoDate, /broadcast_queued_seq/);
});

test("Phase 4 consumers seed and reset session sequence state across web and native surfaces", () => {
  const selectsSessionSeq = /\.select\(\s*["'`][\s\S]*?session_seq[\s\S]*?["'`]\s*\)/;
  assert.match(webReadyGate, selectsSessionSeq);
  assert.match(nativeReadyGate, selectsSessionSeq);
  assert.match(nativeVideoDateApi, selectsSessionSeq);
  assert.match(webVideoDate, selectsSessionSeq);
  assert.match(handshakePersistence, /VIDEO_DATE_ENTRY_TRUTH_SELECT =[\s\S]*session_seq/);

  assert.match(webReadyGate, /sessionSeqRef\.current = null/);
  for (const lobbySource of [webEventLobby, nativeEventLobby]) {
    assert.match(lobbySource, /lobbyBroadcastSessionSeqSessionRef/);
    assert.match(lobbySource, /event\.sessionId !== lobbyBroadcastSessionId/);
    assert.match(lobbySource, /lobbyBroadcastSessionSeqSessionRef\.current !== lobbyBroadcastSessionId[\s\S]{0,160}lobbyBroadcastSessionSeqRef\.current = null/);
  }
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

test("batched broadcast normalizer accepts ordered sanitized envelopes and rejects malformed batches", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const events = normalizeVideoDateSessionBroadcastEvents({
    payload: {
      schemaVersion: 1,
      sessionId,
      events: [
        {
          schemaVersion: 1,
          id: 22,
          sessionId,
          sessionSeq: 12,
          kind: "ready_gate_both_ready",
          at: "2026-05-22T18:00:02Z",
          actor: null,
          payload: { ready_gate_status: "both_ready" },
          correlationId: null,
        },
        {
          schemaVersion: 1,
          id: 21,
          sessionId,
          sessionSeq: 11,
          kind: "date_started",
          at: "2026-05-22T18:00:01Z",
          actor: "22222222-2222-4222-8222-222222222222",
          payload: {},
          correlationId: "33333333-3333-4333-8333-333333333333",
        },
      ],
    },
  });
  assert.equal(events?.length, 2);
  assert.deepEqual(events?.map((event) => event.sessionSeq), [11, 12]);
  assert.equal(events?.[0]?.kind, "date_started");
  assert.equal(normalizeVideoDateSessionBroadcastEvent({ payload: { schemaVersion: 1, sessionId, events } }), null);
  assert.equal(
    normalizeVideoDateSessionBroadcastEvents({
      payload: {
        schemaVersion: 1,
        sessionId,
        events: [
          {
            schemaVersion: 1,
            id: 1,
            sessionId: "44444444-4444-4444-8444-444444444444",
            sessionSeq: 1,
            kind: "wrong_session",
          },
        ],
      },
    }),
    null,
  );
  assert.equal(
    normalizeVideoDateSessionBroadcastEvents({
      payload: {
        schemaVersion: 1,
        sessionId,
        events: [],
      },
    }),
    null,
  );
});

test("instant premium migration adds statement-level batched broadcasts behind full-rollout flag", () => {
  assert.match(instantPremiumMigration, /'video_date\.broadcast_batched_v2', false, 0/);
  assert.match(instantPremiumMigration, /CREATE OR REPLACE FUNCTION public\.video_date_broadcast_batched_v2_enabled\(\)/);
  assert.match(instantPremiumMigration, /rollout_bps >= 10000/);
  assert.match(instantPremiumMigration, /kill_switch_active = false/);
  assert.match(instantPremiumMigration, /IF public\.video_date_broadcast_batched_v2_enabled\(\) THEN[\s\S]+RETURN NULL/);
  assert.match(instantPremiumMigration, /CREATE OR REPLACE FUNCTION public\.broadcast_video_session_events_batched_v2\(\)/);
  assert.match(instantPremiumMigration, /FROM new_rows nr[\s\S]+WHERE nr\.visibility = 'participants'/);
  assert.match(instantPremiumMigration, /jsonb_agg\([\s\S]+ORDER BY nr\.session_seq, nr\.id/);
  assert.match(instantPremiumMigration, /COALESCE\(nr\.sanitized_payload, '\{\}'::jsonb\)/);
  assert.doesNotMatch(instantPremiumMigration, /nr\.payload/);
  assert.match(instantPremiumMigration, /CREATE TRIGGER broadcast_video_session_events_batched_v2/);
  assert.match(instantPremiumMigration, /REFERENCING NEW TABLE AS new_rows/);
  assert.match(instantPremiumMigration, /FOR EACH STATEMENT/);
});

test("participant broadcast sanitized_payload has defense-in-depth sensitive-key checks", () => {
  assert.match(phase5AuditMigration, /CREATE OR REPLACE FUNCTION public\.video_date_jsonb_has_secret_key\(p_value jsonb\)/);
  for (const key of [
    "password",
    "safetydetails",
    "reportreason",
    "idempotencykey",
    "dailytoken",
    "meetingtoken",
    "accesstoken",
    "refreshtoken",
  ]) {
    assert.match(phase5AuditMigration, new RegExp(`'${key}'`));
  }
  assert.match(phase5AuditMigration, /LIKE '%bearer%'/);
  assert.match(phase5AuditMigration, /video_session_events_no_sanitized_payload_sensitive_keys_v2/);
  assert.match(phase5AuditMigration, /CHECK \(NOT public\.video_date_jsonb_has_secret_key\(sanitized_payload\)\)/);
  assert.match(phase5AuditMigration, /NOT VALID/);
});

test("Realtime RLS has an opt-in runtime participant/non-participant subscription test", () => {
  assert.match(realtimeRlsRuntime, /VIDEO_DATE_RLS_PARTICIPANT_JWT/);
  assert.match(realtimeRlsRuntime, /VIDEO_DATE_RLS_NON_PARTICIPANT_JWT/);
  assert.match(realtimeRlsRuntime, /client\.channel\(`session:\$\{runtimeEnv\.sessionId\}`/);
  assert.match(realtimeRlsRuntime, /assert\.equal\(participant\.status, "SUBSCRIBED"\)/);
  assert.match(realtimeRlsRuntime, /assert\.notEqual\(nonParticipant\.status, "SUBSCRIBED"\)/);
  assert.match(packageJson, /shared\/matching\/videoDateRealtimeRlsRuntime\.test\.ts/);
});

test("Phase 4 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase4BroadcastContracts\.test\.ts/);
});
