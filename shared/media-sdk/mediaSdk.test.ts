import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertNativeUriSource,
  createNativeMediaSdk,
  nativeMediaTranscodeHooks,
  NativeAsyncStorageMediaUploadQueue,
} from "./adapters/native";
import { assertWebMediaSource, createWebMediaSdk, IndexedDbMediaUploadQueue, webMediaTranscode } from "./adapters/web";
import { createNativeMediaSdk as createNativeMediaSdkFromRoot, createWebMediaSdk as createWebMediaSdkFromRoot } from ".";
import { MemoryMediaUploadQueue, type MediaUploadQueueRecord } from "./core/queue";
import type { MediaTelemetrySink } from "./core/telemetry";
import { safeTelemetryFields } from "./core/telemetry";
import {
  createMediaUploadPathTelemetryFields,
  MEDIA_UPLOAD_PATH_EVENT_NAMES,
  mediaUploadRuntimePath,
} from "./core/facade-telemetry";
import { reconcileMediaUploadQueue } from "./core/reconcile";
import { createMediaUploadTask, waitForMediaUploadTaskTerminal } from "./core/task";
import {
  createInitialMediaUploadSnapshot,
  transitionMediaUploadState,
} from "./core/state-machine";

const uuid = "11111111-1111-4111-8111-111111111111";
const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(`${repoRoot}/${path}`, "utf8");
}

async function flushMediaTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("media upload state machine follows the canonical upload lifecycle", () => {
  let snapshot = createInitialMediaUploadSnapshot({
    id: "task-1",
    clientRequestId: uuid,
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  });

  assert.equal(snapshot.state, "created");
  snapshot = transitionMediaUploadState(snapshot, { type: "begin_upload", atMs: 2 });
  assert.equal(snapshot.state, "uploading");
  snapshot = transitionMediaUploadState(snapshot, { type: "progress", progress: 0.4, atMs: 3 });
  assert.equal(snapshot.progress, 0.4);
  snapshot = transitionMediaUploadState(snapshot, { type: "progress", progress: 0.2, atMs: 4 });
  assert.equal(snapshot.progress, 0.4, "progress cannot move backwards");
  snapshot = transitionMediaUploadState(snapshot, { type: "pause", atMs: 4.5 });
  assert.equal(snapshot.state, "paused");
  snapshot = transitionMediaUploadState(snapshot, { type: "resume", atMs: 4.75 });
  assert.equal(snapshot.state, "uploading");
  snapshot = transitionMediaUploadState(snapshot, { type: "upload_complete", atMs: 5 });
  assert.equal(snapshot.state, "processing");
  assert.equal(snapshot.progress, 1);
  snapshot = transitionMediaUploadState(snapshot, {
    type: "ready",
    result: { providerObjectId: "video-guid" },
    atMs: 6,
  });
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.result?.providerObjectId, "video-guid");

  const terminal = transitionMediaUploadState(snapshot, {
    type: "fail",
    error: { code: "late_failure" },
    atMs: 7,
  });
  assert.equal(terminal.state, "ready", "ready is terminal and ignores late failures");
});

test("media task pause and resume update visible state and telemetry", async () => {
  const events: string[] = [];
  const task = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: uuid },
    },
    platform: "web",
    telemetry: {
      emit(event) {
        events.push(event.name);
      },
      exception() {},
    },
    runner: (controls) => {
      controls.bindLifecycle({
        pause: () => undefined,
        resume: () => undefined,
      });
    },
  });

  await flushMediaTask();
  assert.equal(task.snapshot().state, "uploading");
  await task.pause();
  assert.equal(task.snapshot().state, "paused");
  await task.resume();
  assert.equal(task.snapshot().state, "uploading");
  assert.deepEqual(events, ["media_upload_pause_requested", "media_upload_resume_requested"]);
});

test("media task reports lifecycle pause and resume control failures", async () => {
  const exceptions: Array<{ error: unknown; fields?: Record<string, unknown> }> = [];
  const telemetry = {
    emit() {},
    exception(error: unknown, fields?: Record<string, unknown>) {
      exceptions.push({ error, fields });
    },
  };
  const pauseTask = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: `${uuid}-pause` },
    },
    platform: "web",
    telemetry,
    runner: (controls) => {
      controls.bindLifecycle({
        pause: () => {
          throw new Error("pause exploded");
        },
      });
    },
  });

  await flushMediaTask();
  await assert.rejects(() => pauseTask.pause(), /pause exploded/);
  assert.equal(pauseTask.snapshot().state, "uploading");
  assert.equal(exceptions[0]?.fields?.event, "pause");

  const resumeTask = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: `${uuid}-resume` },
    },
    platform: "web",
    telemetry,
    runner: (controls) => {
      controls.bindLifecycle({
        pause: () => undefined,
        resume: () => {
          throw new Error("resume exploded");
        },
      });
    },
  });

  await flushMediaTask();
  await resumeTask.pause();
  await assert.rejects(() => resumeTask.resume(), /resume exploded/);
  assert.equal(resumeTask.snapshot().state, "paused");
  assert.equal(exceptions[1]?.fields?.event, "resume");
});

test("media task does not claim paused or resumed when lifecycle controls are unsupported", async () => {
  const events: Array<{ name: string; state?: string; reason?: unknown }> = [];
  const task = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: uuid },
    },
    platform: "web",
    telemetry: {
      emit(event) {
        events.push({
          name: event.name,
          state: event.state,
          reason: event.fields?.reason,
        });
      },
      exception() {},
    },
    runner: () => undefined,
  });

  await flushMediaTask();
  assert.equal(task.snapshot().state, "uploading");
  await task.pause();
  assert.equal(task.snapshot().state, "uploading");
  await task.resume();
  assert.equal(task.snapshot().state, "uploading");
  assert.deepEqual(events, [
    { name: "media_upload_pause_requested", state: "uploading", reason: "unsupported" },
    { name: "media_upload_resume_requested", state: "uploading", reason: "unsupported" },
  ]);
});

