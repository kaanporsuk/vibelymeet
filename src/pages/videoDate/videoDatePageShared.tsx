import { toast } from "sonner";
import { Clock } from "lucide-react";
import { vdbg } from "@/lib/vdbg";
import type { VideoCallStartFailure } from "@/hooks/useVideoCall";
import { buildVideoDateMutualExtensionIdempotencyKey } from "@clientShared/matching/videoDateTransitionCommands";
import { videoSessionHasPostDateSurveyTruth } from "@clientShared/matching/activeSession";
import type { VideoDateWarmupChoiceNotice } from "@clientShared/matching/videoDateWarmupChoiceNotice";

/**
 * Module-scope helpers, constants, and types for the web Video Date page,
 * extracted verbatim from src/pages/VideoDate.tsx (Video Date rebuild PR 7).
 * No component logic lives here.
 */

export const ENTRY_TIME = 60;
export const DATE_TIME = 300;
export const MIN_DECISION_WINDOW_AFTER_REMOTE_FRAME_MS = 15_000;

export function isoFromTimelineMs(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}
export const WEB_LIFECYCLE_AWAY_GRACE_MS = 12_000;
export const VIDEO_DATE_ACCESS_LOADING_WATCHDOG_MS = 8_000;
export const VIDEO_DATE_MANUAL_EXIT_CLEANUP_TIMEOUT_MS = 2_500;
export const DUPLICATE_TAB_CONFLICT_STABLE_MS = 2_500;
export const TERMINAL_SURVEY_RECONCILE_INTERVAL_MS = 2_500;
export const TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS = [0, 350, 900, 1_600] as const;
export const VIDEO_DATE_START_AUTO_RETRY_DELAYS_MS = [
  1_200, 2_400, 4_000, 6_000,
] as const;
export const REMOTE_DATE_VIDEO_CONTAINER_CLASS = "flex-1 relative bg-black";
// Product invariant: remote date video preserves the full encoded camera frame.
// Do not switch this to cover/scale/transform; use a separate decorative layer for cinematic crops.
export const REMOTE_DATE_VIDEO_CLASS = "w-full h-full object-contain object-center";

export type VideoDateEndReason =
  | "ended_from_client"
  | "partial_join_peer_timeout"
  | "partner_absent_after_confirmed_encounter"
  | "date_timeout";
export type VideoDateManualExitStepStatus = "completed" | "failed" | "timed_out";

export type WebLifecycleLeaveSource =
  | "beforeunload"
  | "pagehide"
  | "visibilitychange"
  | "freeze";
export const WEB_SOFT_LIFECYCLE_LEAVE_SOURCES = new Set<WebLifecycleLeaveSource>([
  "beforeunload",
  "pagehide",
  "visibilitychange",
  "freeze",
]);

export function waitForVideoDateRuntimeRecovery(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function normalizedDateExtraSeconds(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : 0;
}

export function makeMutualExtensionIdempotencyKey(
  sessionId: string,
  type: "extra_time" | "extended_vibe",
): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return buildVideoDateMutualExtensionIdempotencyKey(sessionId, type, random);
}

export function serializeManualExitError(
  error: unknown,
): Record<string, unknown> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : String(error);
}

export function showWarmupChoiceNoticeToast(notice: VideoDateWarmupChoiceNotice) {
  toast.custom(
    () => (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-[min(calc(100vw-2rem),28rem)] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(180deg,hsl(var(--card)/0.94),hsl(var(--background)/0.9))] text-foreground shadow-[0_20px_65px_-36px_rgba(0,0,0,0.95),0_0_34px_-24px_hsl(var(--primary)/0.9)] backdrop-blur-2xl"
      >
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span className="mt-0.5 h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-primary via-accent to-neon-cyan" />
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/15 text-neon-cyan shadow-[0_0_20px_-8px_hsl(var(--primary)/0.9)]">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-display font-semibold leading-snug text-foreground">
              {notice.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {notice.message}
            </span>
          </span>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>
    ),
    {
      duration: 5200,
      position: "top-center",
      unstyled: true,
    },
  );
}

export function runVideoDateManualExitStep(
  step: string,
  operation: () => Promise<unknown>,
  timeoutMs = VIDEO_DATE_MANUAL_EXIT_CLEANUP_TIMEOUT_MS,
): Promise<{ status: VideoDateManualExitStepStatus; error?: unknown }> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      vdbg("video_date_manual_exit_step", {
        step,
        status: "timed_out",
        timeoutMs,
      });
      resolve({ status: "timed_out" });
    }, timeoutMs);

    void operation().then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        vdbg("video_date_manual_exit_step", {
          step,
          status: "completed",
          timeoutMs,
        });
        resolve({ status: "completed" });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        vdbg("video_date_manual_exit_step", {
          step,
          status: "failed",
          timeoutMs,
          error: serializeManualExitError(error),
        });
        resolve({ status: "failed", error });
      },
    );
  });
}

