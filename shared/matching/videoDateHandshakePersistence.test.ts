import test from "node:test";
import assert from "node:assert/strict";
import {
  completeHandshakeExpectation,
  handshakeDecisionFailureIndicatesSessionEnded,
  handshakeRpcIndicatesTerminalDecisionRejection,
  handshakeTruthIndicatesEndedSession,
  HANDSHAKE_LAST_CHANCE_GRACE_SECONDS,
  persistHandshakeDecisionWithVerification,
  type VideoDateHandshakeTruth,
} from "./videoDateHandshakePersistence";

const baseTruth: VideoDateHandshakeTruth = {
  id: "session-1",
  participant_1_id: "user-a",
  participant_2_id: "user-b",
  participant_1_joined_at: "2026-04-24T06:02:00.000Z",
  participant_2_joined_at: "2026-04-24T06:02:01.000Z",
  participant_1_liked: null,
  participant_2_liked: null,
  participant_1_decided_at: null,
  participant_2_decided_at: null,
  state: "handshake",
  phase: "handshake",
  ended_at: null,
  ended_reason: null,
  handshake_grace_expires_at: null,
};

test("vibe persistence succeeds only when the actor decision is present in DB truth", async () => {
  const result = await persistHandshakeDecisionWithVerification({
    sessionId: "session-1",
    actorUserId: "user-a",
    action: "vibe",
    retryDelaysMs: [],
    rpc: async () => ({ data: { success: true, state: "handshake" }, error: null }),
    fetchTruth: async () => ({
      truth: {
        ...baseTruth,
        participant_1_liked: true,
        participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.actorDecisionPersisted, true);
  assert.equal(result.actorDecisionSlot, "participant_1_liked");
  assert.equal(result.actorDecisionTimestampSlot, "participant_1_decided_at");
  assert.equal(result.persistedDecision, true);
  assert.equal(result.persistedDecisionAt, "2026-04-24T06:02:02.000Z");
  assert.equal(result.attempts, 1);
});

test("RPC success with the actor decision still null retries and then surfaces failure", async () => {
  let rpcCalls = 0;
  const result = await persistHandshakeDecisionWithVerification({
    sessionId: "session-1",
    actorUserId: "user-a",
    action: "vibe",
    retryDelaysMs: [0],
    sleep: async () => undefined,
    rpc: async () => {
      rpcCalls += 1;
      return { data: { success: true, state: "handshake" }, error: null };
    },
    fetchTruth: async () => ({ truth: baseTruth }),
  });

  assert.equal(rpcCalls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "decision_not_persisted");
  assert.equal(result.actorDecisionPersisted, false);
  assert.equal(result.persistedDecision, null);
});

test("transient RPC failure is retried before acknowledging Vibe", async () => {
  let rpcCalls = 0;
  const result = await persistHandshakeDecisionWithVerification({
    sessionId: "session-1",
    actorUserId: "user-a",
    action: "vibe",
    retryDelaysMs: [0],
    sleep: async () => undefined,
    rpc: async () => {
      rpcCalls += 1;
      if (rpcCalls === 1) {
        return { data: null, error: { message: "Failed to fetch" } };
      }
      return { data: { success: true, state: "handshake" }, error: null };
    },
    fetchTruth: async () => ({
      truth: {
        ...baseTruth,
        participant_1_liked: true,
        participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      },
    }),
  });

  assert.equal(rpcCalls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test("one vibe and partner undecided → Last Chance grace (10s), not date", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: true,
      participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      participant_2_liked: null,
    }),
    {
      kind: "waiting_for_decision",
      graceSecondsIfStartedNow: HANDSHAKE_LAST_CHANCE_GRACE_SECONDS,
      waitingForParticipant1: false,
      waitingForParticipant2: true,
    },
  );
});

test("both liked true proceeds to date", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: true,
      participant_2_liked: true,
      participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      participant_2_decided_at: "2026-04-24T06:02:03.000Z",
    }),
    { kind: "date" },
  );
});

test("one explicit pass ends as non-mutual", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: true,
      participant_2_liked: false,
      participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      participant_2_decided_at: "2026-04-24T06:02:03.000Z",
    }),
    { kind: "ended_non_mutual" },
  );
});

test("boolean false without decided_at is still undecided → 10s grace window", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: false,
      participant_2_liked: false,
    }),
    {
      kind: "waiting_for_decision",
      graceSecondsIfStartedNow: HANDSHAKE_LAST_CHANCE_GRACE_SECONDS,
      waitingForParticipant1: true,
      waitingForParticipant2: true,
    },
  );
});

