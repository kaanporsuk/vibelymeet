import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";
import {
  dailyVideoDateCallObjectOptions,
  dailyVideoDateCallObjectOptionsWithAppAcquiredMedia,
} from "@/lib/dailyCallObjectConfig";
import {
  createDailyCallObjectGuarded,
  readDailyMeetingState,
  registerWebVideoDateDailyCleanup,
} from "@/lib/dailyCallInstance";
import { vdbg } from "@/lib/vdbg";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import type { VideoDateWebMediaCaptureProfile } from "@clientShared/matching/videoDateMediaContract";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
  type ReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";

const WEB_DAILY_PREWARM_TTL_MS = 45_000;
const WEB_DAILY_PREWARM_PREAUTH_NAV_WAIT_MS = 250;
const WEB_DAILY_PREWARM_JOIN_NAV_WAIT_MS = 250;

type WebDailyPrewarmStatus =
  | "starting"
  | "camera_ready"
  | "preauth_ready"
  | "joining"
  | "joined"
  | "join_failed"
  | "consumed"
  | "fallback"
  | "destroyed";

type WebDailyPrewarmJoinSource = "both_ready" | "solo_prejoin";

type WebDailyPrewarmAppAcquiredMedia = {
  stream: MediaStream;
  captureProfile: VideoDateWebMediaCaptureProfile;
  acquiredAtMs: number;
  source: string;
};

type WebDailyPrewarmEntry = {
  key: string;
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
  call: DailyCall;
  createdAtMs: number;
  expiresAtMs: number;
  status: WebDailyPrewarmStatus;
  cameraPromise: Promise<void>;
  preAuthPromise: Promise<boolean> | null;
  joinPromise: Promise<boolean> | null;
  joinStartedAtMs: number | null;
  joinedAtMs: number | null;
  joinSource: WebDailyPrewarmJoinSource | null;
  appAcquiredMedia: WebDailyPrewarmAppAcquiredMedia | null;
  destroyTimer: number | null;
};

type WebDailyPrewarmPublicEntry = {
  call: DailyCall;
  roomName: string;
  roomUrl: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
  createdAtMs: number;
  joined: boolean;
  joinPromise: Promise<boolean> | null;
  joinStartedAtMs: number | null;
  joinedAtMs: number | null;
  joinSource: WebDailyPrewarmJoinSource | null;
  appAcquiredMedia: WebDailyPrewarmAppAcquiredMedia | null;
};

type WebDailyPrewarmConsumeResult =
  | { ok: true; entry: WebDailyPrewarmPublicEntry }
  | { ok: false; reason: string };

const prewarmEntries = new Map<string, WebDailyPrewarmEntry>();

function publicEntry(entry: WebDailyPrewarmEntry): WebDailyPrewarmPublicEntry {
  return {
    call: entry.call,
    roomName: entry.roomName,
    roomUrl: entry.roomUrl,
    captureProfile: entry.captureProfile,
    createdAtMs: entry.createdAtMs,
    joined: entry.status === "joined",
    joinPromise: entry.joinPromise,
    joinStartedAtMs: entry.joinStartedAtMs,
    joinedAtMs: entry.joinedAtMs,
    joinSource: entry.joinSource,
    appAcquiredMedia: entry.appAcquiredMedia,
  };
}

function firstLiveTrack(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  return tracks.find((track) => track.readyState !== "ended") ?? null;
}

type LivePrewarmMediaTracks = {
  audioTrack: MediaStreamTrack;
  videoTrack: MediaStreamTrack;
};