test("waitForMediaUploadTaskTerminal re-checks after subscribing", async () => {
  const task = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: uuid },
    },
    platform: "web",
    autoStart: false,
    runner: () => undefined,
  });

  const originalOn = task.on.bind(task);
  let subscribed = false;
  const taskWithSynchronousTerminalTransition = {
    ...task,
    on: ((event, listener) => {
      const unsubscribe = originalOn(event, listener);
      subscribed = true;
      task.applyServerSnapshot({ state: "ready", result: { providerObjectId: "ready-between-checks" } });
      return unsubscribe;
    }) satisfies typeof task.on,
  };

  const terminal = await waitForMediaUploadTaskTerminal(taskWithSynchronousTerminalTransition);

  assert.equal(subscribed, true);
  assert.equal(terminal.state, "ready");
  assert.equal(terminal.result?.providerObjectId, "ready-between-checks");
});

test("media upload state machine retries failed and cancelled attempts intentionally", () => {
  let failed = createInitialMediaUploadSnapshot({
    id: "task-2",
    clientRequestId: uuid,
    family: "chat_photo",
    platform: "web",
    nowMs: 1,
  });
  failed = transitionMediaUploadState(failed, { type: "begin_upload", atMs: 2 });
  failed = transitionMediaUploadState(failed, {
    type: "fail",
    error: { code: "network", retryable: true },
    atMs: 3,
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.attempt, 0);

  const retried = transitionMediaUploadState(failed, { type: "retry", atMs: 4 });
  assert.equal(retried.state, "created");
  assert.equal(retried.attempt, 1);
  assert.equal(retried.error, null);

  let cancelled = createInitialMediaUploadSnapshot({
    id: "task-3",
    clientRequestId: uuid,
    family: "voice_note",
    platform: "native",
    nowMs: 1,
  });
  cancelled = transitionMediaUploadState(cancelled, { type: "cancel", reason: "user_cancelled", atMs: 2 });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(transitionMediaUploadState(cancelled, { type: "retry", atMs: 3 }).state, "created");
});

test("media task id fallback uses crypto getRandomValues when randomUUID is unavailable", () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    },
  });

  try {
    const task = createMediaUploadTask({
      input: {
        family: "chat_photo",
        source: new Blob(["photo"], { type: "image/jpeg" }),
      },
      platform: "web",
      runner: () => {},
      nowMs: 1,
    });

    assert.equal(task.id, "00010203-0405-4607-8809-0a0b0c0d0e0f");
    assert.equal(task.snapshot().clientRequestId, task.id);
  } finally {
    if (originalCrypto) {
      Object.defineProperty(globalThis, "crypto", originalCrypto);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  }
});

