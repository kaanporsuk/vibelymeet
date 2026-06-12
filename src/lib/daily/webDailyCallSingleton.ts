import { DailyCall } from "@daily-co/daily-js";
import { vdbg } from "@/lib/vdbg";
import {
  readDailyMeetingState,
  registerWebVideoDateDailyCleanup,
} from "@/lib/dailyCallInstance";
import type { DailyRoomFailureKind } from "@clientShared/matching/dailyRoomFailure";
import type { VideoDateWebMediaCaptureProfile } from "@clientShared/matching/videoDateMediaContract";
import {
  hasLiveDailyLocalCameraAndMicrophone,
  stopMediaStreamTracks,
  WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS,
  WEB_VIDEO_DATE_START_GATE_TTL_MS,
  type AppAcquiredVideoDateMedia,
} from "./webDailyMediaHelpers";

/**
 * Web Daily call-object singleton: live same-session remount parking with
 * heartbeat transfer, and the per-session/user start gate. Extracted
 * verbatim from src/hooks/useVideoCall.ts (Video Date rebuild PR 7).
 *
 * Invariants preserved from the source (do not regress):
 * - active Daily start/join protection is per-session/user via the start
 *   gate, never component-local state;
 * - parking a live joined/joining call must not arm idle destruction;
 * - consume requires same user + same session + same room + live local
 *   media, otherwise the parked call is destroyed, never reused.
 */

export type WebDailyCallSingletonEntry = {
  call: DailyCall;
  userId: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
  appAcquiredMedia: AppAcquiredVideoDateMedia | null;
  previousSessionId: string | null;
  previousRoomName: string | null;
  parkingMode: "live_same_session_remount";
  parkedAtMs: number;
  idleMs: number | null;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  stopHeartbeat?: (reason: string) => void;
};

let webDailyCallSingletonEntry: WebDailyCallSingletonEntry | null = null;

export function getWebDailyCallSingletonIdleAgeMs(entry: WebDailyCallSingletonEntry) {
  return Math.max(0, Date.now() - entry.parkedAtMs);
}

export function isWebDailyCallSingletonIdleExpired(entry: WebDailyCallSingletonEntry) {
  return (
    typeof entry.idleMs === "number" &&
    getWebDailyCallSingletonIdleAgeMs(entry) > entry.idleMs
  );
}

export function destroyWebDailyCallSingleton(reason: string) {
  const entry = webDailyCallSingletonEntry;
  if (!entry) return;
  webDailyCallSingletonEntry = null;
  if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
  entry.stopHeartbeat?.(`daily_call_singleton_destroy:${reason}`);
  void registerWebVideoDateDailyCleanup(
    Promise.resolve()
      .then(async () => {
        try {
          await Promise.resolve(entry.call.leave());
        } catch {
          // Best effort: destroy below still releases the Daily instance.
        }
        await Promise.resolve(entry.call.destroy());
      })
      .finally(() => {
        stopMediaStreamTracks(entry.appAcquiredMedia?.stream);
      }),
    {
      source: "web_video_date_daily_singleton",
      reason,
      onDiagnostic: (eventName, payload) => vdbg(eventName, payload),
    },
  ).catch(() => undefined);
  vdbg("daily_call_singleton_destroyed", {
    platform: "web",
    reason,
    previousSessionId: entry.previousSessionId,
    previousRoomName: entry.previousRoomName,
    parkingMode: entry.parkingMode,
    idleDestroyDisabled: entry.idleMs == null,
    idleMs: entry.idleMs,
    idleAgeMs: getWebDailyCallSingletonIdleAgeMs(entry),
    hadAppAcquiredMedia: Boolean(entry.appAcquiredMedia),
  });
}

export function parkWebDailyCallSingleton(params: {
  call: DailyCall;
  userId: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
  appAcquiredMedia: AppAcquiredVideoDateMedia | null;
  previousSessionId: string | null;
  previousRoomName: string | null;
  reason: string;
  stopHeartbeat?: (reason: string) => void;
}) {
  if (
    webDailyCallSingletonEntry &&
    webDailyCallSingletonEntry.call !== params.call
  ) {
    destroyWebDailyCallSingleton("replaced_by_new_singleton");
  } else if (webDailyCallSingletonEntry?.destroyTimer) {
    clearTimeout(webDailyCallSingletonEntry.destroyTimer);
  }
  const parkingMode: WebDailyCallSingletonEntry["parkingMode"] =
    "live_same_session_remount";
  const idleMs = WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS;
  const entry: WebDailyCallSingletonEntry = {
    call: params.call,
    userId: params.userId,
    captureProfile: params.captureProfile,
    appAcquiredMedia: params.appAcquiredMedia,
    previousSessionId: params.previousSessionId,
    previousRoomName: params.previousRoomName,
    parkingMode,
    parkedAtMs: Date.now(),
    idleMs,
    destroyTimer: null,
    stopHeartbeat: params.stopHeartbeat,
  };
  if (typeof idleMs === "number") {
    entry.destroyTimer = setTimeout(() => {
      if (webDailyCallSingletonEntry?.call === params.call) {
        destroyWebDailyCallSingleton("idle_timeout");
      }
    }, idleMs);
  }
  webDailyCallSingletonEntry = entry;
  vdbg("daily_call_singleton_parked", {
    platform: "web",
    reason: params.reason,
    parkingMode,
    previousSessionId: params.previousSessionId,
    previousRoomName: params.previousRoomName,
    idleMs,
    idleDestroyDisabled: idleMs == null,
  });
}