function getLivePrewarmMediaTracks(
  stream: MediaStream | null | undefined,
): LivePrewarmMediaTracks | null {
  const videoTrack = firstLiveTrack(stream?.getVideoTracks() ?? []);
  if (!videoTrack) return null;
  const audioTrack = firstLiveTrack(stream?.getAudioTracks() ?? []);
  if (!audioTrack) return null;
  return { audioTrack, videoTrack };
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

function prewarmEnabled(): boolean {
  return (
    String(
      import.meta.env.VITE_VIDEO_DATE_DAILY_PREWARM ?? "true",
    ).toLowerCase() === "true"
  );
}

function joinPrewarmEnabled(joinSource: WebDailyPrewarmJoinSource): boolean {
  if (!prewarmEnabled()) return false;
  const flagName =
    joinSource === "solo_prejoin"
      ? "VITE_VIDEO_DATE_DAILY_SOLO_PREJOIN"
      : "VITE_VIDEO_DATE_DAILY_JOIN_PREWARM";
  const defaultValue = joinSource === "solo_prejoin" ? "false" : "true";
  return (
    String(import.meta.env[flagName] ?? defaultValue).toLowerCase() === "true"
  );
}

function keyFor(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

function entryStopped(entry: WebDailyPrewarmEntry): boolean {
  return entry.status === "destroyed" || entry.status === "fallback";
}

function rejectUnusablePrewarmEntry(
  entry: WebDailyPrewarmEntry,
): string | null {
  try {
    if (entry.call.isDestroyed()) return "destroyed";
  } catch {
    return "destroyed";
  }

  const meetingState = readDailyMeetingState(entry.call);
  if (entry.status === "joined") {
    return meetingState === "joined-meeting"
      ? null
      : `joined_state_${meetingState ?? "unknown"}`;
  }
  if (entry.status === "joining") {
    return meetingState === "left-meeting" || meetingState === "error"
      ? `joining_state_${meetingState}`
      : null;
  }
  if (meetingState === "new" || meetingState === "loaded") return null;
  return `idle_state_${meetingState ?? "unknown"}`;
}

function checkpoint(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  checkpoint: ReadyGateToDateLatencyCheckpoint;
  sourceAction: string;
  outcome?: "success" | "failure";
  reasonCode?: string | null;
}) {
  const context = recordReadyGateToDateLatencyCheckpoint({
    sessionId: params.sessionId,
    platform: "web",
    eventId: params.eventId,
    sourceSurface: "ready_gate_overlay",
    checkpoint: params.checkpoint,
  });
  trackEvent(
    LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    buildReadyGateToDateLatencyPayload({
      context,
      checkpoint: params.checkpoint,
      sourceAction: params.sourceAction,
      outcome: params.outcome ?? "success",
      reasonCode: params.reasonCode ?? null,
    }),
  );
}

function destroyEntry(
  entry: WebDailyPrewarmEntry,
  reason: string,
  outcome: "success" | "failure" = "success",
) {
  if (entry.destroyTimer) {
    window.clearTimeout(entry.destroyTimer);
    entry.destroyTimer = null;
  }
  prewarmEntries.delete(entry.key);
  if (entry.status !== "consumed") {
    cleanupAbandonedCall(entry, reason);
  }
  entry.status = reason === "consumed" ? "consumed" : "destroyed";
  checkpoint({
    sessionId: entry.sessionId,
    userId: entry.userId,
    eventId: entry.eventId,
    checkpoint:
      reason === "consumed"
        ? "daily_prewarm_consumed"
        : "daily_prewarm_destroyed",
    sourceAction: reason,
    outcome,
  });
  vdbg("daily_prewarm_destroyed", {
    sessionId: entry.sessionId,
    eventId: entry.eventId,
    userId: entry.userId,
    roomName: entry.roomName,
    reason,
  });
}

function cleanupAbandonedCall(entry: WebDailyPrewarmEntry, reason: string) {
  const shouldWaitForJoin = entry.status === "joining";
  const wasJoined = entry.status === "joined" || entry.joinedAtMs != null;
  const cleanup = async () => {
    try {
      if (shouldWaitForJoin && entry.joinPromise) {
        await entry.joinPromise.catch(() => false);
      }
      if (wasJoined || entry.joinedAtMs != null) {
        await entry.call.leave().catch(() => undefined);
      }
      await Promise.resolve(entry.call.destroy());
    } catch (error) {
      Sentry.addBreadcrumb({
        category: "video-date",
        level: "warning",
        message: "web_daily_prewarm_destroy_failed",
        data: {
          sessionId: entry.sessionId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      stopMediaStreamTracks(entry.appAcquiredMedia?.stream);
    }
  };
  void registerWebVideoDateDailyCleanup(cleanup(), {
    source: "web_video_date_daily_prewarm",
    reason,
    onDiagnostic: (eventName, payload) => vdbg(eventName, payload),
  }).catch(() => undefined);
}

function fallbackEntry(
  entry: WebDailyPrewarmEntry,
  reason: string,
  reasonCode: string = reason,
) {
  if (entry.status !== "fallback") {
    entry.status = "fallback";
    checkpoint({
      sessionId: entry.sessionId,
      userId: entry.userId,
      eventId: entry.eventId,
      checkpoint: "daily_prewarm_fallback",
      sourceAction: reason,
      outcome: "failure",
      reasonCode,
    });
  }
  destroyEntry(entry, reason, "failure");
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      () => {
        window.clearTimeout(timeout);
        resolve(null);
      },
    );
  });
}

export async function startWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  captureProfile?: VideoDateWebMediaCaptureProfile;
  appAcquiredMedia?: WebDailyPrewarmAppAcquiredMedia | null;
  source: string;
}): Promise<WebDailyPrewarmConsumeResult> {
  if (!prewarmEnabled()) return { ok: false, reason: "flag_disabled" };
  if (typeof window === "undefined")
    return { ok: false, reason: "window_unavailable" };
  const key = keyFor(params.sessionId, params.userId);
  const existing = prewarmEntries.get(key);
  if (existing) {
    if (existing.expiresAtMs > Date.now()) {
      if (
        existing.roomName === params.roomName &&
        existing.roomUrl === params.roomUrl
      ) {
        return { ok: true, entry: publicEntry(existing) };
      }
      fallbackEntry(existing, "daily_prewarm_room_changed");
    } else {
      fallbackEntry(existing, "daily_prewarm_expired_before_restart");
    }
  }

  const captureProfile =
    params.appAcquiredMedia?.captureProfile ?? params.captureProfile ?? "ideal";
  const appAcquiredMediaTracks =
    params.appAcquiredMedia?.captureProfile === captureProfile
      ? getLivePrewarmMediaTracks(params.appAcquiredMedia.stream)
      : null;
  const appAcquiredMedia = appAcquiredMediaTracks
    ? (params.appAcquiredMedia ?? null)
    : null;
  const guardedCall = await createDailyCallObjectGuarded(
    DailyIframe,
    appAcquiredMedia && appAcquiredMediaTracks
      ? dailyVideoDateCallObjectOptionsWithAppAcquiredMedia(
          captureProfile,
          appAcquiredMediaTracks,
        )
      : dailyVideoDateCallObjectOptions(captureProfile),
    {
      source: `web_video_date_daily_prewarm:${params.source}`,
      skipIfCleanupPending: true,
      waitForCleanup: false,
      failOnExternalCall: true,
      adoptMatchingExternalCall: false,
      videoDateSessionId: params.sessionId,
      videoDateRoomName: params.roomName,
      onDiagnostic: (eventName, payload) => {
        vdbg(eventName, {
          sessionId: params.sessionId,
          eventId: params.eventId,
          userId: params.userId,
          roomName: params.roomName,
          source: params.source,
          ...payload,
        });
      },
    },
  );
  if (guardedCall.ok === false) {
    vdbg("daily_prewarm_create_guard_skipped", {
      sessionId: params.sessionId,
      eventId: params.eventId,
      userId: params.userId,
      roomName: params.roomName,
      reason: guardedCall.reason,
      meetingState: guardedCall.meetingState ?? null,
    });
    return { ok: false, reason: guardedCall.reason };
  }
  const call = guardedCall.call;
  const nowMs = Date.now();
  const entry: WebDailyPrewarmEntry = {
    key,
    sessionId: params.sessionId,
    userId: params.userId,
    eventId: params.eventId,
    roomName: params.roomName,
    roomUrl: params.roomUrl,
    captureProfile,
    call,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + WEB_DAILY_PREWARM_TTL_MS,
    status: "starting",
    cameraPromise: Promise.resolve(),
    preAuthPromise: null,
    joinPromise: null,
    joinStartedAtMs: null,
    joinedAtMs: null,
    joinSource: null,
    appAcquiredMedia,
    destroyTimer: null,
  };
  prewarmEntries.set(key, entry);
  entry.destroyTimer = window.setTimeout(() => {
    if (prewarmEntries.get(key) === entry) {
      fallbackEntry(entry, "daily_prewarm_ttl_expired");
    }
  }, WEB_DAILY_PREWARM_TTL_MS);

  checkpoint({
    sessionId: params.sessionId,
    userId: params.userId,
    eventId: params.eventId,
    checkpoint: "daily_prewarm_started",
    sourceAction: params.source,
  });
  vdbg("daily_prewarm_started", {
    sessionId: params.sessionId,
    eventId: params.eventId,
    userId: params.userId,
    roomName: params.roomName,
    captureProfile,
    appAcquiredMedia: Boolean(appAcquiredMedia),
  });

  entry.cameraPromise = Promise.resolve(
    call.startCamera({ url: params.roomUrl }),
  ).then(
    () => {
      if (prewarmEntries.get(key) !== entry) return;
      entry.status = "camera_ready";
      checkpoint({
        sessionId: params.sessionId,
        userId: params.userId,
        eventId: params.eventId,
        checkpoint: "daily_prewarm_camera_ready",
        sourceAction: "daily_prewarm_camera_ready",
      });
      vdbg("daily_prewarm_camera_ready", {
        sessionId: params.sessionId,
        eventId: params.eventId,
        userId: params.userId,
        roomName: params.roomName,
      });
    },
    (error) => {
      if (prewarmEntries.get(key) !== entry) return;
      fallbackEntry(
        entry,
        "daily_prewarm_start_camera_failed",
        error instanceof Error ? error.name : "start_camera_failed",
      );
    },
  );

  return { ok: true, entry: publicEntry(entry) };
}

