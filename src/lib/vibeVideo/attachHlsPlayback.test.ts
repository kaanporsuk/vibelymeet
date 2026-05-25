import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __setHlsLoaderForTest,
  attachHlsPlayback,
  hlsPlaybackErrorStatusCode,
  type HlsAuthErrorRefreshDetail,
  type HlsPlaybackErrorKind,
} from "./attachHlsPlayback.ts";

type HlsCallback = (event: unknown, data?: unknown) => void;
type HlsConstructor = typeof import("hls.js").default;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeVideo {
  src = "";
  loadCalls = 0;
  playCalls = 0;
  pauseCalls = 0;
  removedSrc = false;
  paused = true;
  ended = false;
  readyState = 4;
  private listeners = new Map<string, Set<() => void>>();

  constructor(private readonly nativeHls: boolean) {}

  canPlayType(type: string): string {
    return this.nativeHls && type === "application/vnd.apple.mpegurl" ? "probably" : "";
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener();
    return true;
  }

  load(): void {
    this.loadCalls += 1;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.removedSrc = true;
    }
  }
}

class FakeHls {
  static Events = {
    ERROR: "hlsError",
    LEVEL_SWITCHED: "levelSwitched",
    MANIFEST_PARSED: "manifestParsed",
  };

  static instances: FakeHls[] = [];

  static isSupported(): boolean {
    return true;
  }

  sourceHistory: string[] = [];
  startLoadCalls = 0;
  destroyed = false;
  levels = [];
  autoLevelCapping = -1;
  startLevel = -1;
  private callbacks = new Map<string, HlsCallback[]>();

  constructor(_config: unknown) {
    FakeHls.instances.push(this);
  }

  loadSource(src: string): void {
    this.sourceHistory.push(src);
  }

  attachMedia(_video: unknown): void {}

  startLoad(): void {
    this.startLoadCalls += 1;
  }

  destroy(): void {
    this.destroyed = true;
  }

  on(event: string, callback: HlsCallback): void {
    const callbacks = this.callbacks.get(event) ?? [];
    callbacks.push(callback);
    this.callbacks.set(event, callbacks);
  }

  emit(event: string, data?: unknown): void {
    for (const callback of this.callbacks.get(event) ?? []) callback(event, data);
  }
}

async function attachWithFakeHls(
  video: FakeVideo,
  options: Parameters<typeof attachHlsPlayback>[2] = {},
): Promise<{ cleanup: () => void; hls: FakeHls }> {
  FakeHls.instances = [];
  __setHlsLoaderForTest(async () => ({ default: FakeHls as unknown as HlsConstructor }));
  const cleanup = attachHlsPlayback(video as unknown as HTMLVideoElement, "old.m3u8", options);
  await flush();
  const hls = FakeHls.instances[0];
  assert.ok(hls, "hls.js instance should be created");
  return { cleanup, hls };
}

afterEach(() => {
  __setHlsLoaderForTest(null);
  FakeHls.instances = [];
});

test("extracts HLS playback HTTP status without exposing raw error details", () => {
  assert.equal(hlsPlaybackErrorStatusCode({ response: { code: 403 } }), 403);
  assert.equal(hlsPlaybackErrorStatusCode({ response: { status: 404 } }), 404);
  assert.equal(hlsPlaybackErrorStatusCode({ networkDetails: { statusCode: 503 } }), 503);
  assert.equal(hlsPlaybackErrorStatusCode({ details: "manifestLoadError" }), null);
  assert.equal(hlsPlaybackErrorStatusCode(null), null);
});

test("hls.js auth errors refresh the signed source and restart loading once", async () => {
  const video = new FakeVideo(false);
  const refreshDetails: HlsAuthErrorRefreshDetail[] = [];
  const errors: HlsPlaybackErrorKind[] = [];
  const { cleanup, hls } = await attachWithFakeHls(video, {
    onAuthErrorRefresh: async (detail) => {
      refreshDetails.push(detail);
      return "fresh.m3u8";
    },
    onError: (kind) => errors.push(kind),
  });

  hls.emit(FakeHls.Events.ERROR, {
    fatal: true,
    type: "networkError",
    details: "manifestLoadError",
    response: { code: 401 },
  });
  await flush();

  assert.equal(refreshDetails.length, 1);
  assert.deepEqual(refreshDetails[0], {
    attempt: 1,
    maxAttempts: 2,
    playbackMode: "hls_js",
    statusCode: 401,
    errorType: "networkError",
    errorDetails: "manifestLoadError",
  });
  assert.deepEqual(hls.sourceHistory, ["old.m3u8", "fresh.m3u8"]);
  assert.equal(hls.startLoadCalls, 1);
  assert.equal(errors.length, 0);
  cleanup();
});

test("hls.js proactive token refresh swaps the source without reporting playback errors", async () => {
  const video = new FakeVideo(false);
  let refreshCalls = 0;
  const errors: HlsPlaybackErrorKind[] = [];
  const { cleanup, hls } = await attachWithFakeHls(video, {
    expiresAtMs: Date.now() + 10,
    onProactiveRefresh: () => {
      refreshCalls += 1;
      return { url: "proactive-fresh.m3u8", expiresAtMs: Date.now() + 120_000 };
    },
    onError: (kind) => errors.push(kind),
  });

  hls.emit(FakeHls.Events.MANIFEST_PARSED);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(refreshCalls, 1);
  assert.deepEqual(hls.sourceHistory, ["old.m3u8", "proactive-fresh.m3u8"]);
  assert.equal(hls.startLoadCalls, 1);
  assert.deepEqual(errors, []);
  cleanup();
});

