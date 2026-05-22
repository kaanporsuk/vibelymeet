import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecoveryAttentionTargets,
  recoveryAttentionKey,
  selectPrimaryRecoveryAttentionTarget,
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

test("attention key changes when target routing identity, status, or timestamp changes", () => {
  const targets = buildRecoveryAttentionTargets(
    [local({ id: "photo-1", updatedAtMs: 1000 })],
    [server({ id: "server-1", clientRequestId: "client-1", status: "uploading" })],
  );

  assert.equal(
    recoveryAttentionKey(targets),
    `local:photo-1:match-1:user-1:failed:1000|server:server-1:match-2:user-2:uploading:${Date.parse("2026-05-20T12:00:00.000Z")}`,
  );
});