export async function preAuthWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  token: string;
  source: string;
  waitMs?: number;
}): Promise<boolean> {
  if (!prewarmEnabled()) return false;
  const entry = prewarmEntries.get(keyFor(params.sessionId, params.userId));
  if (
    !entry ||
    entry.roomName !== params.roomName ||
    entry.roomUrl !== params.roomUrl ||
    entry.status === "destroyed" ||
    entry.status === "fallback"
  ) {
    return false;
  }
  if (entry.status === "joined") {
    return true;
  }
  if (typeof entry.call.preAuth !== "function") {
    return false;
  }
  entry.preAuthPromise = Promise.resolve(
    entry.call.preAuth({ url: params.roomUrl, token: params.token }),
  ).then(
    () => {
      if (prewarmEntries.get(entry.key) !== entry) return false;
      entry.status = "preauth_ready";
      checkpoint({
        sessionId: params.sessionId,
        userId: params.userId,
        eventId: params.eventId,
        checkpoint: "daily_prewarm_preauth_success",
        sourceAction: params.source,
      });
      return true;
    },
    (error) => {
      if (prewarmEntries.get(entry.key) !== entry) return false;
      fallbackEntry(
        entry,
        "daily_prewarm_preauth_failed",
        error instanceof Error ? error.name : "preauth_failed",
      );
      return false;
    },
  );
  return (
    (await waitWithTimeout(
      entry.preAuthPromise,
      params.waitMs ?? WEB_DAILY_PREWARM_PREAUTH_NAV_WAIT_MS,
    )) ?? true
  );
}

