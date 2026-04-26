import test from "node:test";
import assert from "node:assert/strict";
import {
  PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS,
  clearPreparedVideoDateEntryCache,
  getCachedPreparedVideoDateEntry,
  prepareVideoDateEntryWithClient,
  rejectCachedPreparedVideoDateEntry,
} from "./videoDatePrepareEntry";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function successPayload() {
  return {
    success: true as const,
    room_name: "date-11111111111141118111111111111111",
    room_url: "https://vibelyapp.daily.co/date-11111111111141118111111111111111",
    token: "short-lived-client-token",
    session_state: "handshake",
    session_phase: "handshake",
    handshake_started_at: "2026-04-24T00:33:01.000Z",
  };
}

test("prepareVideoDateEntryWithClient caches a successful token by session and user", async () => {
  clearPreparedVideoDateEntryCache();
  let calls = 0;

  const first = await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 1000,
    bothReadyObservedAtMs: 900,
    invoke: async () => {
      calls += 1;
      return { data: successPayload() };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(first.ok, true);
  assert.equal(first.ok && first.cached, false);
  assert.equal(calls, 1);

  const cached = await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 2000,
    invoke: async () => {
      calls += 1;
      return { data: successPayload() };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(cached.ok, true);
  assert.equal(cached.ok && cached.cached, true);
  assert.equal(calls, 1);
  assert.equal(getCachedPreparedVideoDateEntry(SESSION_ID, USER_ID, 2000)?.value.token, "short-lived-client-token");
});

test("prepareVideoDateEntryWithClient falls back when cache is stale or rejected", async () => {
  clearPreparedVideoDateEntryCache();
  let calls = 0;

  await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 1000,
    invoke: async () => {
      calls += 1;
      return { data: successPayload() };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(rejectCachedPreparedVideoDateEntry(SESSION_ID, USER_ID), true);

  const afterReject = await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 2000,
    invoke: async () => {
      calls += 1;
      return { data: { ...successPayload(), token: "fresh-after-reject" } };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(afterReject.ok, true);
  assert.equal(afterReject.ok && afterReject.data.token, "fresh-after-reject");

  const cachedEntry = getCachedPreparedVideoDateEntry(SESSION_ID, USER_ID);
  assert.ok(cachedEntry);
  const stale = getCachedPreparedVideoDateEntry(SESSION_ID, USER_ID, cachedEntry.expiresAtMs + 1);
  assert.equal(stale, null);

  const afterStale = await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: cachedEntry.expiresAtMs + 1,
    invoke: async () => {
      calls += 1;
      return { data: { ...successPayload(), token: "fresh-after-stale" } };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(afterStale.ok, true);
  assert.equal(afterStale.ok && afterStale.data.token, "fresh-after-stale");
  assert.equal(calls, 3);
});

test("prepareVideoDateEntryWithClient dedupes concurrent double prepare for one user/session", async () => {
  clearPreparedVideoDateEntryCache();
  let calls = 0;
  let releaseInvoke: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseInvoke = resolve;
  });

  const first = prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 1000,
    invoke: async () => {
      calls += 1;
      await gate;
      return { data: { ...successPayload(), token: "deduped-token" } };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  const second = prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 1001,
    invoke: async () => {
      calls += 1;
      return { data: { ...successPayload(), token: "unexpected-second-token" } };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(calls, 1);
  releaseInvoke?.();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(firstResult.ok && firstResult.data.token, "deduped-token");
  assert.equal(secondResult.ok && secondResult.data.token, "deduped-token");
  assert.equal(calls, 1);
});

test("prepareVideoDateEntryWithClient uses short TTL and refreshes after join-failure rejection", async () => {
  clearPreparedVideoDateEntryCache();
  let calls = 0;

  const prepared = await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 10_000,
    invoke: async () => {
      calls += 1;
      return { data: { ...successPayload(), token: "prewarmed-before-join" } };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(prepared.ok, true);
  const entry = getCachedPreparedVideoDateEntry(SESSION_ID, USER_ID, 10_000);
  assert.ok(entry);
  assert.equal(entry.expiresAtMs - entry.cachedAtMs, PREPARED_VIDEO_DATE_ENTRY_CACHE_TTL_MS);

  assert.equal(rejectCachedPreparedVideoDateEntry(SESSION_ID, USER_ID), true);

  const afterJoinFailure = await prepareVideoDateEntryWithClient({
    sessionId: SESSION_ID,
    userId: USER_ID,
    nowMs: 11_000,
    invoke: async () => {
      calls += 1;
      return { data: { ...successPayload(), token: "fresh-after-join-failure" } };
    },
    classifyFailure: async () => ({ kind: "unknown", retryable: false }),
  });

  assert.equal(afterJoinFailure.ok, true);
  assert.equal(afterJoinFailure.ok && afterJoinFailure.cached, false);
  assert.equal(afterJoinFailure.ok && afterJoinFailure.data.token, "fresh-after-join-failure");
  assert.equal(calls, 2);
});
