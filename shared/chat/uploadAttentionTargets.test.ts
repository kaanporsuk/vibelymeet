import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecoveryAttentionTargets,
  normalizeServerRecoveryAttentionTarget,
  selectPrimaryRecoveryAttentionTarget,
  uploadAttentionTargetIdentity,
  type UploadAttentionLocalItem,
  type UploadAttentionServerUpload,
} from "./uploadAttentionTargets";

function local(overrides: Partial<UploadAttentionLocalItem> = {}): UploadAttentionLocalItem {
  return {
    id: "local-1",
    matchId: "match-1",
    otherUserId: "user-1",
    payload: { kind: "image" },
    state: "failed",
    updatedAtMs: 2000,
    createdAtMs: 1000,
    ...overrides,
  };
}

function server(overrides: Partial<UploadAttentionServerUpload> = {}): UploadAttentionServerUpload {
  return {
    id: "server-1",
    matchId: "match-2",
    otherUserId: "user-2",
    clientRequestId: "client-2",
    status: "processing",
    updatedAt: "2026-05-20T12:00:00.000Z",
    recoveryDismissedAt: null,
    ...overrides,
  };
}

test("derives local failed upload targets with stable attention ids and labels", () => {
  const targets = buildRecoveryAttentionTargets([
    local({ id: "photo-1", payload: { kind: "image" } }),
    local({ id: "voice-1", payload: { kind: "voice" }, updatedAtMs: 1500 }),
    local({ id: "text-1", payload: { kind: "text" } }),
    local({ id: "queued-1", state: "queued" }),
  ], []);

  assert.deepEqual(targets.map((target) => target.attentionId), ["local:voice-1", "local:photo-1"]);
  assert.equal(targets[0].label, "Voice upload needs attention");
  assert.equal(targets[1].label, "Photo upload needs attention");
});

test("ignores targets that cannot navigate to an exact chat thread", () => {
  const targets = buildRecoveryAttentionTargets(
    [
      local({ id: "local-missing-peer", otherUserId: null }),
      local({ id: "local-blank-peer", otherUserId: " " }),
      local({ id: "local-ok", otherUserId: "user-1" }),
    ],
    [
      server({ id: "server-missing-peer", otherUserId: null }),
      server({ id: "server-blank-peer", otherUserId: " " }),
      server({ id: "server-ok", clientRequestId: "server-client-ok", otherUserId: "user-2" }),
    ],
  );

  assert.deepEqual(
    targets.map((target) => target.attentionId),
    ["local:local-ok", "server:server-ok"],
  );
});

test("normalizes ids before deriving target keys", () => {
  const targets = buildRecoveryAttentionTargets(
    [
      local({ id: " local-client ", otherUserId: "user-1" }),
      local({ id: " " }),
    ],
    [
      server({ id: " server-upload ", clientRequestId: " ", otherUserId: "user-2" }),
    ],
  );

  assert.deepEqual(
    targets.map((target) => [target.attentionId, target.clientRequestId]),
    [
      ["local:local-client", "local-client"],
      ["server:server-upload", "server-upload"],
    ],
  );
});

test("dedupes server stale uploads behind the matching local failed client request", () => {
  const targets = buildRecoveryAttentionTargets(
    [local({ id: "client-1", payload: { kind: "video" } })],
    [server({ id: "server-1", clientRequestId: "client-1", otherUserId: "user-1" })],
  );

  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, "local_failed");
  assert.equal(targets[0].attentionId, "local:client-1");
  assert.equal(targets[0].mediaKind, "clip");
});

test("derives server stale upload targets and ignores dismissed rows", () => {
  const targets = buildRecoveryAttentionTargets([], [
    server({ id: "dismissed", recoveryDismissedAt: "2026-05-20T12:01:00.000Z" }),
    server({ id: "published", publishedMessageId: "message-1" }),
    server({ id: "ready", status: "ready" }),
    server({ id: "stale-1", clientRequestId: "client-1", updatedAt: "2026-05-20T11:59:00.000Z" }),
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, "server_stale");
  assert.equal(targets[0].attentionId, "server:stale-1");
  assert.equal(targets[0].clientRequestId, "client-1");
  assert.equal(targets[0].label, "Clip upload needs attention");
});

test("selects the current chat target before the oldest fallback", () => {
  const targets = buildRecoveryAttentionTargets([
    local({ id: "old", otherUserId: "other-a", updatedAtMs: 1000 }),
    local({ id: "current", otherUserId: "other-b", updatedAtMs: 3000 }),
  ], []);

  assert.equal(selectPrimaryRecoveryAttentionTarget(targets, "other-b")?.attentionId, "local:current");
  assert.equal(selectPrimaryRecoveryAttentionTarget(targets, "missing")?.attentionId, "local:old");
});

test("target identity stays stable across status timestamp churn", () => {
  const first = buildRecoveryAttentionTargets(
    [local({ id: "voice-1", payload: { kind: "voice" }, updatedAtMs: 1000 })],
    [],
  )[0];
  const second = buildRecoveryAttentionTargets(
    [local({ id: "voice-1", payload: { kind: "voice" }, updatedAtMs: 4000 })],
    [],
  )[0];

  assert.equal(uploadAttentionTargetIdentity(first), uploadAttentionTargetIdentity(second));
});

test("rebases server targets onto the current upload row before acting", () => {
  const staleTarget = buildRecoveryAttentionTargets(
    [],
    [server({ id: "old-upload", clientRequestId: "client-2", status: "processing" })],
  )[0];

  const normalized = normalizeServerRecoveryAttentionTarget(
    staleTarget,
    server({
      id: "current-upload",
      clientRequestId: "client-2",
      status: "failed",
      updatedAt: "2026-05-20T12:05:00.000Z",
    }),
  );

  assert.equal(normalized?.attentionId, "server:current-upload");
  assert.equal(normalized?.clientRequestId, "client-2");
  assert.equal(normalized?.status, "failed");
  assert.ok((normalized?.updatedAtMs ?? 0) > staleTarget.updatedAtMs);
});
