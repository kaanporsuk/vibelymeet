import type { VideoDateWebMediaCaptureProfile } from "@clientShared/matching/videoDateMediaContract";

export const WEB_VIDEO_DATE_MEDIA_HANDOFF_TTL_MS = 12_000;

export type WebVideoDateMediaHandoffMissReason =
  | "missing"
  | "expired"
  | "ended_video_track"
  | "missing_video_track"
  | "missing_audio_track";

type WebVideoDateMediaHandoffEntry = {
  key: string;
  sessionId: string;
  userId: string;
  stream: MediaStream;
  captureProfile: VideoDateWebMediaCaptureProfile;
  source: string;
  acquiredAtMs: number;
  storedAtMs: number;
  expiresAtMs: number;
  expireTimer: ReturnType<typeof setTimeout> | null;
};

export type WebVideoDateMediaHandoffConsumeResult =
  | {
      ok: true;
      stream: MediaStream;
      captureProfile: VideoDateWebMediaCaptureProfile;
      source: string;
      acquiredAtMs: number;
    }
  | { ok: false; reason: WebVideoDateMediaHandoffMissReason };

const handoffEntries = new Map<string, WebVideoDateMediaHandoffEntry>();

function keyFor(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

function firstLiveTrack(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  return tracks.find((track) => track.readyState !== "ended") ?? null;
}

function stopMediaStreamTracks(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* best-effort cleanup */
    }
  });
}

function clearExpiryTimer(entry: WebVideoDateMediaHandoffEntry) {
  if (!entry.expireTimer) return;
  clearTimeout(entry.expireTimer);
  entry.expireTimer = null;
}

function removeEntry(entry: WebVideoDateMediaHandoffEntry, stopTracks: boolean) {
  clearExpiryTimer(entry);
  handoffEntries.delete(entry.key);
  if (stopTracks) {
    stopMediaStreamTracks(entry.stream);
  }
}

function validateEntry(entry: WebVideoDateMediaHandoffEntry, nowMs: number): WebVideoDateMediaHandoffMissReason | null {
  if (entry.expiresAtMs <= nowMs) return "expired";
  const videoTracks = entry.stream.getVideoTracks();
  if (videoTracks.length === 0) return "missing_video_track";
  if (!firstLiveTrack(videoTracks)) return "ended_video_track";
  if (entry.stream.getAudioTracks().length === 0) return "missing_audio_track";
  return null;
}

export function setWebVideoDateMediaHandoff(params: {
  sessionId: string;
  userId: string;
  stream: MediaStream;
  captureProfile: VideoDateWebMediaCaptureProfile;
  source: string;
  acquiredAtMs: number;
  ttlMs?: number;
  nowMs?: number;
}): WebVideoDateMediaHandoffConsumeResult {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? WEB_VIDEO_DATE_MEDIA_HANDOFF_TTL_MS;
  const key = keyFor(params.sessionId, params.userId);
  const existing = handoffEntries.get(key);
  if (existing) {
    removeEntry(existing, existing.stream !== params.stream);
  }

  const entry: WebVideoDateMediaHandoffEntry = {
    key,
    sessionId: params.sessionId,
    userId: params.userId,
    stream: params.stream,
    captureProfile: params.captureProfile,
    source: params.source,
    acquiredAtMs: params.acquiredAtMs,
    storedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    expireTimer: null,
  };

  const invalidReason = validateEntry(entry, nowMs);
  if (invalidReason) {
    if (invalidReason === "expired" || invalidReason === "ended_video_track") {
      stopMediaStreamTracks(params.stream);
    }
    return { ok: false, reason: invalidReason };
  }

  handoffEntries.set(key, entry);
  if (ttlMs > 0) {
    entry.expireTimer = setTimeout(() => {
      if (handoffEntries.get(key) === entry) {
        removeEntry(entry, true);
      }
    }, ttlMs);
  }

  return {
    ok: true,
    stream: entry.stream,
    captureProfile: entry.captureProfile,
    source: entry.source,
    acquiredAtMs: entry.acquiredAtMs,
  };
}

export function consumeWebVideoDateMediaHandoff(params: {
  sessionId: string;
  userId: string;
  nowMs?: number;
}): WebVideoDateMediaHandoffConsumeResult {
  const key = keyFor(params.sessionId, params.userId);
  const entry = handoffEntries.get(key);
  if (!entry) return { ok: false, reason: "missing" };

  const reason = validateEntry(entry, params.nowMs ?? Date.now());
  if (reason) {
    removeEntry(entry, true);
    return { ok: false, reason };
  }

  removeEntry(entry, false);
  return {
    ok: true,
    stream: entry.stream,
    captureProfile: entry.captureProfile,
    source: entry.source,
    acquiredAtMs: entry.acquiredAtMs,
  };
}

export function clearWebVideoDateMediaHandoff(
  sessionId: string,
  userId: string,
  options: { stopTracks?: boolean } = {},
): boolean {
  const entry = handoffEntries.get(keyFor(sessionId, userId));
  if (!entry) return false;
  removeEntry(entry, options.stopTracks === true);
  return true;
}

export function clearAllWebVideoDateMediaHandoffs(options: { stopTracks?: boolean } = {}) {
  for (const entry of handoffEntries.values()) {
    removeEntry(entry, options.stopTracks === true);
  }
}
