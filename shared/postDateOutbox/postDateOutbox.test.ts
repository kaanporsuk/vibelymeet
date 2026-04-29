import test from "node:test";
import assert from "node:assert/strict";
import {
  isPostDateOutboxItemSendable,
  newPostDateOutboxItem,
  nextPostDateOutboxBackoffMs,
  postDateOutboxStorageDedupeKey,
  upsertPostDateOutboxItem,
} from "./core";

test("post-date outbox stores one pending verdict per user/session", () => {
  const first = newPostDateOutboxItem({
    id: "first",
    userId: "user-1",
    sessionId: "session-1",
    online: true,
    nowMs: 100,
    payload: { kind: "verdict", liked: true },
  });
  const replacement = newPostDateOutboxItem({
    id: "second",
    userId: "user-1",
    sessionId: "session-1",
    online: true,
    nowMs: 200,
    payload: { kind: "verdict", liked: false, report: { reason: "harassment", alsoBlock: true } },
  });

  const items = upsertPostDateOutboxItem([first], replacement);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "first");
  assert.equal(postDateOutboxStorageDedupeKey(items[0]), "user-1:session-1:verdict");
  assert.equal(items[0].payload.kind === "verdict" && items[0].payload.liked, false);
});

test("post-date outbox retry preserves idempotency key and retries immediately", () => {
  const failed = {
    ...newPostDateOutboxItem({
      id: "stable-id",
      userId: "user-1",
      sessionId: "session-1",
      online: true,
      nowMs: 100,
      payload: { kind: "verdict" as const, liked: true },
    }),
    state: "failed" as const,
    attemptCount: 2,
    lastError: "Couldn't save your answer. Tap to retry.",
    nextRetryAtMs: 10_000,
  };
  const retry = newPostDateOutboxItem({
    id: "new-id",
    userId: "user-1",
    sessionId: "session-1",
    online: true,
    nowMs: 200,
    payload: { kind: "verdict", liked: true },
  });

  const items = upsertPostDateOutboxItem([failed], retry);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "stable-id");
  assert.equal(items[0].state, "queued");
  assert.equal(items[0].lastError, undefined);
  assert.equal(items[0].nextRetryAtMs, undefined);
});

test("post-date outbox sendability respects network and retry backoff", () => {
  const item = newPostDateOutboxItem({
    id: "item-1",
    userId: "user-1",
    sessionId: "session-1",
    online: false,
    nowMs: 100,
    payload: { kind: "report", report: { reason: "fake", alsoBlock: false } },
  });

  assert.equal(isPostDateOutboxItemSendable(item, false, 200), false);
  assert.equal(isPostDateOutboxItemSendable(item, true, 200), true);
  assert.equal(nextPostDateOutboxBackoffMs(1), 1_000);
  assert.equal(nextPostDateOutboxBackoffMs(99), 300_000);
});
