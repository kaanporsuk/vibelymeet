/**
 * Module-scope helpers, constants, and types shared by the native Video Date
 * screen family. Extracted verbatim from `app/date/[id].tsx` (VD rebuild PR 8).
 */
import * as Sentry from "@sentry/react-native";
import { Dimensions, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/Colors";
import { sanitizeNativeDiagnosticRecord } from "@/lib/nativeDiagnosticsPayload";
import {
  fetchVideoSessionDateEntryTruth,
  type GetDailyRoomTokenResult,
  type RoomTokenFailureCode,
  type VideoSessionDateEntryTruth,
} from "@/lib/videoDateApi";
import { adviseVideoSessionTruthRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  getVideoSessionPartnerIdForUser,
  videoSessionHasPostDateSurveyTruth,
} from "@clientShared/matching/activeSession";
import { buildVideoDateMutualExtensionIdempotencyKey } from "@clientShared/matching/videoDateTransitionCommands";
import type { VideoDateWarmupChoiceNotice } from "@clientShared/matching/videoDateWarmupChoiceNotice";
import { styles } from "@/lib/videoDate/videoDateScreenStyles";

export const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
export const FIRST_CONNECT_TIMEOUT_MS = 25000;
export const PREJOIN_STEP_TIMEOUT_MS = 12000;
export const NATIVE_BACKGROUND_GRACE_MS = 12_000;
export const NATIVE_VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS = 3_000;
export const NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000;
export const NATIVE_BACKGROUND_GRACE_SECONDS = Math.ceil(
  NATIVE_BACKGROUND_GRACE_MS / 1000,
);
export const NATIVE_BACKGROUND_RECOVERED_BANNER_MS = 2_500;
export const NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS = [
  0, 350, 900, 1_600,
] as const;
export const ICE_BREAKER_CLOCK_TICK_MS = 1_000;
export const DATE_CONTROLS_STACK_HEIGHT = 104;
export const DATE_PHASE_ICE_BREAKER_MIN_BOTTOM = 148;
export const ENTRY_CTA_STACK_HEIGHT = 92;
export const ENTRY_CTA_DOCK_TIGHTEN_OFFSET = 24;
export const FLOATING_CHROME_GAP = 10;

export const REMOTE_SEEN_RPC_MAX_ATTEMPTS = 3;
export const REMOTE_SEEN_RPC_RETRY_DELAY_MS = 1_500;
export const REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS = 10_000;

// Minimum time (ms) the Vibe/Pass CTA must be visible after first playable remote
// media before the server deadline is allowed to call completeEntry.
// Prevents expiry on slow Daily join where media arrives just before the 60 s mark.
export const MIN_DECISION_WINDOW_AFTER_MEDIA_MS = 15_000;

export function sleepNativeRuntimeRecovery(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export type DateTheme = (typeof Colors)[keyof typeof Colors];

export type EntryCtaTelemetrySnapshot = {
  cta_visible: boolean;
  cta_visible_ms: number;
  cta_last_time_left: number | null;
  has_remote_partner: boolean;
  peer_server_joined: boolean;
  partner_ever_joined: boolean;
  is_partner_disconnected: boolean;
  peer_missing_terminal: boolean;
  remote_video_mounted: boolean;
  remote_audio_mounted: boolean;
  first_playable_remote_seen: boolean;
  first_playable_remote_age_ms: number | null;
  local_decision: "vibe" | "pass" | "none";
};

export function WarmupChoiceNoticeBanner({
  notice,
  theme,
  top,
}: {
  notice: VideoDateWarmupChoiceNotice;
  theme: DateTheme;
  top: number;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.warmupChoiceNotice,
        {
          top,
          borderColor: "rgba(139,92,246,0.32)",
          backgroundColor: "rgba(20,20,24,0.93)",
        },
      ]}
    >
      <View
        style={[styles.warmupChoiceNoticeRail, { backgroundColor: theme.tint }]}
      />
      <View style={styles.warmupChoiceNoticeIcon}>
        <Ionicons name="time-outline" size={18} color={theme.neonCyan} />
      </View>
      <View style={styles.warmupChoiceNoticeCopy}>
        <Text
          style={[styles.warmupChoiceNoticeTitle, { color: theme.text }]}
          numberOfLines={2}
        >
          {notice.title}
        </Text>
        <Text
          style={[
            styles.warmupChoiceNoticeMessage,
            { color: theme.mutedForeground },
          ]}
        >
          {notice.message}
        </Text>
      </View>
    </View>
  );
}