export async function joinWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  token: string;
  source: string;
  joinSource: WebDailyPrewarmJoinSource;
  waitMs?: number;
}): Promise<boolean> {
  if (!joinPrewarmEnabled(params.joinSource)) return false;
  const entry = prewarmEntries.get(keyFor(params.sessionId, params.userId));
  if (
    !entry ||
    entry.roomName !== params.roomName ||
    entry.roomUrl !== params.roomUrl ||
    entry.status === "destroyed" ||
    entry.status === "fallback"
  ) {
    return false;
  }
  if (entry.status === "joined") return true;
  if (entry.joinPromise) {
    return (
      (await waitWithTimeout(
        entry.joinPromise,
        params.waitMs ?? WEB_DAILY_PREWARM_JOIN_NAV_WAIT_MS,
      )) ?? true
    );
  }

  const startedAtMs = Date.now();
  entry.status = "joining";
  entry.joinStartedAtMs = startedAtMs;
  entry.joinSource = params.joinSource;
  const startedCheckpoint =
    params.joinSource === "solo_prejoin"
      ? "daily_prewarm_solo_join_started"
      : "daily_prewarm_join_started";
  const successCheckpoint =
    params.joinSource === "solo_prejoin"
      ? "daily_prewarm_solo_join_success"
      : "daily_prewarm_join_success";
  const failureCheckpoint =
    params.joinSource === "solo_prejoin"
      ? "daily_prewarm_solo_join_failure"
      : "daily_prewarm_join_failure";

  checkpoint({
    sessionId: params.sessionId,
    userId: params.userId,
    eventId: params.eventId,
    checkpoint: startedCheckpoint,
    sourceAction: params.source,
  });
  vdbg(startedCheckpoint, {
    sessionId: params.sessionId,
    eventId: params.eventId,
    userId: params.userId,
    roomName: entry.roomName,
    joinSource: params.joinSource,
  });

  entry.joinPromise = (async () => {
    await entry.cameraPromise.catch(() => undefined);
    if (entry.preAuthPromise) {
      const preAuthOk = await entry.preAuthPromise.catch(() => false);
      if (preAuthOk === false)
        throw new Error("daily_prewarm_preauth_unavailable");
    }
    if (
      (prewarmEntries.get(entry.key) !== entry &&
        entry.status !== "consumed") ||
      entryStopped(entry)
    ) {
      throw new Error("daily_prewarm_not_usable");
    }
    await entry.call.join({ url: params.roomUrl, token: params.token });
    if (entryStopped(entry)) {
      throw new Error("daily_prewarm_not_usable");
    }
    entry.status = "joined";
    entry.joinedAtMs = Date.now();
    checkpoint({
      sessionId: params.sessionId,
      userId: params.userId,
      eventId: params.eventId,
      checkpoint: successCheckpoint,
      sourceAction: params.source,
      outcome: "success",
    });
    vdbg(successCheckpoint, {
      sessionId: params.sessionId,
      eventId: params.eventId,
      userId: params.userId,
      roomName: entry.roomName,
      joinDurationMs: Math.max(0, entry.joinedAtMs - startedAtMs),
      joinSource: params.joinSource,
    });
    return true;
  })().catch((error) => {
    if (prewarmEntries.get(entry.key) === entry) {
      entry.status = "join_failed";
      checkpoint({
        sessionId: params.sessionId,
        userId: params.userId,
        eventId: params.eventId,
        checkpoint: failureCheckpoint,
        sourceAction: params.source,
        outcome: "failure",
        reasonCode: error instanceof Error ? error.name : "join_failed",
      });
      fallbackEntry(
        entry,
        failureCheckpoint,
        error instanceof Error ? error.name : "join_failed",
      );
    } else if (entry.status === "consumed") {
      entry.status = "join_failed";
      checkpoint({
        sessionId: params.sessionId,
        userId: params.userId,
        eventId: params.eventId,
        checkpoint: failureCheckpoint,
        sourceAction: params.source,
        outcome: "failure",
        reasonCode: error instanceof Error ? error.name : "join_failed",
      });
    }
    return false;
  });

  return (
    (await waitWithTimeout(
      entry.joinPromise,
      params.waitMs ?? WEB_DAILY_PREWARM_JOIN_NAV_WAIT_MS,
    )) ?? true
  );
}