test("web adapter delegates Vibe Video upload through the harness and cleans terminal queue rows", async () => {
  const queue = new MemoryMediaUploadQueue();
  const seenStates: string[] = [];
  const sdk = createWebMediaSdk({
    queue,
    delegates: {
      video: {
        uploadVibeVideo: async (_input, controls) => {
          controls.dispatch({ type: "progress", progress: 0.5 });
          controls.dispatch({ type: "upload_complete" });
          controls.dispatch({ type: "ready", result: { providerObjectId: "web-video" } });
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["video"], { type: "video/mp4" }),
    context: { uploadContext: "profile_studio", scopeKey: "profile:self" },
    options: { clientRequestId: uuid },
  });
  task.on("state", (snapshot) => seenStates.push(snapshot.state));

  await flushMediaTask();

  assert.equal(task.snapshot().state, "ready");
  assert.deepEqual(seenStates, ["uploading", "processing", "ready"]);
  assert.equal((await queue.list()).length, 0);
});

test("web adapter routes Chat Vibe Clips through the video SDK delegate without internal flag telemetry", async () => {
  const events: string[] = [];
  let delegateClientRequestId: string | null = null;
  const sdk = createWebMediaSdk({
    queue: new MemoryMediaUploadQueue(),
    telemetrySinks: [
      {
        capture(event) {
          events.push(event.name);
        },
      },
    ],
    delegates: {
      video: {
        uploadChatVibeClip: (_input, controls) => {
          delegateClientRequestId = controls.snapshot().clientRequestId;
          controls.dispatch({ type: "progress", progress: 0.75 });
          controls.dispatch({ type: "ready", result: { providerObjectId: "chat-clip-video" } });
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "chat_vibe_clip",
    source: new Blob(["clip"], { type: "video/mp4" }),
    context: { uploadContext: "chat", scopeKey: "match:1" },
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(delegateClientRequestId, uuid);
  assert.equal(task.snapshot().state, "ready");
  assert.equal(task.snapshot().result?.providerObjectId, "chat-clip-video");
  assert.deepEqual(events, []);
});

test("web photo adapter prepares photo sources before invoking legacy delegates", async () => {
  const original = new Blob(["raw-png"], { type: "image/png" });
  const prepared = new Blob(["prepared-jpeg"], { type: "image/jpeg" });
  let transcoderCalls = 0;
  let delegateSource: Blob | null = null;

  const sdk = createWebMediaSdk({
    queue: new MemoryMediaUploadQueue(),
    photoTranscoder: async (source, input) => {
      transcoderCalls += 1;
      assert.equal(source, original);
      assert.equal(input.family, "chat_photo");
      return prepared;
    },
    delegates: {
      photo: {
        uploadChatPhoto: (input, controls) => {
          delegateSource = input.source;
          controls.dispatch({ type: "ready", result: { providerPath: "photos/ready.jpg" } });
        },
      },
    },
  });

  const task = sdk.photo.upload({
    family: "chat_photo",
    source: original,
    context: { uploadContext: "chat", scopeKey: "match:1" },
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(transcoderCalls, 1);
  assert.equal(delegateSource, prepared);
  assert.equal(task.snapshot().state, "ready");
});

test("web photo transcode hook reports capabilities and keeps unsupported runtimes safe", async () => {
  assert.equal(webMediaTranscode.capabilities().phase, "phase_5_photo_transcode");

  const nonImage = new Blob(["not-image"], { type: "text/plain" });
  assert.equal(await webMediaTranscode.preparePhotoForUpload(nonImage), nonImage);
});

test("web voice recording config targets mono 96 kbps MediaRecorder capture", () => {
  const config = webMediaTranscode.voiceRecordingConfig();
  assert.equal(config.audioBitsPerSecond, 96_000);
  assert.equal(config.numberOfChannels, 1);
  assert.equal(config.options.audioBitsPerSecond, 96_000);
  assert.deepEqual(config.constraints.audio, {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
});

test("web adapter delegates unconditionally after the platform facade admits an upload", async () => {
  let delegateCalls = 0;
  const sdk = createWebMediaSdk({
    queue: new MemoryMediaUploadQueue(),
    delegates: {
      video: {
        uploadVibeVideo: (_input, controls) => {
          delegateCalls += 1;
          controls.dispatch({ type: "ready", result: { providerObjectId: "ungated-web-video" } });
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["video"], { type: "video/mp4" }),
    context: { uploadContext: "profile_studio", scopeKey: "profile:self" },
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(delegateCalls, 1);
  assert.equal(task.snapshot().state, "ready");
  assert.equal(task.snapshot().result?.providerObjectId, "ungated-web-video");
});

test("web adapter persists the recovery row before a fast delegate can finish", async () => {
  const gate = deferred();
  const queuedRecords: MediaUploadQueueRecord[] = [];
  class SlowPutQueue extends MemoryMediaUploadQueue {
    async put(record: MediaUploadQueueRecord): Promise<void> {
      queuedRecords.push(record);
      await gate.promise;
      await super.put(record);
    }
  }

  const queue = new SlowPutQueue();
  let delegateCalls = 0;
  const sdk = createWebMediaSdk({
    queue,
    delegates: {
      video: {
        uploadVibeVideo: async (_input, controls) => {
          delegateCalls += 1;
          controls.dispatch({ type: "ready", result: { providerObjectId: "fast-video" } });
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["video"], { type: "video/mp4" }),
    context: { uploadContext: "profile_studio", scopeKey: "profile:self" },
    options: { clientRequestId: uuid, sourceSha256: "sha256-local-binding" },
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(delegateCalls, 0, "upload delegate must wait until the local queue binding is durable");
  assert.equal(queuedRecords[0]?.clientRequestId, uuid);
  assert.equal(queuedRecords[0]?.sourceSha256, "sha256-local-binding");

  gate.resolve();
  await flushMediaTask();

  assert.equal(delegateCalls, 1);
  assert.equal(task.snapshot().state, "ready");
  assert.equal((await queue.list()).length, 0, "terminal ready upload should not leave stale recovery rows");
});

test("web adapter reconciles cancellation during startup queue binding", async () => {
  const gate = deferred();
  class SlowPutQueue extends MemoryMediaUploadQueue {
    async put(record: MediaUploadQueueRecord): Promise<void> {
      await gate.promise;
      await super.put(record);
    }
  }

  const queue = new SlowPutQueue();
  let delegateCalls = 0;
  const sdk = createWebMediaSdk({
    queue,
    delegates: {
      video: {
        uploadVibeVideo: () => {
          delegateCalls += 1;
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["video"], { type: "video/mp4" }),
    options: { clientRequestId: uuid },
  });

  await Promise.resolve();
  await task.cancel("user_cancelled");
  gate.resolve();
  await flushMediaTask();

  assert.equal(delegateCalls, 0);
  assert.equal(task.snapshot().state, "cancelled");
  assert.equal((await queue.list()).length, 0);
});

test("web adapter does not create recovery rows when cancelled before startup begins", async () => {
  const queue = new MemoryMediaUploadQueue();
  let delegateCalls = 0;
  const sdk = createWebMediaSdk({
    queue,
    delegates: {
      video: {
        uploadVibeVideo: () => {
          delegateCalls += 1;
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["video"], { type: "video/mp4" }),
    options: { clientRequestId: uuid, sourceSha256: "sha256-pre-start-cancel" },
  });
  await task.cancel("user_cancelled");
  await flushMediaTask();

  assert.equal(delegateCalls, 0);
  assert.equal(task.snapshot().state, "cancelled");
  assert.equal((await queue.list()).length, 0);
});

test("native adapter delegates URI uploads without Base64 materialization", async () => {
  const storage = new Map<string, string>();
  const queue = new MemoryMediaUploadQueue();
  const source = { uri: "file:///tmp/video.mov", name: "video.mov", mimeType: "video/quicktime", sizeBytes: 1024 };
  let fileInfoUri: string | null = null;
  let delegateSource: typeof source | null = null;
  const sdk = createNativeMediaSdk({
    queue,
    asyncStorage: {
      async getItem(key) {
        return storage.get(key) ?? null;
      },
      async setItem(key, value) {
        storage.set(key, value);
      },
      async removeItem(key) {
        storage.delete(key);
      },
    },
    fileSystem: {
      async getInfoAsync(uri) {
        fileInfoUri = uri;
        return { exists: true, size: 1024 };
      },
    },
    delegates: {
      video: {
        uploadVibeVideo: async (input, controls) => {
          delegateSource = input.source as typeof source;
          controls.dispatch({ type: "upload_complete" });
          controls.dispatch({ type: "ready", result: { providerObjectId: "native-video" } });
        },
      },
    },
    platform: "ios",
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source,
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(task.snapshot().state, "ready");
  assert.equal(fileInfoUri, source.uri);
  assert.equal(delegateSource, source);
  assert.equal((await queue.list()).length, 0);
  assert.throws(() => assertNativeUriSource({ uri: "data:video/mp4;base64,AAAA" }), /data_uri_forbidden/);
});

test("native photo adapter prepares photo URIs before invoking legacy delegates", async () => {
  const queue = new MemoryMediaUploadQueue();
  const original = { uri: "file:///tmp/photo.heic", name: "photo.heic", mimeType: "image/heic", width: 4032, height: 3024 };
  const prepared = { uri: "file:///tmp/photo.jpg", name: "photo.jpg", mimeType: "image/jpeg", width: 2048, height: 1536 };
  let transcoderCalls = 0;
  let delegateSource: typeof prepared | null = null;

  const sdk = createNativeMediaSdk({
    queue,
    fileSystem: {
      async getInfoAsync() {
        return { exists: true, size: 5_000_000 };
      },
    },
    photoTranscoder: async (source, input) => {
      transcoderCalls += 1;
      assert.equal(source, original);
      assert.equal(input.family, "profile_photo");
      return prepared;
    },
    delegates: {
      photo: {
        uploadProfilePhoto: (input, controls) => {
          delegateSource = input.source as typeof prepared;
          controls.dispatch({ type: "ready", result: { providerPath: "photos/native-ready.jpg" } });
        },
      },
    },
    platform: "ios",
  });

  const task = sdk.photo.upload({
    family: "profile_photo",
    source: original,
    context: { uploadContext: "profile_studio", scopeKey: "profile:self" },
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(transcoderCalls, 1);
  assert.equal(delegateSource, prepared);
  assert.equal(task.snapshot().state, "ready");
});

test("native photo transcode hook uses expo-image-manipulator shape for resize and EXIF stripping", async () => {
  const actionsSeen: unknown[][] = [];
  const optionsSeen: Array<Record<string, unknown> | undefined> = [];
  const source = {
    uri: "file:///tmp/portrait.heic",
    name: "portrait.heic",
    mimeType: "image/heic",
    sizeBytes: 7_000_000,
    width: 3024,
    height: 4032,
  };
  const prepared = await nativeMediaTranscodeHooks.preparePhotoForUpload(source, {
    async manipulateAsync(uri, actions, options) {
      assert.equal(uri, source.uri);
      actionsSeen.push([...actions]);
      optionsSeen.push(options);
      return {
        uri: "file:///tmp/portrait.jpg",
        sizeBytes: 950_000,
        width: 1536,
        height: 2048,
      };
    },
  });

  assert.deepEqual(actionsSeen, [[{ resize: { height: 2048 } }]]);
  assert.deepEqual(optionsSeen, [{ compress: 0.85, format: "jpeg" }]);
  assert.equal(prepared.uri, "file:///tmp/portrait.jpg");
  assert.equal(prepared.name, "portrait.jpg");
  assert.equal(prepared.mimeType, "image/jpeg");
  assert.equal(prepared.sizeBytes, 950_000);
  assert.equal(prepared.width, 1536);
  assert.equal(prepared.height, 2048);
});

test("native photo transcode hook probes dimensions before one lossy resize pass", async () => {
  const calls: Array<{ uri: string; actions: unknown[]; options: Record<string, unknown> | undefined }> = [];
  const source = {
    uri: "file:///tmp/cached-chat-photo.jpg",
    name: "cached-chat-photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 8_500_000,
  };
  const prepared = await nativeMediaTranscodeHooks.preparePhotoForUpload(
    source,
    {
      async manipulateAsync(uri, actions, options) {
        calls.push({ uri, actions: [...actions], options });
        if (calls.length === 1) {
          return {
            uri: "file:///tmp/cached-chat-photo-pass1.jpg",
            sizeBytes: 4_500_000,
            width: 4032,
            height: 3024,
          };
        }
        return {
          uri: "file:///tmp/cached-chat-photo-ready.jpg",
          sizeBytes: 920_000,
          width: 2048,
          height: 1536,
        };
      },
    },
  );

  assert.deepEqual(calls, [
    { uri: source.uri, actions: [], options: { compress: 1, format: "png" } },
    { uri: source.uri, actions: [{ resize: { width: 2048 } }], options: { compress: 0.85, format: "jpeg" } },
  ]);
  assert.equal(prepared.uri, "file:///tmp/cached-chat-photo-ready.jpg");
  assert.equal(prepared.name, "cached-chat-photo.jpg");
  assert.equal(prepared.mimeType, "image/jpeg");
  assert.equal(prepared.width, 2048);
  assert.equal(prepared.height, 1536);
});

test("native voice recording config uses expo-audio AAC mono at capture time", () => {
  const options = nativeMediaTranscodeHooks.voiceRecordingOptions() as {
    extension: string;
    sampleRate: number;
    numberOfChannels: number;
    bitRate: number;
    android: { outputFormat: string; audioEncoder: string };
    ios: { outputFormat: string; audioQuality: number };
    web: { bitsPerSecond: number };
  };
  assert.equal(options.extension, ".m4a");
  assert.equal(options.sampleRate, 44100);
  assert.equal(options.numberOfChannels, 1);
  assert.equal(options.bitRate, 96_000);
  assert.equal(options.android.outputFormat, "mpeg4");
  assert.equal(options.android.audioEncoder, "aac");
  assert.equal(options.ios.outputFormat, "aac ");
  assert.equal(options.ios.audioQuality, 0x60);
  assert.equal(options.web.bitsPerSecond, 96_000);
  assert.equal(nativeMediaTranscodeHooks.voiceRecordingCapabilities().phase, "phase_5_voice_record_native");
});

test("native adapter delegates unconditionally after the platform facade admits an upload", async () => {
  let delegateCalls = 0;
  const sdk = createNativeMediaSdk({
    queue: new MemoryMediaUploadQueue(),
    fileSystem: {
      async getInfoAsync() {
        return { exists: true, size: 1024 };
      },
    },
    delegates: {
      video: {
        uploadVibeVideo: (_input, controls) => {
          delegateCalls += 1;
          controls.dispatch({ type: "ready", result: { providerObjectId: "ungated-native-video" } });
        },
      },
    },
    platform: "android",
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: { uri: "file:///tmp/video.mp4", mimeType: "video/mp4", sizeBytes: 1024 },
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(delegateCalls, 1);
  assert.equal(task.snapshot().state, "ready");
  assert.equal(task.snapshot().result?.providerObjectId, "ungated-native-video");
});

test("native AsyncStorage queue falls back to memory without leaking removed rows", async () => {
  const queue = new NativeAsyncStorageMediaUploadQueue(null);
  const snapshot = createInitialMediaUploadSnapshot({
    id: "task-native-fallback",
    clientRequestId: uuid,
    family: "vibe_video",
    platform: "native",
    nowMs: 1,
  });

  await queue.put({
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: snapshot.family,
    state: snapshot.state,
    sourceRef: "video.mov:video/quicktime:1024",
    sourceSha256: "sha256-native",
    scopeKey: "profile:self",
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
  });
  assert.equal((await queue.list({ family: "vibe_video", states: ["created"] })).length, 1);

  await queue.remove(snapshot.id);
  assert.equal((await queue.list()).length, 0);
});

test("native AsyncStorage queue stores per-record rows and supports client-request lookup", async () => {
  const storage = new Map<string, string>();
  const queue = new NativeAsyncStorageMediaUploadQueue({
    async getItem(key) {
      return storage.get(key) ?? null;
    },
    async setItem(key, value) {
      storage.set(key, value);
    },
    async removeItem(key) {
      storage.delete(key);
    },
  });
  const snapshot = createInitialMediaUploadSnapshot({
    id: "native-recorded",
    clientRequestId: uuid,
    family: "vibe_video",
    platform: "ios",
    nowMs: 1,
  });

  await queue.put({
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: snapshot.family,
    state: snapshot.state,
    sourceRef: "file:///tmp/video.mp4",
    sourceSha256: "sha256-native",
    scopeKey: "profile:self",
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
  });

  assert.equal(storage.has("vibely.upload-queue"), false);
  assert.ok(storage.has("vibely.upload-queue:index"));
  assert.ok(storage.has("vibely.upload-queue:record:native-recorded"));
  assert.equal((await queue.findByClientRequestId(uuid, "profile:self"))?.id, "native-recorded");
});

test("indexedDB queue falls back to memory when the browser store is unavailable", async () => {
  const queue = new IndexedDbMediaUploadQueue();
  const snapshot = createInitialMediaUploadSnapshot({
    id: "task-web-fallback",
    clientRequestId: uuid,
    family: "chat_photo",
    platform: "web",
    nowMs: 1,
  });

  await queue.put({
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: snapshot.family,
    state: snapshot.state,
    sourceRef: "photo:image/jpeg:5",
    sourceSha256: "sha256-web",
    scopeKey: "match:1",
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
  });
  assert.equal((await queue.list({ scopeKey: "match:1" })).length, 1);

  await queue.remove(snapshot.id);
  assert.equal((await queue.list()).length, 0);
});

test("queue reconciliation removes server-terminal and stale failed rows without touching active rows", async () => {
  const queue = new MemoryMediaUploadQueue();
  const active = createInitialMediaUploadSnapshot({
    id: "active",
    clientRequestId: "11111111-1111-4111-8111-111111111112",
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  });
  const terminal = createInitialMediaUploadSnapshot({
    id: "terminal",
    clientRequestId: "11111111-1111-4111-8111-111111111113",
    family: "chat_vibe_clip",
    platform: "web",
    nowMs: 1,
  });
  const failed = transitionMediaUploadState(createInitialMediaUploadSnapshot({
    id: "failed-old",
    clientRequestId: "11111111-1111-4111-8111-111111111114",
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  }), { type: "fail", error: { code: "network" }, atMs: 2 });

  for (const snapshot of [active, terminal, failed]) {
    await queue.put({
      id: snapshot.id,
      clientRequestId: snapshot.clientRequestId,
      family: snapshot.family,
      state: snapshot.state,
      sourceRef: "source",
      scopeKey: "profile:self",
      createdAtMs: snapshot.createdAtMs,
      updatedAtMs: snapshot.updatedAtMs,
      snapshot,
    });
  }

  const result = await reconcileMediaUploadQueue({
    queue,
    nowMs: 20 * 60 * 1000,
    staleSweepGracePeriodMs: 10 * 60 * 1000,
    reconciler: {
      async fetch(record) {
        if (record.id === "terminal") return { state: "ready", result: { providerObjectId: "ready-video" } };
        if (record.id === "failed-old") return null;
        return { state: "processing", expiresAtMs: 20 * 60 * 1000 + 60_000 };
      },
    },
  });

  assert.equal(result.checked, 3);
  assert.equal(result.removed, 2);
  const retained = await queue.list();
  assert.deepEqual(retained.map((record) => record.id), ["active"]);
  assert.equal(retained[0]?.state, "processing");
  assert.equal(retained[0]?.snapshot.progress, 1);
});

test("queue reconciliation trusts server-active state before pruning stale local failures", async () => {
  const queue = new MemoryMediaUploadQueue();
  const failed = transitionMediaUploadState(createInitialMediaUploadSnapshot({
    id: "locally-failed-server-active",
    clientRequestId: "11111111-1111-4111-8111-111111111115",
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  }), { type: "fail", error: { code: "offline_timeout" }, atMs: 2 });
  await queue.put({
    id: failed.id,
    clientRequestId: failed.clientRequestId,
    family: failed.family,
    state: failed.state,
    sourceRef: "source",
    scopeKey: "profile:self",
    createdAtMs: failed.createdAtMs,
    updatedAtMs: failed.updatedAtMs,
    snapshot: failed,
  });

  const result = await reconcileMediaUploadQueue({
    queue,
    nowMs: 20 * 60 * 1000,
    staleSweepGracePeriodMs: 10 * 60 * 1000,
    reconciler: {
      async fetch() {
        return { state: "processing", updatedAtMs: 20 * 60 * 1000 };
      },
    },
  });

  const retained = await queue.list();
  assert.equal(result.removed, 0);
  assert.equal(result.retained, 1);
  assert.equal(retained[0]?.state, "processing");
  assert.equal(retained[0]?.snapshot.error, null);
});

test("queue reconciliation syncs active nudged server state before resume decisions", async () => {
  const queue = new MemoryMediaUploadQueue();
  const uploading = transitionMediaUploadState(createInitialMediaUploadSnapshot({
    id: "expired-uploading",
    clientRequestId: "11111111-1111-4111-8111-111111111116",
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  }), { type: "begin_upload", atMs: 2 });
  await queue.put({
    id: uploading.id,
    clientRequestId: uploading.clientRequestId,
    family: uploading.family,
    state: uploading.state,
    sourceRef: "source",
    scopeKey: "profile:self",
    createdAtMs: uploading.createdAtMs,
    updatedAtMs: uploading.updatedAtMs,
    snapshot: uploading,
  });

  const result = await reconcileMediaUploadQueue({
    queue,
    nowMs: 20 * 60 * 1000,
    reconciler: {
      async fetch() {
        return { state: "uploading", expiresAtMs: 1, updatedAtMs: 2 };
      },
      async nudge() {
        return { state: "processing", updatedAtMs: 20 * 60 * 1000 };
      },
    },
  });

  const retained = await queue.list();
  assert.equal(result.nudged, 1);
  assert.equal(result.retained, 1);
  assert.equal(retained[0]?.state, "processing");
  assert.equal(retained[0]?.snapshot.progress, 1);
});

test("SDK reconcile rehydrates recoverable queue records and resumes them once", async () => {
  const queue = new MemoryMediaUploadQueue();
  const snapshot = transitionMediaUploadState(createInitialMediaUploadSnapshot({
    id: "recoverable-upload",
    clientRequestId: uuid,
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  }), { type: "begin_upload", atMs: 2 });
  await queue.put({
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: snapshot.family,
    state: snapshot.state,
    sourceRef: "recoverable.mp4:video/mp4:5",
    sourceSha256: "recoverable-sha",
    scopeKey: "profile:self",
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
    metadata: {
      source_blob: new Blob(["video"], { type: "video/mp4" }),
      mime_type: "video/mp4",
    },
  });

  let delegateCalls = 0;
  const sdk = createWebMediaSdk({
    queue,
    delegates: {
      video: {
        uploadVibeVideo: (_input, controls) => {
          delegateCalls += 1;
          controls.dispatch({ type: "ready", result: { providerObjectId: "resumed-video" } });
        },
      },
    },
  });

  const result = await sdk.reconcile({ reason: "test_resume" });
  await flushMediaTask();
  await flushMediaTask();

  assert.equal(result.checked, 1);
  assert.equal(delegateCalls, 1);
  assert.equal((await queue.list()).length, 0);

  await sdk.reconcile({ reason: "test_resume" });
  await flushMediaTask();
  assert.equal(delegateCalls, 1);
});

test("rehydrated tasks keep persisted ids and accept authoritative server-ready transitions", () => {
  const queue = new MemoryMediaUploadQueue();
  const sdk = createWebMediaSdk({ queue });
  const snapshot = transitionMediaUploadState(createInitialMediaUploadSnapshot({
    id: "persisted-task",
    clientRequestId: uuid,
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  }), { type: "fail", error: { code: "local_timeout" }, atMs: 2 });
  const task = sdk.video.rehydrate({
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: snapshot.family,
    state: snapshot.state,
    sourceRef: "video.mp4:video/mp4:5",
    scopeKey: "profile:self",
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
  });

  assert.equal(task.id, "persisted-task");
  assert.equal(task.snapshot().state, "failed");
  task.applyServerSnapshot({ state: "ready", result: { providerObjectId: "server-ready" } });
  assert.equal(task.snapshot().state, "ready");
  assert.equal(task.snapshot().result?.providerObjectId, "server-ready");
});

test("telemetry redaction strips non-allowlisted and sensitive fields at the SDK boundary", () => {
  assert.deepEqual(safeTelemetryFields({
    client_request_id: uuid,
    path: "v2",
    path_selected: "media_sdk",
    match_token: "secret",
    signed_url: "https://example.test/private",
    Authorization: "Bearer secret",
  }), {
    client_request_id: uuid,
    path: "v2",
    path_selected: "media_sdk",
  });
});

test("upload facade telemetry fields stay consistent across platform wrappers", () => {
  assert.deepEqual(MEDIA_UPLOAD_PATH_EVENT_NAMES, [
    "media_upload_started",
    "media_upload_path_taken",
    "media_upload_sdk_flag_evaluated",
  ]);
  assert.equal(mediaUploadRuntimePath("media_sdk"), "v2");
  assert.equal(mediaUploadRuntimePath("legacy"), "legacy");
  assert.deepEqual(createMediaUploadPathTelemetryFields({
    flag: "media_v2_video",
    evaluation: {
      enabled: true,
      source: "rollout",
      bucket: 1234,
      rolloutBps: 5000,
      userIdBucket: "bucket-7",
    },
    path: "media_sdk",
    family: "vibe_video",
    platform: "ios",
    clientRequestId: uuid,
  }), {
    active_flag: "media_v2_video",
    active_flag_enabled: true,
    active_flag_source: "rollout",
    active_flag_bucket: 1234,
    active_flag_rollout_bps: 5000,
    user_id_bucket: "bucket-7",
    path: "v2",
    path_selected: "media_sdk",
    family: "vibe_video",
    platform: "ios",
    client_request_id: uuid,
  });
});

test("local queue binding rejects same client request id with a different source hash in one scope", async () => {
  const queue = new MemoryMediaUploadQueue();
  const existing = createInitialMediaUploadSnapshot({
    id: "existing-binding",
    clientRequestId: uuid,
    family: "vibe_video",
    platform: "web",
    nowMs: 1,
  });
  await queue.put({
    id: existing.id,
    clientRequestId: existing.clientRequestId,
    family: existing.family,
    state: existing.state,
    sourceRef: "old-video:video/mp4:5",
    sourceSha256: "sha256-old",
    scopeKey: "profile:self",
    createdAtMs: existing.createdAtMs,
    updatedAtMs: existing.updatedAtMs,
    snapshot: existing,
  });

  let delegateCalls = 0;
  const sdk = createWebMediaSdk({
    queue,
    delegates: {
      video: {
        uploadVibeVideo: () => {
          delegateCalls += 1;
        },
      },
    },
  });

  const conflict = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["new"], { type: "video/mp4" }),
    context: { scopeKey: "profile:self" },
    options: { clientRequestId: uuid, sourceSha256: "sha256-new" },
  });
  await flushMediaTask();

  assert.equal(delegateCalls, 0);
  assert.equal(conflict.snapshot().state, "failed");
  assert.equal(conflict.snapshot().error?.code, "media_client_request_source_conflict");

  const otherScope = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["new"], { type: "video/mp4" }),
    context: { scopeKey: "profile:other" },
    options: { clientRequestId: uuid, sourceSha256: "sha256-new" },
  });
  await flushMediaTask();

  assert.equal(delegateCalls, 1);
  assert.equal(otherScope.snapshot().state, "processing");
});

test("cancelling before the scheduled start prevents delegate side effects and removes abort listeners", async () => {
  let delegateCalls = 0;
  const controller = new AbortController();
  const task = createMediaUploadTask({
    input: {
      family: "chat_photo",
      source: new Blob(["photo"], { type: "image/jpeg" }),
      options: { clientRequestId: uuid, signal: controller.signal },
    },
    platform: "web",
    runner: () => {
      delegateCalls += 1;
    },
  });

  await task.cancel("user_cancelled");
  await flushMediaTask();

  assert.equal(task.snapshot().state, "cancelled");
  assert.equal(delegateCalls, 0);
  controller.abort();
  assert.equal(task.snapshot().state, "cancelled");
});

test("upload_complete emits final progress and retry requested inside failure listeners reruns", async () => {
  const states: string[] = [];
  const progress: number[] = [];
  let runs = 0;
  const task = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: uuid },
    },
    platform: "web",
    runner: (controls) => {
      runs += 1;
      if (runs === 1) {
        controls.dispatch({ type: "fail", error: { code: "temporary", retryable: true } });
        return;
      }
      controls.dispatch({ type: "upload_complete" });
      controls.dispatch({ type: "ready", result: { providerObjectId: "retried-video" } });
    },
  });
  task.on("state", (snapshot) => states.push(snapshot.state));
  task.on("progress", (snapshot) => progress.push(snapshot.progress));
  task.on("error", () => {
    void task.retry();
  });

  await flushMediaTask();
  await flushMediaTask();

  assert.equal(runs, 2);
  assert.equal(task.snapshot().state, "ready");
  assert.deepEqual(progress, [1]);
  assert.deepEqual(states, ["uploading", "failed", "created", "uploading", "processing", "ready"]);
});

test("retry re-arms an active abort signal and honours already-aborted signals", async () => {
  const controller = new AbortController();
  let runs = 0;
  const task = createMediaUploadTask({
    input: {
      family: "vibe_video",
      source: new Blob(["video"], { type: "video/mp4" }),
      options: { clientRequestId: uuid, signal: controller.signal },
    },
    platform: "web",
    runner: (controls) => {
      runs += 1;
      if (runs > 1) return;
      controls.dispatch({
        type: "fail",
        error: { code: `failed_${runs}`, retryable: true },
      });
    },
  });

  await flushMediaTask();
  assert.equal(task.snapshot().state, "failed");

  await task.retry();
  controller.abort();
  await flushMediaTask();

  assert.equal(runs, 2);
  assert.equal(task.snapshot().state, "cancelled");

  await task.retry();
  assert.equal(task.snapshot().state, "cancelled");
  assert.equal(runs, 2);
});

test("observer listener failures are isolated from upload execution", async () => {
  const capturedExceptions: unknown[] = [];
  const telemetrySink: MediaTelemetrySink = {
    capture() {},
    captureException(error) {
      capturedExceptions.push(error);
    },
  };
  const sdk = createWebMediaSdk({
    queue: new MemoryMediaUploadQueue(),
    telemetrySinks: [telemetrySink],
    delegates: {
      video: {
        uploadVibeVideo: (_input, controls) => {
          controls.dispatch({ type: "upload_complete" });
          controls.dispatch({ type: "ready", result: { providerObjectId: "listener-safe" } });
        },
      },
    },
  });

  const task = sdk.video.upload({
    family: "vibe_video",
    source: new Blob(["video"], { type: "video/mp4" }),
    options: { clientRequestId: uuid },
  });
  task.on("state", () => {
    throw new Error("ui_listener_failed");
  });

  await flushMediaTask();

  assert.equal(task.snapshot().state, "ready");
  assert.equal(capturedExceptions.length, 3);
  assert.match(String(capturedExceptions[0]), /ui_listener_failed/);
});

test("abort signals and throwing lifecycle cancels still settle deterministically", async () => {
  const controller = new AbortController();
  let delegateCalls = 0;
  const task = createMediaUploadTask({
    input: {
      family: "voice_note",
      source: new Blob(["voice"], { type: "audio/mp4" }),
      options: { clientRequestId: uuid, signal: controller.signal },
    },
    platform: "web",
    runner: (controls) => {
      delegateCalls += 1;
      controls.bindLifecycle({
        cancel: () => {
          throw new Error("native_cancel_failed");
        },
      });
    },
  });

  await flushMediaTask();
  await assert.rejects(() => task.cancel("user_cancelled"), /native_cancel_failed/);
  assert.equal(task.snapshot().state, "cancelled");

  controller.abort();
  assert.equal(task.snapshot().state, "cancelled");
  assert.equal(delegateCalls, 1);
});

test("missing platform delegate fails closed instead of starting a second upload path", async () => {
  const sdk = createWebMediaSdk({
    queue: new MemoryMediaUploadQueue(),
  });
  const task = sdk.photo.upload({
    family: "chat_photo",
    source: new Blob(["photo"], { type: "image/jpeg" }),
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(task.snapshot().state, "failed");
  assert.equal(task.snapshot().error?.code, "media_delegate_missing");
});

test("platform adapters fail closed on invalid sources and root SDK exports both adapters", async () => {
  assert.equal(typeof createWebMediaSdkFromRoot, "function");
  assert.equal(typeof createNativeMediaSdkFromRoot, "function");
  assert.throws(() => assertWebMediaSource({} as Blob), /blob_required/);
  assert.throws(() => assertNativeUriSource({} as { uri: string }), /uri_required/);

  const webTask = createWebMediaSdk({
    queue: new MemoryMediaUploadQueue(),
    delegates: {
      video: {
        uploadVibeVideo: () => {
          throw new Error("delegate_should_not_run");
        },
      },
    },
  }).video.upload({
    family: "vibe_video",
    source: {} as Blob,
    options: { clientRequestId: uuid },
  });

  await flushMediaTask();

  assert.equal(webTask.snapshot().state, "failed");
  assert.equal(webTask.snapshot().error?.code, "Error");
  assert.match(webTask.snapshot().error?.message ?? "", /web_media_blob_required/);
});

test("production media SDK factories wire telemetry sinks and reconciliation", () => {
  const files = [
    "src/lib/mediaSdk/webVideoUploads.ts",
    "src/lib/mediaSdk/webStorageUploads.ts",
    "apps/mobile/lib/mediaSdk/nativeVideoUploads.ts",
    "apps/mobile/lib/mediaSdk/nativeStorageUploads.ts",
  ];
  for (const path of files) {
    const source = readRepoFile(path);
    assert.match(source, /telemetrySinks:\s*(webMediaTelemetrySinks|nativeMediaTelemetrySinks)/, path);
    assert.match(source, /reconciler:\s*create(Web|Native)MediaUploadReconciler\(\)/, path);
    assert.match(source, /MEDIA_UPLOAD_PATH_EVENT_NAMES/, path);
    assert.match(source, /createMediaUploadPathTelemetryFields/, path);
    assert.match(source, /catch\s*\{[\s\S]{0,120}failClosed/, `${path} must fail closed to legacy on flag evaluation errors`);
  }
});

test("phase 3 schema and delete contracts preserve recovery observability", () => {
  const migration = readRepoFile("supabase/migrations/20260520143000_media_sdk_phase3_hardening.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS duration_ms/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS aspect_ratio/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS source_bytes/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS mime_type/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS attempt_count/);
  assert.match(migration, /idx_vibe_video_uploads_retry_attempts/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.chat_vibe_clip_uploads TO authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.chat_vibe_clip_uploads TO service_role/);
  assert.match(migration, /increment_vibe_video_upload_attempt_count/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.increment_vibe_video_upload_attempt_count\(uuid\)\s+TO service_role/);
  assert.match(migration, /user_id.*sender_id/s);
  assert.match(migration, /EXPECTED_TUS_CREDENTIAL_TTL_MS/);

  const deleteVibeVideo = readRepoFile("supabase/functions/delete-vibe-video/index.ts");
  assert.match(deleteVibeVideo, /\.in\("status",\s*\[[^\]]*"failed"[^\]]*\]\)/s);
});