/** Post-join UX / instrumentation — single stage truth for Daily + peer presence (not server phase). */
export type VideoDatePostJoinStage =
  | "initial_loading"
  | "joining_daily"
  | "waiting_for_peer"
  | "active_call"
  | "reconnecting"
  | "peer_missing_timeout"
  | "fatal_join_error"
  | "ended";

export type DailyTokenRefreshSourceAction =
  | "daily_token_refresh_before_join"
  | "daily_token_refresh_join_retry"
  | "daily_token_refresh_before_expiry"
  | "daily_token_refresh_after_ejection"
  | "daily_token_refresh_after_auth_error";

export type DailyTokenRefreshFailureState = {
  kind: "terminal" | "rate_limited" | "retryable";
  error: string;
  retryAfterMs: number | null;
  phase: string | null;
};

export function networkTierFromDailyEvent(
  ev: { threshold?: string; quality?: number } | undefined,
): "good" | "fair" | "poor" {
  const q = typeof ev?.quality === "number" ? ev.quality : 100;
  const th = ev?.threshold;
  if (th === "low" || q < 30) return "poor";
  if (q < 70) return "fair";
  return "good";
}

export function userMessageForTokenFailure(code: RoomTokenFailureCode): string {
  switch (code) {
    case "auth":
      return "Please sign in again, then try once more.";
    case "READY_GATE_NOT_READY":
      return "Almost there — finish the Ready Gate with your match first.";
    case "SESSION_ENDED":
      return "This date has already ended.";
    case "EVENT_NOT_ACTIVE":
      return "This date link is no longer available.";
    case "SESSION_NOT_FOUND":
    case "ROOM_NOT_FOUND":
      return "We couldn't open this date. Go back and try again.";
    case "DAILY_AUTH_FAILED":
    case "DAILY_CREDENTIALS_INVALID":
      return "Video provider authentication failed. Please try again later.";
    case "DAILY_REQUEST_REJECTED":
      return "We couldn't prepare this video room. Please try again.";
    case "BLOCKED_PAIR":
      return "This call is no longer available.";
    case "ACCESS_DENIED":
      return "You don't have access to this date.";
    case "network":
    case "DAILY_PROVIDER_ERROR":
    case "DAILY_PROVIDER_UNAVAILABLE":
    case "DAILY_RATE_LIMIT":
    default:
      return "Could not start video. Please try again.";
  }
}

/** Backoffs (ms) for bounded refetch loops on `READY_GATE_NOT_READY` — short enough that user
 *  perceives no extra latency, long enough to absorb cross-region replica lag. Two retries by
 *  design: longer windows are better handled by `recoverFromNotStartableDateTruth` redirecting. */
export const READY_GATE_RACE_RETRY_BACKOFFS_MS = [220, 320];
export const NATIVE_PREPARE_DATE_ENTRY_RETRY_DELAYS_MS = [700, 1600] as const;
export const NATIVE_PREPARE_DATE_ENTRY_RETRY_AFTER_MAX_MS = 30_000;

export function dailyRoomTokenRetryDelayMs(
  result: Extract<GetDailyRoomTokenResult, { ok: false }>,
  fallbackMs: number,
): number {
  const retryAfterMs =
    typeof result.retryAfterMs === "number" &&
    Number.isFinite(result.retryAfterMs) &&
    result.retryAfterMs > 0
      ? Math.ceil(result.retryAfterMs)
      : typeof result.retryAfterSeconds === "number" &&
          Number.isFinite(result.retryAfterSeconds) &&
          result.retryAfterSeconds > 0
        ? Math.ceil(result.retryAfterSeconds * 1000)
        : null;
  return Math.min(
    Math.max(1, retryAfterMs ?? fallbackMs),
    NATIVE_PREPARE_DATE_ENTRY_RETRY_AFTER_MAX_MS,
  );
}