export type VideoDateAccess = "loading" | "allowed" | "denied" | "not_found";

export function messageForEntryFailure(code?: string): string {
  if (code === "READY_GATE_NOT_READY") {
    return "Almost there — finish the Ready Gate with your match first.";
  }
  if (code === "BLOCKED_PAIR") {
    return "This call is no longer available.";
  }
  if (code === "SESSION_ENDED") {
    return "This date has already ended.";
  }
  if (code === "EVENT_NOT_ACTIVE") {
    return "This date link is no longer available.";
  }
  if (code === "DAILY_AUTH_FAILED" || code === "DAILY_CREDENTIALS_INVALID") {
    return "Video provider authentication failed. Please try again later.";
  }
  if (code === "DAILY_REQUEST_REJECTED") {
    return "Could not prepare this video room. Go back and try again.";
  }
  return "Could not start your video date. Go back and try again.";
}

export function messageForRetryableStartFailure(
  failure: VideoCallStartFailure | null,
): string {
  if (!failure)
    return "We’re still connecting your video date. Please try again.";
  if (failure.kind === "network")
    return "Your connection dropped while starting the date. Try again.";
  if (failure.kind === "DAILY_PROVIDER_ERROR") {
    return "The video service is still spinning up. Try again in a moment.";
  }
  if (
    failure.kind === "DAILY_PROVIDER_UNAVAILABLE" ||
    failure.kind === "DAILY_RATE_LIMIT"
  ) {
    return "The video service is still spinning up. Try again in a moment.";
  }
  if (failure.kind === "daily_join_failed") {
    return "We couldn’t finish joining the video room. Try again.";
  }
  if (failure.kind === "daily_call_busy") {
    return "We’re closing the previous video connection. Try again in a moment.";
  }
  if (failure.kind === "start_call_in_flight_failed") {
    return "The previous join attempt did not finish. Try joining again.";
  }
  return "We’re still connecting your video date. Please try again.";
}

export interface PartnerData {
  name: string;
  age: number;
  tags: string[];
  avatarUrl?: string;
  photos?: string[];
  about_me?: string;
  job?: string;
  location?: string;
  heightCm?: number;
  prompts?: { question: string; answer: string }[];
}

export type CallPhase = "entry" | "date" | "ended";
export type CompleteEntryPayload = {
  success?: boolean;
  state?: "date" | "ended" | "entry";
  code?: string | null;
  retryable?: boolean;
  waiting_for_partner?: boolean;
  waiting_for_self?: boolean;
  local_decision_persisted?: boolean;
  partner_decision_persisted?: boolean;
  grace_expires_at?: string;
  seconds_remaining?: number;
  extended?: boolean;
  extension_started_at?: string | null;
  already_ended?: boolean;
  reason?: string | null;
  survey_required?: boolean;
};

export type TerminalSurveySessionRow = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  event_id?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  state?: string | null;
  phase?: string | null;
  entry_started_at?: string | null;
  date_started_at?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | number | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
};

export type TerminalSurveyRegistrationFallbackRow = {
  event_id?: string | null;
  queue_status?: string | null;
  current_room_id?: string | null;
  current_partner_id?: string | null;
  last_active_at?: string | null;
};

export const TERMINAL_SURVEY_SESSION_SELECT =
  "participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, entry_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at";

export const TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT =
  "event_id, queue_status, current_room_id, current_partner_id, last_active_at";

export function videoDateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[VideoDate] ${message}`, data ?? {});
}

export function summarizeWebVideoDateRuntime() {
  if (typeof navigator === "undefined") {
    return {
      browser_family: "unknown",
      is_ios: false,
      is_mobile_safari: false,
      is_safari: false,
    };
  }
  const ua = navigator.userAgent ?? "";
  const vendor = navigator.vendor ?? "";
  const isIOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isSafari =
    /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
  const browserFamily = /CriOS|Chrome|Chromium/i.test(ua)
    ? "chrome"
    : /FxiOS|Firefox/i.test(ua)
      ? "firefox"
      : /Edg/i.test(ua)
        ? "edge"
        : isSafari || /Apple/i.test(vendor)
          ? "safari"
          : "unknown";
  return {
    browser_family: browserFamily,
    is_ios: isIOS,
    is_mobile_safari: isIOS && isSafari,
    is_safari: isSafari,
  };
}

export function videoSessionIndicatesTerminalEnd(
  row: {
    ended_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
): boolean {
  if (!row) return false;
  return Boolean(
    row.ended_at || row.state === "ended" || row.phase === "ended",
  );
}

export function shouldOpenPostDateSurveyForTerminalSession(
  row: {
    ended_at?: string | null;
    ended_reason?: string | null;
    date_started_at?: string | null;
    participant_1_joined_at?: string | null;
    participant_2_joined_at?: string | null;
    participant_1_remote_seen_at?: string | null;
    participant_2_remote_seen_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
  verdict: unknown,
): boolean {
  return videoSessionHasPostDateSurveyTruth(row) && !verdict;
}