test("both undecided → 10s Last Chance grace", () => {
  assert.deepEqual(completeHandshakeExpectation({ ...baseTruth }), {
    kind: "waiting_for_decision",
    graceSecondsIfStartedNow: HANDSHAKE_LAST_CHANCE_GRACE_SECONDS,
    waitingForParticipant1: true,
    waitingForParticipant2: true,
  });
});

test("explicit pass and partner undecided → terminal, no grace", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: false,
      participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      participant_2_liked: null,
    }),
    { kind: "ended_non_mutual" },
  );
});

test("explicit pass and partner vibe → terminal, no grace", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: false,
      participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      participant_2_liked: true,
      participant_2_decided_at: "2026-04-24T06:02:03.000Z",
    }),
    { kind: "ended_non_mutual" },
  );
});

test("both explicit pass → terminal, no grace", () => {
  assert.deepEqual(
    completeHandshakeExpectation({
      ...baseTruth,
      participant_1_liked: false,
      participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      participant_2_liked: false,
      participant_2_decided_at: "2026-04-24T06:02:03.000Z",
    }),
    { kind: "ended_non_mutual" },
  );
});

test("explicit pass persistence succeeds when false and decided_at are both stored", async () => {
  const result = await persistHandshakeDecisionWithVerification({
    sessionId: "session-1",
    actorUserId: "user-a",
    action: "pass",
    retryDelaysMs: [],
    rpc: async () => ({ data: { success: true, state: "handshake" }, error: null }),
    fetchTruth: async () => ({
      truth: {
        ...baseTruth,
        participant_1_liked: false,
        participant_1_decided_at: "2026-04-24T06:02:02.000Z",
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistedDecision, false);
});

test("handshakeTruthIndicatesEndedSession", () => {
  assert.equal(handshakeTruthIndicatesEndedSession(null), false);
  assert.equal(handshakeTruthIndicatesEndedSession({ ...baseTruth }), false);
  assert.equal(
    handshakeTruthIndicatesEndedSession({ ...baseTruth, ended_at: "2026-04-24T06:10:00.000Z" }),
    true,
  );
  assert.equal(handshakeTruthIndicatesEndedSession({ ...baseTruth, state: "ended" }), true);
  assert.equal(handshakeTruthIndicatesEndedSession({ ...baseTruth, phase: "ended" }), true);
});

test("handshakeRpcIndicatesTerminalDecisionRejection", () => {
  assert.equal(handshakeRpcIndicatesTerminalDecisionRejection(null), false);
  assert.equal(handshakeRpcIndicatesTerminalDecisionRejection({ success: false }), false);
  assert.equal(
    handshakeRpcIndicatesTerminalDecisionRejection({ success: false, code: "GRACE_EXPIRED" }),
    true,
  );
  assert.equal(
    handshakeRpcIndicatesTerminalDecisionRejection({ success: false, code: "SESSION_ENDED" }),
    true,
  );
  assert.equal(handshakeRpcIndicatesTerminalDecisionRejection({ state: "ended" }), true);
});

test("handshakeDecisionFailureIndicatesSessionEnded combines truth and payload", () => {
  assert.equal(
    handshakeDecisionFailureIndicatesSessionEnded({
      truth: { ...baseTruth, ended_at: "2026-04-24T06:10:00.000Z" },
      rpcPayload: null,
    }),
    true,
  );
  assert.equal(
    handshakeDecisionFailureIndicatesSessionEnded({
      truth: baseTruth,
      rpcPayload: { success: false, code: "GRACE_EXPIRED" },
    }),
    true,
  );
  assert.equal(
    handshakeDecisionFailureIndicatesSessionEnded({
      truth: baseTruth,
      rpcPayload: { success: true, state: "handshake" },
    }),
    false,
  );
});

test("persistHandshakeDecisionWithVerification: rpc_error returns fetched truth when prior truth was null", async () => {
  let fetchCount = 0;
  const result = await persistHandshakeDecisionWithVerification({
    sessionId: "session-1",
    actorUserId: "user-a",
    action: "vibe",
    retryDelaysMs: [],
    rpc: async () => ({
      data: null,
      error: { code: "PGRST301", message: "JSON object requested, multiple (or no) rows returned", name: "Error" },
    }),
    fetchTruth: async () => {
      fetchCount += 1;
      return {
        truth: {
          ...baseTruth,
          ended_at: "2026-04-24T06:10:00.000Z",
          state: "ended",
          phase: "ended",
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "rpc_error");
  assert.equal(fetchCount >= 1, true);
  assert.equal(handshakeTruthIndicatesEndedSession(result.truth), true);
});