export function consumeWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
}): WebDailyPrewarmConsumeResult {
  if (!prewarmEnabled()) return { ok: false, reason: "flag_disabled" };
  const key = keyFor(params.sessionId, params.userId);
  const entry = prewarmEntries.get(key);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.expiresAtMs <= Date.now()) {
    fallbackEntry(entry, "daily_prewarm_expired");
    return { ok: false, reason: "expired" };
  }
  if (entry.roomUrl !== params.roomUrl || entry.roomName !== params.roomName) {
    fallbackEntry(entry, "daily_prewarm_room_mismatch");
    return { ok: false, reason: "room_mismatch" };
  }
  if (entry.captureProfile !== params.captureProfile) {
    fallbackEntry(entry, "daily_prewarm_capture_profile_mismatch");
    return { ok: false, reason: "capture_profile_mismatch" };
  }
  if (
    entry.status === "fallback" ||
    entry.status === "destroyed" ||
    entry.status === "join_failed"
  ) {
    fallbackEntry(entry, "daily_prewarm_not_usable");
    return { ok: false, reason: "not_usable" };
  }
  const unusableReason = rejectUnusablePrewarmEntry(entry);
  if (unusableReason) {
    fallbackEntry(entry, `daily_prewarm_call_${unusableReason}`);
    return { ok: false, reason: "call_not_usable" };
  }
  if (entry.destroyTimer) {
    window.clearTimeout(entry.destroyTimer);
    entry.destroyTimer = null;
  }
  prewarmEntries.delete(key);
  entry.status = "consumed";
  checkpoint({
    sessionId: params.sessionId,
    userId: params.userId,
    eventId: params.eventId,
    checkpoint: "daily_prewarm_consumed",
    sourceAction: "daily_prewarm_consumed",
  });
  return { ok: true, entry: publicEntry(entry) };
}

export function destroyWebVideoDateDailyPrewarm(
  sessionId: string,
  userId: string,
  reason: string,
): boolean {
  const entry = prewarmEntries.get(keyFor(sessionId, userId));
  if (!entry) return false;
  destroyEntry(entry, reason);
  return true;
}

export function markWebVideoDateDailyPrewarmFallback(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  reason: string;
}) {
  checkpoint({
    sessionId: params.sessionId,
    userId: params.userId,
    eventId: params.eventId,
    checkpoint: "daily_prewarm_fallback",
    sourceAction: params.reason,
    outcome: "failure",
    reasonCode: params.reason,
  });
}