/**
 * Refetch backend truth and check whether the session is now Daily-startable. Used by the prejoin
 * `READY_GATE_NOT_READY` retry loops — does not call any RPC, just a coalesced read.
 */
export async function refetchTruthAndCheckStartable(sessionId: string): Promise<{
  startable: boolean;
  truth: Awaited<ReturnType<typeof fetchVideoSessionDateEntryTruth>>;
}> {
  const truth = await fetchVideoSessionDateEntryTruth(sessionId);
  const recovery = adviseVideoSessionTruthRecovery({
    sessionId,
    truth,
    platform: "native",
    surface: "video_date",
  });
  return {
    startable: recovery.action === "go_date",
    truth,
  };
}

export function videoDateDailyDiagnostic(
  message: string,
  data: Record<string, unknown>,
) {
  const safeData = sanitizeNativeDiagnosticRecord(data);
  Sentry.addBreadcrumb({
    category: "video-date-daily",
    message,
    level: "info",
    data: safeData as Record<string, unknown> | undefined,
  });
}

/** Same keys as {@link videoDateDailyDiagnostic}; use where room name is only on refs (e.g. AppState). */
export function videoDateSessionDiagnostic(
  message: string,
  data: Record<string, unknown>,
) {
  const safeData = sanitizeNativeDiagnosticRecord(data);
  Sentry.addBreadcrumb({
    category: "video-date-session",
    message,
    level: "info",
    data: safeData as Record<string, unknown> | undefined,
  });
}

export function addVideoDateBreadcrumb(
  message: string,
  level: "info" | "warning" | "error",
  data?: Record<string, unknown>,
) {
  const safeData = sanitizeNativeDiagnosticRecord(data);
  Sentry.addBreadcrumb({
    category: "video-date",
    message,
    level,
    data: safeData as Record<string, unknown> | undefined,
  });
}

export function shouldRecoverPendingPostDateSurvey(
  session: {
    participant_1_id?: string | null;
    participant_2_id?: string | null;
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
  userId: string,
  verdict: unknown,
): boolean {
  if (verdict) return false;
  if (!getVideoSessionPartnerIdForUser(session, userId)) return false;
  return videoSessionHasPostDateSurveyTruth(session);
}

export function nativeVideoSessionIndicatesTerminalEnd(
  session: {
    ended_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
): boolean {
  return Boolean(
    session &&
    (session.ended_at ||
      session.state === "ended" ||
      session.phase === "ended"),
  );
}

export function shouldTerminalizeNativePeerMissingAbort(
  truth: VideoSessionDateEntryTruth | null | undefined,
): boolean {
  if (!truth) return false;
  if (
    truth.ended_at ||
    truth.date_started_at ||
    truth.state === "ended" ||
    truth.phase === "ended"
  )
    return false;
  if (truth.state === "date" || truth.phase === "date") return false;
  return (
    Boolean(truth.participant_1_joined_at) !==
    Boolean(truth.participant_2_joined_at)
  );
}

export type NativeTerminalSurveySessionRow = {
  id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  event_id?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  date_started_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
  state?: string | null;
  phase?: string | null;
};

export type NativeVideoDateEndReason =
  | "ended_from_client"
  | "partner_absent_after_confirmed_encounter"
  | "date_timeout";

export type NativeTerminalSurveyRegistrationFallbackRow = {
  event_id?: string | null;
  queue_status?: string | null;
  current_room_id?: string | null;
  current_partner_id?: string | null;
  last_active_at?: string | null;
};

export const NATIVE_TERMINAL_SURVEY_SESSION_SELECT =
  "id, participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, date_started_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, state, phase";
// Survey-required terminal recovery intentionally uses this smaller projection
// instead of the hot date-route session row owner.

export const NATIVE_TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT =
  "event_id, queue_status, current_room_id, current_partner_id, last_active_at";

