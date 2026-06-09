import test from "node:test";
import assert from "node:assert/strict";
import {
  appendVideoDateDeckMediaVersion,
  getVideoDateDeckAdaptiveRefetchIntervalMs,
  getVideoDateDeckPrefetchItems,
  getVideoDateSwipeRateLimitRetryUntilMs,
  isVideoDateSwipeRateLimited,
  recordVideoDateDeckRecentSwipe,
  removeVideoDateDeckRecentSwipe,
  shouldRestoreVideoDateDeckCardAfterSwipeFailure,
  shouldSuppressVideoDateDeckProfile,
  VIDEO_DATE_DECK_PREFETCH_LIMIT,
  VIDEO_DATE_DECK_RECENT_SWIPE_TTL_MS,
  VIDEO_DATE_DECK_DEFAULT_REFETCH_INTERVAL_MS,
  VIDEO_DATE_DECK_FINAL_REFETCH_INTERVAL_MS,
  VIDEO_DATE_DECK_LAST_CHANCE_REFETCH_INTERVAL_MS,
  VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS,
} from "./videoDateDeckPrefetch";

test("predictive deck prefetch items include media-versioned cache keys", () => {
  const items = getVideoDateDeckPrefetchItems([
    {
      id: "p1",
      primary_photo_path: "photos/a.jpg",
      media_version: "2026-05-24T12:00:00.000Z",
    },
    {
      id: "p2",
      photos: ["photos/b.jpg"],
      media_version: 42,
    },
  ]);

  assert.equal(VIDEO_DATE_DECK_PREFETCH_LIMIT, 3);
  assert.equal(items.length, 2);
  assert.equal(items[0].mediaVersion, "2026-05-24T12:00:00.000Z");
  assert.match(items[0].cacheKey, /p1:2026-05-24T12:00:00\.000Z:photos\/a\.jpg/);
  assert.equal(appendVideoDateDeckMediaVersion("https://cdn.test/photo.jpg", items[1].mediaVersion), "https://cdn.test/photo.jpg?v=42");
  assert.equal(
    getVideoDateDeckPrefetchItems([
      { id: "p1", primary_photo_path: "photos/shared.jpg", media_version: "same" },
      { id: "p2", primary_photo_path: "photos/shared.jpg", media_version: "same" },
      { id: "p3", primary_photo_path: "photos/next.jpg", media_version: "same" },
    ]).map((item) => item.profileId).join(","),
    "p1,p3",
  );
});

test("predictive deck source selection ignores whitespace-only media fields", () => {
  const [item] = getVideoDateDeckPrefetchItems([
    {
      id: " p1 ",
      primary_photo_path: " ",
      photos: ["", " photos/fallback.jpg "],
      avatar_url: "photos/avatar.jpg",
    },
  ]);

  assert.equal(item.profileId, "p1");
  assert.equal(item.source, "photos/fallback.jpg");
  assert.equal(item.sourceKind, "photo");
  assert.equal(getVideoDateDeckPrefetchItems([{ id: "p2", primary_photo_path: "photos/a.jpg" }], Number.NaN).length, 1);
  assert.equal(getVideoDateDeckPrefetchItems([{ id: "p2", primary_photo_path: "photos/a.jpg" }], -1).length, 0);
});

