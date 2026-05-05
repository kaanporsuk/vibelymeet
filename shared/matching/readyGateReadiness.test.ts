import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveReadyGateReadinessState,
  getReadyGateReadinessStatusCopy,
  type ReadyGateReadinessState,
} from "./readyGateReadiness";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const p1 = "user-a";
const p2 = "user-b";
const readyAt = "2026-05-06T10:00:00.000Z";

test("partner already ready plus current ready resolves to connecting copy for participant 1", () => {
  const beforeTap = deriveReadyGateReadinessState({
    userId: p1,
    truth: {
      participant_1_id: p1,
      participant_2_id: p2,
      ready_gate_status: "ready_b",
      ready_participant_1_at: null,
      ready_participant_2_at: readyAt,
    },
  });

  assert.equal(beforeTap.iAmReady, false);
  assert.equal(beforeTap.partnerReady, true);
  assert.equal(beforeTap.partnerReadyKnown, true);

  const afterTap = deriveReadyGateReadinessState({
    userId: p1,
    previous: beforeTap,
    truth: {
      participant_1_id: p1,
      participant_2_id: p2,
      status: "both_ready",
    },
  });

  const copy = getReadyGateReadinessStatusCopy({
    ...afterTap,
    partnerName: "Mina",
  });

  assert.equal(afterTap.isBothReady, true);
  assert.equal(copy.key, "both_ready_connecting");
  assert.doesNotMatch(copy.text, /Waiting for Mina/);
});

test("partner already ready plus current ready resolves to connecting copy for participant 2", () => {
  const beforeTap = deriveReadyGateReadinessState({
    userId: p2,
    truth: {
      participant_1_id: p1,
      participant_2_id: p2,
      ready_gate_status: "ready_a",
      ready_participant_1_at: readyAt,
      ready_participant_2_at: null,
    },
  });

  const afterTap = deriveReadyGateReadinessState({
    userId: p2,
    previous: beforeTap,
    truth: {
      participant_1_id: p1,
      participant_2_id: p2,
      result_ready_gate_status: "both_ready",
    },
  });

  assert.equal(beforeTap.partnerReady, true);
  assert.equal(afterTap.iAmReady, true);
  assert.equal(afterTap.partnerReady, true);
  assert.equal(getReadyGateReadinessStatusCopy(afterTap).key, "both_ready_connecting");
});

test("unknown partner readiness stays neutral after current user is ready", () => {
  const state: ReadyGateReadinessState = {
    iAmReady: true,
    partnerReady: false,
    iAmReadyKnown: true,
    partnerReadyKnown: false,
    isBothReady: false,
    participantPosition: "p1",
  };

  const copy = getReadyGateReadinessStatusCopy({
    ...state,
    partnerName: "Ari",
  });

  assert.equal(copy.key, "syncing");
  assert.equal(copy.text, "Getting your date ready...");
});

test("definite partner-not-ready truth is the only waiting-for-partner copy", () => {
  const state = deriveReadyGateReadinessState({
    userId: p1,
    truth: {
      participant_1_id: p1,
      participant_2_id: p2,
      ready_gate_status: "ready_a",
      ready_participant_1_at: readyAt,
      ready_participant_2_at: null,
    },
  });

  const copy = getReadyGateReadinessStatusCopy({
    ...state,
    partnerName: "Deniz",
  });

  assert.equal(state.iAmReady, true);
  assert.equal(state.partnerReadyKnown, true);
  assert.equal(state.partnerReady, false);
  assert.equal(copy.key, "waiting_partner");
  assert.equal(copy.text, "You're ready. Waiting for Deniz...");
});

test("partial transition payloads do not regress known partner-ready truth", () => {
  const previous: ReadyGateReadinessState = {
    iAmReady: false,
    partnerReady: true,
    iAmReadyKnown: true,
    partnerReadyKnown: true,
    isBothReady: false,
    participantPosition: "p1",
  };

  const next = deriveReadyGateReadinessState({
    userId: p1,
    previous,
    truth: {
      participant_1_id: p1,
      participant_2_id: p2,
      ready_gate_status: "ready_a",
    },
  });

  assert.equal(next.partnerReady, true);
  assert.equal(next.partnerReadyKnown, true);
});

test("marking ready while partner is already ready shows connecting copy only", () => {
  const copy = getReadyGateReadinessStatusCopy({
    iAmReady: false,
    partnerReady: true,
    partnerReadyKnown: true,
    markingReady: true,
    partnerName: "Mina",
  });

  assert.equal(copy.key, "both_ready_connecting");
  assert.doesNotMatch(copy.text, /Waiting for/);
});

test("Ready Gate surfaces consume shared copy instead of unconditional ready-wait copy", () => {
  const sources = [
    read("src/components/lobby/ReadyGateOverlay.tsx"),
    read("apps/mobile/components/lobby/ReadyGateOverlay.tsx"),
    read("apps/mobile/app/ready/[id].tsx"),
  ];

  for (const source of sources) {
    assert.match(source, /getReadyGateReadinessStatusCopy/);
    assert.doesNotMatch(source, /iAmReady\s*\?\s*`You're ready\. Waiting/);
    assert.doesNotMatch(source, /You(?:&apos;|')re ready\. Waiting for \{/);
    assert.doesNotMatch(source, /You're ready!\s*Waiting for \{/);
  }
});