export function consumeWebDailyCallSingleton(params: {
  userId: string;
  nextSessionId: string;
  nextRoomName: string;
}):
  | { ok: true; entry: WebDailyCallSingletonEntry; meetingState: string | null }
  | { ok: false; reason: string } {
  const entry = webDailyCallSingletonEntry;
  if (!entry) return { ok: false, reason: "missing_singleton" };
  if (isWebDailyCallSingletonIdleExpired(entry)) {
    destroyWebDailyCallSingleton("expired_before_consume");
    return { ok: false, reason: "expired_before_consume" };
  }
  if (entry.call.isDestroyed()) {
    destroyWebDailyCallSingleton("destroyed_before_consume");
    return { ok: false, reason: "destroyed_before_consume" };
  }
  if (entry.userId !== params.userId) {
    destroyWebDailyCallSingleton("user_changed");
    return { ok: false, reason: "user_changed" };
  }
  if (
    entry.previousSessionId !== params.nextSessionId ||
    entry.previousRoomName !== params.nextRoomName
  ) {
    destroyWebDailyCallSingleton("session_or_room_changed_before_consume");
    return { ok: false, reason: "session_or_room_changed" };
  }
  const meetingState = readDailyMeetingState(entry.call);
  if (meetingState !== "joined-meeting" && meetingState !== "joining-meeting") {
    destroyWebDailyCallSingleton("not_joined_before_consume");
    return { ok: false, reason: "not_joined" };
  }
  if (
    meetingState === "joined-meeting" &&
    !hasLiveDailyLocalCameraAndMicrophone(entry.call)
  ) {
    destroyWebDailyCallSingleton("local_media_not_live_before_consume");
    return { ok: false, reason: "local_media_not_live" };
  }
  if (entry.destroyTimer) {
    clearTimeout(entry.destroyTimer);
    entry.destroyTimer = null;
  }
  webDailyCallSingletonEntry = null;
  entry.stopHeartbeat?.("daily_call_singleton_consumed");
  vdbg("daily_call_singleton_reused", {
    platform: "web",
    previousSessionId: entry.previousSessionId,
    nextSessionId: params.nextSessionId,
    previousRoomName: entry.previousRoomName,
    nextRoomName: params.nextRoomName,
    meetingState,
    parkingMode: entry.parkingMode,
    idleAgeMs: getWebDailyCallSingletonIdleAgeMs(entry),
    idleDestroyDisabled: entry.idleMs == null,
    heartbeatTransferred: Boolean(entry.stopHeartbeat),
  });
  return { ok: true, entry, meetingState };
}

export function hasReusableWebDailyCallSingleton(params: {
  userId: string;
  nextSessionId: string;
}): boolean {
  const entry = webDailyCallSingletonEntry;
  if (!entry) return false;
  if (isWebDailyCallSingletonIdleExpired(entry)) {
    destroyWebDailyCallSingleton("expired_before_preflight");
    return false;
  }
  if (entry.call.isDestroyed()) {
    destroyWebDailyCallSingleton("destroyed_before_preflight");
    return false;
  }
  if (entry.userId !== params.userId) {
    destroyWebDailyCallSingleton("user_changed_before_preflight");
    return false;
  }
  if (entry.previousSessionId !== params.nextSessionId) {
    destroyWebDailyCallSingleton("session_changed_before_preflight");
    return false;
  }
  const meetingState = readDailyMeetingState(entry.call);
  if (meetingState !== "joined-meeting" && meetingState !== "joining-meeting") {
    destroyWebDailyCallSingleton("not_joined_before_preflight");
    return false;
  }
  if (
    meetingState === "joined-meeting" &&
    !hasLiveDailyLocalCameraAndMicrophone(entry.call)
  ) {
    destroyWebDailyCallSingleton("local_media_not_live_before_preflight");
    return false;
  }
  return true;
}

export type VideoCallStartFailure = {
  kind:
    | DailyRoomFailureKind
    | "daily_join_failed"
    | "daily_call_busy"
    | "start_call_in_flight_failed"
    | "media_permission_denied"
    | "session_unavailable";
  retryable: boolean;
  httpStatus?: number;
  serverCode?: string;
};

export type VideoCallStartResult =
  | { ok: true }
  | {
      ok: false;
      failure: VideoCallStartFailure;
    };

export type WebVideoDateStartGateEntry = {
  sessionId: string;
  userId: string | null;
  promise: Promise<VideoCallStartResult>;
  startedAtMs: number;
  observeCount: number;
};

const webVideoDateStartGateEntries = new Map<
  string,
  WebVideoDateStartGateEntry
>();

export function webVideoDateStartGateKey(
  sessionId: string,
  userId: string | null | undefined,
) {
  return `${sessionId}:${userId ?? "anonymous"}`;
}

export function getWebVideoDateStartGateEntry(
  sessionId: string,
  userId: string | null | undefined,
): WebVideoDateStartGateEntry | null {
  const key = webVideoDateStartGateKey(sessionId, userId);
  const entry = webVideoDateStartGateEntries.get(key) ?? null;
  if (!entry) return null;
  if (Date.now() - entry.startedAtMs > WEB_VIDEO_DATE_START_GATE_TTL_MS) {
    webVideoDateStartGateEntries.delete(key);
    return null;
  }
  return entry;
}

export function registerWebVideoDateStartGateEntry(
  sessionId: string,
  userId: string | null | undefined,
  promise: Promise<VideoCallStartResult>,
): WebVideoDateStartGateEntry {
  const key = webVideoDateStartGateKey(sessionId, userId);
  const entry: WebVideoDateStartGateEntry = {
    sessionId,
    userId: userId ?? null,
    promise,
    startedAtMs: Date.now(),
    observeCount: 1,
  };
  webVideoDateStartGateEntries.set(key, entry);
  const clearEntry = () => {
    if (webVideoDateStartGateEntries.get(key) === entry) {
      webVideoDateStartGateEntries.delete(key);
    }
  };
  void promise.then(clearEntry, clearEntry);
  return entry;
}