test("hls.js legacy string auth refresh clears stale expiry instead of entering proactive refresh", async () => {
  const video = new FakeVideo(false);
  let proactiveRefreshCalls = 0;
  const { cleanup, hls } = await attachWithFakeHls(video, {
    expiresAtMs: Date.now() + 10,
    onAuthErrorRefresh: () => "auth-fresh.m3u8",
    onProactiveRefresh: () => {
      proactiveRefreshCalls += 1;
      return { url: "unexpected-proactive.m3u8", expiresAtMs: Date.now() + 120_000 };
    },
  });

  hls.emit(FakeHls.Events.ERROR, {
    fatal: true,
    type: "networkError",
    details: "manifestLoadError",
    response: { code: 401 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(proactiveRefreshCalls, 0);
  assert.deepEqual(hls.sourceHistory, ["old.m3u8", "auth-fresh.m3u8"]);
  cleanup();
});

test("hls.js non-auth fatal errors do not trigger token refresh", async () => {
  const video = new FakeVideo(false);
  let refreshCalls = 0;
  const errors: HlsPlaybackErrorKind[] = [];
  const { cleanup, hls } = await attachWithFakeHls(video, {
    onAuthErrorRefresh: () => {
      refreshCalls += 1;
      return "should-not-load.m3u8";
    },
    onError: (kind) => errors.push(kind),
  });

  hls.emit(FakeHls.Events.ERROR, { fatal: true, response: { status: 404 } });
  await flush();

  assert.equal(refreshCalls, 0);
  assert.deepEqual(hls.sourceHistory, ["old.m3u8"]);
  assert.deepEqual(errors, ["fatal"]);
  cleanup();
});

test("hls.js auth refresh dedupes duplicate in-flight auth errors", async () => {
  const video = new FakeVideo(false);
  let resolveRefresh: (value: string) => void = () => {};
  let refreshCalls = 0;
  const { cleanup, hls } = await attachWithFakeHls(video, {
    onAuthErrorRefresh: () => {
      refreshCalls += 1;
      return new Promise<string>((resolve) => {
        resolveRefresh = resolve;
      });
    },
  });

  hls.emit(FakeHls.Events.ERROR, { fatal: true, response: { code: 403 } });
  hls.emit(FakeHls.Events.ERROR, { fatal: true, response: { code: 403 } });
  await flush();

  assert.equal(refreshCalls, 1);
  resolveRefresh("deduped-fresh.m3u8");
  await flush();

  assert.deepEqual(hls.sourceHistory, ["old.m3u8", "deduped-fresh.m3u8"]);
  assert.equal(hls.startLoadCalls, 1);
  cleanup();
});

test("hls.js auth refresh is capped before fatal error reporting resumes", async () => {
  const video = new FakeVideo(false);
  let refreshCalls = 0;
  const errors: HlsPlaybackErrorKind[] = [];
  const { cleanup, hls } = await attachWithFakeHls(video, {
    onAuthErrorRefresh: () => {
      refreshCalls += 1;
      return `fresh-${refreshCalls}.m3u8`;
    },
    onError: (kind) => errors.push(kind),
  });

  hls.emit(FakeHls.Events.ERROR, { fatal: true, response: { code: 401 } });
  await flush();
  hls.emit(FakeHls.Events.ERROR, { fatal: true, response: { code: 401 } });
  await flush();
  hls.emit(FakeHls.Events.ERROR, { fatal: true, response: { code: 401 } });
  await flush();

  assert.equal(refreshCalls, 2);
  assert.deepEqual(hls.sourceHistory, ["old.m3u8", "fresh-1.m3u8", "fresh-2.m3u8"]);
  assert.deepEqual(errors, ["fatal"]);
  cleanup();
});

test("native browser HLS refreshes on video errors but remains bounded", async () => {
  const video = new FakeVideo(true);
  const refreshDetails: HlsAuthErrorRefreshDetail[] = [];
  const errors: HlsPlaybackErrorKind[] = [];
  const cleanup = attachHlsPlayback(video as unknown as HTMLVideoElement, "native-old.m3u8", {
    onAuthErrorRefresh: async (detail) => {
      refreshDetails.push(detail);
      return `native-fresh-${detail.attempt}.m3u8`;
    },
    onError: (kind) => errors.push(kind),
  });

  assert.equal(video.src, "native-old.m3u8");
  video.dispatchEvent(new Event("error"));
  await flush();
  video.dispatchEvent(new Event("error"));
  await flush();
  video.dispatchEvent(new Event("error"));
  await flush();

  assert.deepEqual(
    refreshDetails.map((detail) => ({
      attempt: detail.attempt,
      maxAttempts: detail.maxAttempts,
      playbackMode: detail.playbackMode,
      statusCode: detail.statusCode,
    })),
    [
      { attempt: 1, maxAttempts: 2, playbackMode: "native", statusCode: null },
      { attempt: 2, maxAttempts: 2, playbackMode: "native", statusCode: null },
    ],
  );
  assert.equal(video.src, "native-fresh-2.m3u8");
  assert.deepEqual(errors, ["native"]);
  cleanup();
});
