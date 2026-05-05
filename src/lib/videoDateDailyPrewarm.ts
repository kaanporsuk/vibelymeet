import DailyIframe, { type DailyCall } from "@daily-co/daily-js";
import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";
import { dailyVideoDateCallObjectOptions } from "@/lib/dailyCallObjectConfig";
import { vdbg } from "@/lib/vdbg";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import type { VideoDateMediaCaptureProfile } from "@clientShared/matching/videoDateMediaContract";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
  type ReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";

const WEB_DAILY_PREWARM_TTL_MS = 45_000;
const WEB_DAILY_PREWARM_PREAUTH_NAV_WAIT_MS = 250;

type WebDailyPrewarmStatus =
  | "starting"
  | "camera_ready"
  | "preauth_ready"
  | "consumed"
  | "fallback"
  | "destroyed";

type WebDailyPrewarmEntry = {
  key: string;
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  captureProfile: VideoDateMediaCaptureProfile;
  call: DailyCall;
  createdAtMs: number;
  expiresAtMs: number;
  status: WebDailyPrewarmStatus;
  cameraPromise: Promise<void>;
  preAuthPromise: Promise<boolean> | null;
  destroyTimer: number | null;
};

type WebDailyPrewarmPublicEntry = {
  call: DailyCall;
  roomName: string;
  roomUrl: string;
  captureProfile: VideoDateMediaCaptureProfile;
  createdAtMs: number;
};

type WebDailyPrewarmConsumeResult =
  | { ok: true; entry: WebDailyPrewarmPublicEntry }
  | { ok: false; reason: string };

const prewarmEntries = new Map<string, WebDailyPrewarmEntry>();

function prewarmEnabled(): boolean {
  return String(import.meta.env.VITE_VIDEO_DATE_DAILY_PREWARM ?? "false").toLowerCase() === "true";
}

function keyFor(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
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

function destroyEntry(entry: WebDailyPrewarmEntry, reason: string, outcome: "success" | "failure" = "success") {
  if (entry.destroyTimer) {
    window.clearTimeout(entry.destroyTimer);
    entry.destroyTimer = null;
  }
  prewarmEntries.delete(entry.key);
  if (entry.status !== "consumed") {
    try {
      entry.call.destroy();
    } catch (error) {
      Sentry.addBreadcrumb({
        category: "video-date",
        level: "warning",
        message: "web_daily_prewarm_destroy_failed",
        data: { sessionId: entry.sessionId, reason, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  entry.status = reason === "consumed" ? "consumed" : "destroyed";
  checkpoint({
    sessionId: entry.sessionId,
    userId: entry.userId,
    eventId: entry.eventId,
    checkpoint: reason === "consumed" ? "daily_prewarm_consumed" : "daily_prewarm_destroyed",
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

function fallbackEntry(entry: WebDailyPrewarmEntry, reason: string, reasonCode: string = reason) {
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

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
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

export function startWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  captureProfile?: VideoDateMediaCaptureProfile;
  source: string;
}): WebDailyPrewarmConsumeResult {
  if (!prewarmEnabled()) return { ok: false, reason: "flag_disabled" };
  if (typeof window === "undefined") return { ok: false, reason: "window_unavailable" };
  const key = keyFor(params.sessionId, params.userId);
  const existing = prewarmEntries.get(key);
  if (existing) {
    if (existing.expiresAtMs > Date.now()) {
      if (existing.roomUrl === params.roomUrl) return { ok: true, entry: existing };
      fallbackEntry(existing, "daily_prewarm_room_changed");
    } else {
      fallbackEntry(existing, "daily_prewarm_expired_before_restart");
    }
  }

  const captureProfile = params.captureProfile ?? "ideal";
  const call = DailyIframe.createCallObject(dailyVideoDateCallObjectOptions(captureProfile));
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
  });

  entry.cameraPromise = Promise.resolve(call.startCamera({ url: params.roomUrl })).then(
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

  return { ok: true, entry };
}

export async function preAuthWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomUrl: string;
  token: string;
  source: string;
  waitMs?: number;
}): Promise<boolean> {
  if (!prewarmEnabled()) return false;
  const entry = prewarmEntries.get(keyFor(params.sessionId, params.userId));
  if (!entry || entry.roomUrl !== params.roomUrl || entry.status === "destroyed" || entry.status === "fallback") {
    return false;
  }
  if (typeof entry.call.preAuth !== "function") {
    return false;
  }
  entry.preAuthPromise = Promise.resolve(entry.call.preAuth({ url: params.roomUrl, token: params.token })).then(
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
  return (await waitWithTimeout(entry.preAuthPromise, params.waitMs ?? WEB_DAILY_PREWARM_PREAUTH_NAV_WAIT_MS)) ?? true;
}

export function consumeWebVideoDateDailyPrewarm(params: {
  sessionId: string;
  userId: string;
  eventId: string | null;
  roomName: string;
  roomUrl: string;
  captureProfile: VideoDateMediaCaptureProfile;
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
  if (entry.status === "fallback" || entry.status === "destroyed") {
    fallbackEntry(entry, "daily_prewarm_not_usable");
    return { ok: false, reason: "not_usable" };
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
  return { ok: true, entry };
}

export function destroyWebVideoDateDailyPrewarm(sessionId: string, userId: string, reason: string): boolean {
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
