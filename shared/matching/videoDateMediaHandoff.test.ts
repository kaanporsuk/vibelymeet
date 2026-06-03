import test from "node:test";
import assert from "node:assert/strict";
import {
  clearAllWebVideoDateMediaHandoffs,
  consumeWebVideoDateMediaHandoff,
  setWebVideoDateMediaHandoff,
} from "../../src/lib/videoDateMediaHandoff";

type FakeTrackKind = "audio" | "video";

function track(kind: FakeTrackKind, readyState: MediaStreamTrackState = "live") {
  return {
    kind,
    readyState,
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  } as unknown as MediaStreamTrack & { stopped: boolean };
}

function stream(params: { video?: MediaStreamTrack[]; audio?: MediaStreamTrack[] } = {}) {
  const video = params.video ?? [track("video")];
  const audio = params.audio ?? [track("audio")];
  const all = [...video, ...audio];
  return {
    getTracks: () => all,
    getVideoTracks: () => video,
    getAudioTracks: () => audio,
  } as unknown as MediaStream;
}

test.afterEach(() => {
  clearAllWebVideoDateMediaHandoffs({ stopTracks: true });
});

test("web video date media handoff consumes the same session and user once", () => {
  const media = stream();
  const stored = setWebVideoDateMediaHandoff({
    sessionId: "session-1",
    userId: "user-1",
    stream: media,
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });

  assert.equal(stored.ok, true);
  const consumed = consumeWebVideoDateMediaHandoff({
    sessionId: "session-1",
    userId: "user-1",
    nowMs: 300,
  });
  assert.equal(consumed.ok, true);
  if (consumed.ok) {
    assert.equal(consumed.stream, media);
    assert.equal(consumed.captureProfile, "ideal");
    assert.equal(consumed.source, "ready_gate_permission_prewarm");
    assert.equal(consumed.acquiredAtMs, 100);
  }

  assert.deepEqual(
    consumeWebVideoDateMediaHandoff({ sessionId: "session-1", userId: "user-1", nowMs: 301 }),
    { ok: false, reason: "missing" },
  );
});

test("web video date media handoff misses for mismatched session or user", () => {
  const media = stream();
  setWebVideoDateMediaHandoff({
    sessionId: "session-1",
    userId: "user-1",
    stream: media,
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });

  assert.deepEqual(
    consumeWebVideoDateMediaHandoff({ sessionId: "session-2", userId: "user-1", nowMs: 250 }),
    { ok: false, reason: "missing" },
  );
  assert.deepEqual(
    consumeWebVideoDateMediaHandoff({ sessionId: "session-1", userId: "user-2", nowMs: 250 }),
    { ok: false, reason: "missing" },
  );
});

test("web video date media handoff expires and releases stale tracks", () => {
  const videoTrack = track("video");
  const audioTrack = track("audio");
  const media = stream({ video: [videoTrack], audio: [audioTrack] });
  setWebVideoDateMediaHandoff({
    sessionId: "session-1",
    userId: "user-1",
    stream: media,
    captureProfile: "fallback",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 50,
  });

  assert.deepEqual(
    consumeWebVideoDateMediaHandoff({ sessionId: "session-1", userId: "user-1", nowMs: 251 }),
    { ok: false, reason: "expired" },
  );
  assert.equal((videoTrack as MediaStreamTrack & { stopped: boolean }).stopped, true);
  assert.equal((audioTrack as MediaStreamTrack & { stopped: boolean }).stopped, true);
});

test("web video date media handoff fails safely for ended or incomplete streams", () => {
  const endedVideo = track("video", "ended");
  const ended = setWebVideoDateMediaHandoff({
    sessionId: "session-ended",
    userId: "user-1",
    stream: stream({ video: [endedVideo] }),
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });
  assert.deepEqual(ended, { ok: false, reason: "ended_video_track" });
  assert.equal((endedVideo as MediaStreamTrack & { stopped: boolean }).stopped, true);

  const missingAudio = setWebVideoDateMediaHandoff({
    sessionId: "session-no-audio",
    userId: "user-1",
    stream: stream({ audio: [] }),
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });
  assert.deepEqual(missingAudio, { ok: false, reason: "missing_audio_track" });

  const endedAudioVideo = track("video");
  const endedAudio = track("audio", "ended");
  const endedAudioHandoff = setWebVideoDateMediaHandoff({
    sessionId: "session-ended-audio",
    userId: "user-1",
    stream: stream({ video: [endedAudioVideo], audio: [endedAudio] }),
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });
  assert.deepEqual(endedAudioHandoff, { ok: false, reason: "ended_audio_track" });
  assert.equal((endedAudioVideo as MediaStreamTrack & { stopped: boolean }).stopped, true);
});

test("web video date media handoff releases tracks when consumed after becoming invalid", () => {
  const videoTrack = track("video");
  const audioTrack = track("audio");
  const videoTracks = [videoTrack];
  const audioTracks = [audioTrack];
  const media = stream({ video: videoTracks, audio: audioTracks });

  const stored = setWebVideoDateMediaHandoff({
    sessionId: "session-invalid-after-store",
    userId: "user-1",
    stream: media,
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });
  assert.equal(stored.ok, true);

  audioTracks.splice(0, audioTracks.length);

  assert.deepEqual(
    consumeWebVideoDateMediaHandoff({
      sessionId: "session-invalid-after-store",
      userId: "user-1",
      nowMs: 250,
    }),
    { ok: false, reason: "missing_audio_track" },
  );
  assert.equal((videoTrack as MediaStreamTrack & { stopped: boolean }).stopped, true);
  assert.equal((audioTrack as MediaStreamTrack & { stopped: boolean }).stopped, true);
});

test("web video date media handoff rejects audio that ends after storing", () => {
  const videoTrack = track("video");
  const audioTrack = track("audio");
  const media = stream({ video: [videoTrack], audio: [audioTrack] });

  const stored = setWebVideoDateMediaHandoff({
    sessionId: "session-audio-ended-after-store",
    userId: "user-1",
    stream: media,
    captureProfile: "ideal",
    source: "ready_gate_permission_prewarm",
    acquiredAtMs: 100,
    nowMs: 200,
    ttlMs: 1_000,
  });
  assert.equal(stored.ok, true);

  audioTrack.stop();

  assert.deepEqual(
    consumeWebVideoDateMediaHandoff({
      sessionId: "session-audio-ended-after-store",
      userId: "user-1",
      nowMs: 250,
    }),
    { ok: false, reason: "ended_audio_track" },
  );
  assert.equal((videoTrack as MediaStreamTrack & { stopped: boolean }).stopped, true);
  assert.equal((audioTrack as MediaStreamTrack & { stopped: boolean }).stopped, true);
});
