import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (rel.includes("/node_modules/")) continue;
    const stat = statSync(join(root, rel));
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(rel));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const voiceMessagePlayer = read("apps/mobile/components/chat/VoiceMessagePlayer.tsx");
const vibeVideoPlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
const vibeClipCard = read("apps/mobile/components/chat/VibeClipCard.tsx");
const mediaViewer = read("apps/mobile/components/chat/ChatThreadMediaViewer.tsx");
const safeHelpers = read("apps/mobile/lib/expoSharedObjectSafe.ts");

test("shared object helper catches Expo released native object failures", () => {
  assert.match(safeHelpers, /NativeSharedObjectNotFoundException/);
  assert.match(safeHelpers, /FunctionCallException/);
  assert.match(safeHelpers, /export function safeExpoSharedObjectRead/);
  assert.match(safeHelpers, /export function safeRemoveExpoSharedObjectSubscription/);
  assert.match(safeHelpers, /export function attachSafeExpoSharedObjectPromise/);
  assert.match(safeHelpers, /FunctionCallException[\s\S]*native shared object\|DynamicSharedObject\|NativeSharedObject/);
  assert.doesNotMatch(safeHelpers, /safeVideoPlayerCall/);
});

test("shared object helper only swallows released-object failures by default", async () => {
  const {
    attachSafeExpoSharedObjectPromise,
    isExpoSharedObjectReleasedError,
    safeExpoSharedObjectCall,
    safeExpoSharedObjectRead,
  } = await import("../apps/mobile/lib/expoSharedObjectSafe.ts");

  const released = new Error(
    "FunctionCallException: Calling the 'get' function has failed -> NativeSharedObjectNotFoundException: Unable to find the native shared object",
  );
  const genericFunctionCall = new Error("FunctionCallException: AVPlayer failed to load URL");
  const generic = new Error("plain native failure");

  assert.equal(isExpoSharedObjectReleasedError(released), true);
  assert.equal(isExpoSharedObjectReleasedError(genericFunctionCall), false);
  assert.equal(isExpoSharedObjectReleasedError(generic), false);
  assert.equal(safeExpoSharedObjectCall(() => {
    throw released;
  }, { fallback: "fallback" }), "fallback");
  assert.equal(safeExpoSharedObjectRead(() => {
    throw released;
  }, "read-fallback"), "read-fallback");
  assert.throws(() => safeExpoSharedObjectCall(() => {
    throw generic;
  }));
  assert.equal(safeExpoSharedObjectCall(() => {
    throw generic;
  }, { fallback: "swallowed", swallowAll: true }), "swallowed");

  let asyncRejected = false;
  attachSafeExpoSharedObjectPromise(Promise.reject(released), () => {
    throw new Error("released error should be swallowed before callback");
  });
  attachSafeExpoSharedObjectPromise(Promise.reject(generic), () => {
    asyncRejected = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(asyncRejected, true);
});

test("native chat recorder cleanup avoids released shared-object property reads", () => {
  assert.ok(nativeChat.includes("@/lib/expoSharedObjectSafe"));
  assert.ok(nativeChat.includes("readRecorderUriSafely"));
  assert.ok(nativeChat.includes("readRecorderCurrentTimeSafely"));
  assert.ok(nativeChat.includes("stopRecorderSafely"));
  assert.ok(nativeChat.includes("stopAndDiscardRecorder"));
  assert.ok(nativeChat.includes("cancelRecordingForExit"));
  assert.ok(nativeChat.includes("safeExpoSharedObjectAsync"));
  assert.ok(nativeChat.includes("safeExpoSharedObjectRead"));
  assert.ok(nativeChat.includes("voiceRecordingNowMs"));

  assert.doesNotMatch(nativeChat, /\buseAudioRecorderState\b/);
  assert.doesNotMatch(nativeChat, /\baudioRecorder\.isRecording\b/);
  assert.doesNotMatch(nativeChat, /\baudioRecorder\.uri\b/);
  assert.doesNotMatch(nativeChat, /\baudioRecorderState\b/);
});

test("native chat exit closes media surfaces before navigation watchdogs", () => {
  const goIdx = nativeChat.indexOf("const goToMatches = useCallback");
  assert.ok(goIdx >= 0, "goToMatches callback present");
  const goChunk = nativeChat.slice(goIdx, goIdx + 1400);
  assert.match(goChunk, /setPhotoViewer\(null\);[\s\S]*setVideoViewer\(null\);[\s\S]*cancelRecordingForExit\(\);[\s\S]*setExiting\(true\);/);
});

test("voice messages use safe local status listener instead of render-time status hook", () => {
  assert.doesNotMatch(voiceMessagePlayer, /\buseAudioPlayerStatus\b/);
  assert.match(voiceMessagePlayer, /readAudioPlayerStatusSafely/);
  assert.match(voiceMessagePlayer, /playbackStatusUpdate/);
  assert.match(voiceMessagePlayer, /safeExpoSharedObjectRead/);
  assert.match(voiceMessagePlayer, /safeRemoveExpoSharedObjectSubscription/);
  assert.match(voiceMessagePlayer, /safeExpoSharedObjectCall\(\s*\(\) => player\.pause\(\)/);
  assert.doesNotMatch(voiceMessagePlayer, /voice\.player\.pause\.unmount/);
});

test("native video surfaces guard player calls and subscription teardown", () => {
  for (const [label, source] of [
    ["chat route video card", nativeChat],
    ["vibe video player", vibeVideoPlayer],
    ["vibe clip card", vibeClipCard],
    ["fullscreen chat media viewer", mediaViewer],
  ] as const) {
    assert.match(source, /safeExpoSharedObjectCall/, `${label} wraps player calls`);
    assert.match(source, /safeRemoveExpoSharedObjectSubscription/, `${label} safely removes subscriptions`);
    assert.doesNotMatch(source, /safeVideoPlayerCall/, `${label} moved off the legacy video-only helper`);
  }

  assert.doesNotMatch(vibeVideoPlayer, /player\.replace\(/, "shared vibe video player avoids synchronous replace()");
  assert.match(vibeVideoPlayer, /player\.replaceAsync\(freshUri\)/);
  assert.match(vibeVideoPlayer, /vibeVideo\.player\.replaceAsync\.authRefreshSameUrl/);
  assert.match(vibeVideoPlayer, /attachSafeExpoSharedObjectPromise/);
  assert.match(vibeVideoPlayer, /safeExpoSharedObjectRead<VideoPlayerStatus>/);
  assert.match(vibeVideoPlayer, /vibeVideo\.player\.status\.initial/);
  assert.doesNotMatch(vibeVideoPlayer, /vibeVideo\.player\.pause\.unmount/);
  assert.doesNotMatch(nativeChat, /chat\.video\.pause\.unmount/);
  assert.match(nativeChat, /safeExpoSharedObjectRead<VideoPlayerStatus>/);
  assert.match(nativeChat, /chat\.video\.status\.initial/);
  assert.doesNotMatch(vibeClipCard, /player\.replace/, "vibe clip card relies on useVideoPlayer source creation");
  assert.doesNotMatch(mediaViewer, /player\.replace/, "fullscreen chat media viewer relies on useVideoPlayer source creation");
  assert.doesNotMatch(vibeClipCard, /vibeClip\.player\.pause\.unmount/);
  assert.doesNotMatch(mediaViewer, /chat\.viewerVideo\.pause\.unmount/);
  assert.match(vibeClipCard, /safeExpoSharedObjectRead<VideoPlayerStatus>/);
  assert.match(vibeClipCard, /vibeClip\.player\.status\.initial/);
  assert.match(mediaViewer, /safeExpoSharedObjectRead<VideoPlayerStatus>/);
  assert.match(mediaViewer, /chat\.viewerVideo\.status\.initial/);
  assert.match(vibeClipCard, /safeExpoSharedObjectCall\(\(\) => player\.pause/);
  assert.match(mediaViewer, /safeExpoSharedObjectCall\(\(\) => player\.play/);
  assert.match(mediaViewer, /const \[resolveFailed, setResolveFailed\] = useState\(false\)/);
  assert.match(mediaViewer, /if \(!isPlayableVideoUri\(playableUri\)\)/);
  assert.match(mediaViewer, /setResolveFailed\(true\)/);
  assert.match(mediaViewer, /refreshAttemptedForUriRef\.current = null/);
});

test("all Expo audio/video shared-object users are audited", () => {
  const expected = [
    "apps/mobile/app/chat/[id].tsx",
    "apps/mobile/components/chat/ChatThreadMediaViewer.tsx",
    "apps/mobile/components/chat/VibeClipCard.tsx",
    "apps/mobile/components/chat/VoiceMessagePlayer.tsx",
    "apps/mobile/components/video/VibeVideoPlayer.tsx",
  ].sort();
  const found = listSourceFiles("apps/mobile")
    .filter((file) => /\b(useVideoPlayer|useAudioPlayer|useAudioRecorder|createVideoPlayer)\b/.test(read(file)))
    .sort();

  assert.deepEqual(found, expected);
  for (const file of listSourceFiles("apps/mobile")) {
    const source = read(file);
    assert.doesNotMatch(source, /@\/lib\/expoVideoSafe/, `${file} must use expoSharedObjectSafe`);
    assert.doesNotMatch(source, /\buseAudioPlayerStatus\b/, `${file} must not read AudioPlayer status in render`);
    assert.doesNotMatch(source, /\buseAudioRecorderState\b/, `${file} must not poll AudioRecorder shared-object state`);
  }
});