test("adaptive deck refetch follows late-event and visible-card cadence", () => {
  const nowMs = Date.parse("2026-05-24T12:00:00.000Z");

  assert.equal(
    getVideoDateDeckAdaptiveRefetchIntervalMs({
      enabled: true,
      nowMs,
      eventEndAtMs: nowMs + 10 * 60_000,
      visibleCount: 4,
    }),
    VIDEO_DATE_DECK_DEFAULT_REFETCH_INTERVAL_MS,
  );
  assert.equal(
    getVideoDateDeckAdaptiveRefetchIntervalMs({
      enabled: true,
      nowMs,
      eventEndAtMs: nowMs + 4 * 60_000,
      visibleCount: 4,
    }),
    VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS,
  );
  assert.equal(
    getVideoDateDeckAdaptiveRefetchIntervalMs({
      enabled: true,
      nowMs,
      eventEndAtMs: nowMs + 90_000,
      visibleCount: 4,
    }),
    VIDEO_DATE_DECK_FINAL_REFETCH_INTERVAL_MS,
  );
  assert.equal(
    getVideoDateDeckAdaptiveRefetchIntervalMs({
      enabled: true,
      nowMs,
      eventEndAtMs: nowMs + 25_000,
      visibleCount: 1,
    }),
    VIDEO_DATE_DECK_LAST_CHANCE_REFETCH_INTERVAL_MS,
  );
  assert.equal(
    getVideoDateDeckAdaptiveRefetchIntervalMs({
      enabled: true,
      nowMs,
      eventEndAtMs: nowMs + 10 * 60_000,
      visibleCount: 1,
    }),
    VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS,
  );
  assert.equal(getVideoDateDeckAdaptiveRefetchIntervalMs({ enabled: false, nowMs }), false);
  assert.equal(
    getVideoDateDeckAdaptiveRefetchIntervalMs({
      enabled: true,
      nowMs,
      eventEndAtMs: nowMs + 10 * 60_000,
      visibleCount: Number.NaN,
    }),
    VIDEO_DATE_DECK_LATE_REFETCH_INTERVAL_MS,
  );
});

test("recent swipe suppression keeps last targets out briefly and supports rollback", () => {
  const nowMs = 1_000_000;
  const entries = recordVideoDateDeckRecentSwipe([], "p1", nowMs);

  assert.equal(VIDEO_DATE_DECK_RECENT_SWIPE_TTL_MS, 90_000);
  assert.equal(shouldSuppressVideoDateDeckProfile({ id: "p1" }, entries, nowMs + 30_000), true);
  assert.equal(shouldSuppressVideoDateDeckProfile({ id: "p1" }, entries, nowMs + 89_000), true);
  assert.equal(shouldSuppressVideoDateDeckProfile({ id: "p1" }, entries, nowMs + 91_000), false);
  assert.equal(shouldSuppressVideoDateDeckProfile({ id: "p2" }, [{ profileId: "p2", swipedAtMs: nowMs + 10_000 }], nowMs), false);
  assert.equal(
    shouldSuppressVideoDateDeckProfile({ id: "p1" }, removeVideoDateDeckRecentSwipe(entries, "p1", nowMs + 5_000), nowMs + 5_000),
    false,
  );
});

test("swipe 429 helpers normalize retry-after shapes", () => {
  const nowMs = Date.parse("2026-05-24T12:00:00.000Z");
  const retryAt = "Sun, 24 May 2026 12:00:11 GMT";

  assert.equal(isVideoDateSwipeRateLimited({ outcome: " Rate_Limited " }), true);
  assert.equal(
    getVideoDateSwipeRateLimitRetryUntilMs({ result: "rate_limited", retry_after_seconds: 7 }, nowMs),
    nowMs + 7_000,
  );
  assert.equal(
    getVideoDateSwipeRateLimitRetryUntilMs({ result: "rate_limited" }, nowMs, "3"),
    nowMs + 3_000,
  );
  assert.equal(
    getVideoDateSwipeRateLimitRetryUntilMs({ result: "rate_limited", retry_after: retryAt }, nowMs),
    Date.parse(retryAt),
  );
});

test("deck swipe rollback restores retryable failures but not permanent no-restore outcomes", () => {
  assert.equal(shouldRestoreVideoDateDeckCardAfterSwipeFailure("rate_limited"), true);
  assert.equal(shouldRestoreVideoDateDeckCardAfterSwipeFailure("internal_error"), true);
  assert.equal(shouldRestoreVideoDateDeckCardAfterSwipeFailure("blocked"), false);
  assert.equal(shouldRestoreVideoDateDeckCardAfterSwipeFailure("reported"), false);
  assert.equal(shouldRestoreVideoDateDeckCardAfterSwipeFailure("target_not_found"), false);
  assert.equal(shouldRestoreVideoDateDeckCardAfterSwipeFailure({ result: "already_swiped" }), false);
});
