import { useCallback, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildLobbySwipeResultPayload,
  EventLobbyObservabilityEvents,
  getSwipeNotificationSuppressionReason,
  isDuplicateSwipeResult,
} from "@clientShared/observability/eventLobbyObservability";
import {
  bucketVideoDateLatencyMs,
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  getSwipeFailureUserMessage,
  type SwipeSessionStageResult,
  SWIPE_SESSION_CONFLICT_USER_MESSAGE,
  shouldOpenReadyGateFromSwipePayload,
  shouldTrackQueuedSwipeSession,
  videoSessionIdFromSwipePayload,
} from "@shared/matching/videoSessionFlow";
import {
  AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS,
  applyManagedAuthRefreshSession,
  isNewerAuthRefreshSession,
  requestManagedAuthRefresh,
} from "@clientShared/authRefreshPolicy";
import { getVideoDateSwipeRateLimitRetryUntilMs } from "@clientShared/matching/videoDateDeckPrefetch";

type SwipeType = "vibe" | "pass" | "super_vibe";

const SWIPE_AUTH_REFRESH_WINDOW_MS = 60_000;
const SWIPE_AUTH_EXPIRED_SKEW_MS = 5_000;

function sessionExpiresAtMs(session: Session | null | undefined): number | null {
  return typeof session?.expires_at === "number" ? session.expires_at * 1000 : null;
}

function isSessionExpiredForSwipe(session: Session | null | undefined): boolean {
  const expiresAtMs = sessionExpiresAtMs(session);
  return expiresAtMs != null && expiresAtMs <= Date.now() + SWIPE_AUTH_EXPIRED_SKEW_MS;
}

function shouldRefreshSessionForSwipe(session: Session | null | undefined): boolean {
  const expiresAtMs = sessionExpiresAtMs(session);
  return expiresAtMs != null && expiresAtMs <= Date.now() + SWIPE_AUTH_REFRESH_WINDOW_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unauthorizedSwipeResult(): SwipeSessionStageResult {
  return {
    success: false,
    result: "unauthorized",
    outcome: "unauthorized",
    error: "unauthorized",
    message: "Sign in again to keep swiping.",
    notification_suppressed: true,
  };
}

async function recoverSwipeRefreshRace(attemptedSession: Session): Promise<Session | null> {
  for (const delayMs of AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (isNewerAuthRefreshSession(data.session, attemptedSession)) {
      return data.session;
    }
  }
  return null;
}

async function resolveWebSwipeAccessToken(preferredSession: Session | null): Promise<string | null> {
  let activeSession = preferredSession;

  if (!activeSession?.access_token) {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    activeSession = data.session;
  }

  if (!activeSession?.access_token) return null;

  if (shouldRefreshSessionForSwipe(activeSession)) {
    try {
      const refreshResponse = await requestManagedAuthRefresh({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        refreshToken: activeSession.refresh_token,
      });
      activeSession = await applyManagedAuthRefreshSession(supabase.auth, activeSession, refreshResponse) ?? activeSession;
    } catch {
      const recoveredSession = await recoverSwipeRefreshRace(activeSession);
      if (recoveredSession?.access_token) {
        activeSession = recoveredSession;
      } else if (isSessionExpiredForSwipe(activeSession)) {
        return null;
      }
    }
    if (isSessionExpiredForSwipe(activeSession)) {
      return null;
    }
  }

  return isSessionExpiredForSwipe(activeSession) ? null : activeSession.access_token;
}

async function postSwipeAction(
  accessToken: string,
  eventId: string,
  targetId: string,
  swipeType: SwipeType,
  deckToken?: string | null,
): Promise<{ data: SwipeSessionStageResult | null; error: Error | null }> {
  const swipeActionsUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/swipe-actions`;
  let response: Response;
  try {
    response = await fetch(swipeActionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        event_id: eventId,
        target_id: targetId,
        swipe_type: swipeType,
        deck_token: deckToken ?? null,
      }),
    });
  } catch (cause) {
    return {
      data: null,
      error: cause instanceof Error ? cause : new Error("swipe-actions network request failed"),
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      return { data: unauthorizedSwipeResult(), error: null };
    }
    if (response.status === 429) {
      const nowMs = Date.now();
      const retryUntilMs = getVideoDateSwipeRateLimitRetryUntilMs(
        payload && typeof payload === "object" ? payload as SwipeSessionStageResult : { result: "rate_limited" },
        nowMs,
        response.headers.get("Retry-After"),
      );
      const retryAfterSeconds =
        retryUntilMs == null ? undefined : Math.max(1, Math.ceil((retryUntilMs - nowMs) / 1000));
      return {
        data: {
          success: false,
          result: "rate_limited",
          outcome: "rate_limited",
          error: "rate_limited",
          message: "Catch your breath before swiping again.",
          retry_after_seconds: retryAfterSeconds,
          notification_suppressed: true,
        },
        error: null,
      };
    }
    return {
      data: null,
      error: new Error(`swipe-actions returned HTTP ${response.status}`),
    };
  }

  if (!payload || typeof payload !== "object") {
    return { data: null, error: new Error("swipe-actions returned an invalid response") };
  }

  return { data: payload as SwipeSessionStageResult, error: null };
}

interface UseSwipeActionOptions {
  eventId: string;
  /**
   * Mutual vibe opened ready gate immediately (`video_sessions.id`).
   * @deprecated Prefer `onVideoSessionReady` — same callback shape.
   */
  onMatch?: (videoSessionId: string) => void;
  /** Same as `onMatch`; honest name for session-stage id. */
  onVideoSessionReady?: (videoSessionId: string) => void;
  /**
   * Queued session created (`video_sessions.id`); partner will enter lobby when free.
   * @deprecated Prefer `onVideoSessionQueued`
   */
  onMatchQueued?: (videoSessionId: string) => void;
  onVideoSessionQueued?: (videoSessionId: string) => void;
  canAttemptPairing?: boolean;
  readinessBlockMessage?: string | null;
}

/**
 * Event deck swipes via `swipe-actions` → `handle_swipe_v2`.
 * Expected `result` values include match, match_queued, vibe_recorded, super_vibe_sent,
 * limit_reached, already_super_vibed_recently, already_matched, already_swiped, blocked, reported, pass_recorded, etc.
 * Legacy `no_credits` is not returned by current swipe RPCs (super vibe uses per-event limits only).
 */
export const useSwipeAction = ({
  eventId,
  onMatch,
  onVideoSessionReady,
  onMatchQueued,
  onVideoSessionQueued,
  canAttemptPairing = true,
  readinessBlockMessage,
}: UseSwipeActionOptions) => {
  const { user } = useUserProfile();
  const { session } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const swipe = useCallback(
    async (targetId: string, swipeType: SwipeType, deckToken?: string | null): Promise<SwipeSessionStageResult | null> => {
      if (!user?.id || !eventId) return null;
      if (!navigator.onLine) {
        toast.error("You're offline — swipes need a connection");
        return null;
      }
      if (swipeType !== "pass" && !canAttemptPairing) {
        toast.info(readinessBlockMessage ?? "Camera and microphone access are needed before you can pair.", {
          duration: 4200,
        });
        return null;
      }

      setIsProcessing(true);
      const swipeStartedAtMs = Date.now();
      try {
        trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_SUBMITTED, {
          event_id: eventId,
          platform: "web",
          swipe_type: swipeType,
        });
        Sentry.addBreadcrumb({
          category: "event-lobby",
          message: "lobby_swipe_submitted",
          level: "info",
          data: { event_id: eventId, swipe_type: swipeType },
        });
        const accessToken = await resolveWebSwipeAccessToken(session);
        const { data, error } = accessToken
          ? await postSwipeAction(accessToken, eventId, targetId, swipeType, deckToken)
          : { data: unauthorizedSwipeResult(), error: null };

        if (error) {
          console.error("Swipe error:", error);
          trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, {
            ...buildLobbySwipeResultPayload({
              eventId,
              platform: "web",
              swipeType,
              result: { result: "invoke_error", reason: "network_error", notification_suppressed: true },
            }),
          });
          Sentry.addBreadcrumb({
            category: "event-lobby",
            message: "lobby_swipe_error",
            level: "warning",
            data: { event_id: eventId, swipe_type: swipeType, reason: "invoke_error" },
          });
          toast.error("Something went wrong. Try again.");
          return null;
        }

        const raw = data as SwipeSessionStageResult;
        if (raw && typeof raw === "object" && raw.success === false) {
          const failureCode = raw.result ?? raw.outcome ?? raw.error;
          const failureMessage = getSwipeFailureUserMessage(raw);
          trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, {
            ...buildLobbySwipeResultPayload({
              eventId,
              platform: "web",
              swipeType,
              result: raw,
            }),
          });
          if (failureCode === "rate_limited" || failureCode === "too_many_requests" || failureCode === "swipe_rate_limited") {
            toast.info(failureMessage, { duration: 2500 });
          } else if (
            failureCode === "participant_has_active_session_conflict" ||
            failureCode === "pair_already_met_this_event" ||
            failureCode === "target_unavailable" ||
            failureCode === "target_not_found" ||
            failureCode === "account_paused"
          ) {
            toast.info(failureMessage, { duration: 4200 });
          } else {
            toast.error(failureMessage);
          }
          return raw;
        }

        const outcome =
          raw.result === "swipe_recorded" ? "vibe_recorded" : raw.result;

        const lobbySwipeResultPayload = buildLobbySwipeResultPayload({
          eventId,
          platform: "web",
          swipeType,
          result: raw,
        });
        trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, lobbySwipeResultPayload);
        const suppressionReason = getSwipeNotificationSuppressionReason(raw);
        if (isDuplicateSwipeResult(raw)) {
          trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_DUPLICATE_SUPPRESSED, {
            event_id: eventId,
            platform: "web",
            swipe_type: swipeType,
            outcome: lobbySwipeResultPayload.outcome,
            reason: suppressionReason ?? "duplicate",
            notification_suppressed_reason: suppressionReason ?? "duplicate",
          });
        }
        Sentry.addBreadcrumb({
          category: "event-lobby",
          message: "lobby_swipe_result",
          level: "info",
          data: lobbySwipeResultPayload,
        });

        trackEvent("swipe", {
          event_id: eventId,
          swipe_type: swipeType,
          result: outcome,
        });
        const sessionId = videoSessionIdFromSwipePayload(raw);
        const opensReadyGate = shouldOpenReadyGateFromSwipePayload(raw);
        const swipeResultDurationMs = Math.max(0, Date.now() - swipeStartedAtMs);
        if (sessionId && opensReadyGate) {
          const swipeResultContext = recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "web",
            eventId,
            sourceSurface: "event_lobby",
            checkpoint: "swipe_result",
          });
          trackEvent(
            LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
            buildReadyGateToDateLatencyPayload({
              context: swipeResultContext,
              checkpoint: "swipe_result",
              sourceAction: "swipe_result",
              outcome: "success",
              durationMs: swipeResultDurationMs,
              extra: {
                swipe_result_ms: swipeResultDurationMs,
              },
            }),
          );
        }
        const conflictDetected =
          outcome === "already_matched" || outcome === "participant_has_active_session_conflict";
        const recoveryStartedAtMs = conflictDetected ? Date.now() : null;
        if (conflictDetected) {
          if (outcome === "participant_has_active_session_conflict") {
            trackEvent(LobbyPostDateEvents.DUPLICATE_ACTIVE_SESSION_CONFLICT, {
              platform: "web",
              event_id: eventId,
              session_id: sessionId ?? null,
              source_surface: "event_lobby",
              source_action: "swipe_result",
              reason_code: outcome,
              outcome: sessionId ? "blocked" : "failure",
            });
          }
          trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_CONFLICT_DETECTED, {
            platform: "web",
            event_id: eventId,
            session_id: sessionId ?? null,
            source_surface: "event_lobby",
            source_action: "swipe_result",
            reason_code: outcome,
            outcome: sessionId ? "blocked" : "failure",
          });
          if (sessionId && opensReadyGate) {
            trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_RECOVERY_ATTEMPTED, {
              platform: "web",
              event_id: eventId,
              session_id: sessionId,
              source_surface: "event_lobby",
              source_action: "open_existing_ready_gate_from_swipe",
              reason_code: outcome,
              attempt_count: 1,
              outcome: "no_op",
            });
          } else {
            const recoveryDurationMs =
              recoveryStartedAtMs == null ? null : Math.max(0, Date.now() - recoveryStartedAtMs);
            trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_RECOVERY_FAILED, {
              platform: "web",
              event_id: eventId,
              session_id: sessionId ?? null,
              source_surface: "event_lobby",
              source_action: "swipe_result_no_recoverable_session",
              reason_code: outcome,
              attempt_count: 1,
              duration_ms: recoveryDurationMs,
              latency_bucket: bucketVideoDateLatencyMs(recoveryDurationMs),
              outcome: "failure",
            });
          }
        }

        switch (raw.result) {
          case "match":
            Sentry.addBreadcrumb({
              category: "matching",
              message: "Mutual vibe — video session / ready gate created",
              level: "info",
            });
            if (raw.immediate && sessionId) {
              toast.success("Mutual Vibe! Opening Ready Gate…", { duration: 2800 });
              onVideoSessionReady?.(sessionId);
              onMatch?.(sessionId);
            } else {
              toast.success("It's a match! Ready Gate will open in a moment.", { duration: 2800 });
            }
            return raw;

          case "match_queued":
            toast.success(
              "You're matched! We'll bring you to Ready Gate when your partner is free — keep browsing.",
              { duration: 4000 }
            );
            if (shouldTrackQueuedSwipeSession(raw) && sessionId) {
              onVideoSessionQueued?.(sessionId);
              onMatchQueued?.(sessionId);
            }
            return raw;

          case "super_vibe_sent":
            toast("Super Vibe sent! ✨", { duration: 2000 });
            return raw;

          case "limit_reached":
            toast("You've used all 3 Super Vibes for this event.", { duration: 2500 });
            return raw;

          case "already_super_vibed_recently":
            toast("You've already sent them a Super Vibe recently.", { duration: 2500 });
            return raw;

          case "already_matched":
            if (opensReadyGate && sessionId) {
              toast.success("Ready Gate is open. Taking you back to this match attempt.", {
                duration: 2800,
              });
              const recoveryDurationMs =
                recoveryStartedAtMs == null ? null : Math.max(0, Date.now() - recoveryStartedAtMs);
              onVideoSessionReady?.(sessionId);
              onMatch?.(sessionId);
              trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_RECOVERY_SUCCEEDED, {
                platform: "web",
                event_id: eventId,
                session_id: sessionId,
                source_surface: "event_lobby",
                source_action: "open_existing_ready_gate_from_swipe",
                reason_code: "already_matched",
                attempt_count: 1,
                duration_ms: recoveryDurationMs,
                latency_bucket: bucketVideoDateLatencyMs(recoveryDurationMs),
                outcome: "success",
              });
            }
            return raw;

          case "participant_has_active_session_conflict":
            toast.info(SWIPE_SESSION_CONFLICT_USER_MESSAGE, { duration: 4200 });
            return raw;

          case "blocked":
          case "reported":
            toast("This person is not available for matching.", { duration: 2000 });
            return raw;

          case "event_not_active":
            toast("This event is no longer active.", { duration: 3500 });
            return raw;

          case "already_swiped":
            return raw;

          case "vibe_recorded":
            return raw;

          default:
            return raw;
        }
      } catch (err) {
        console.error("Swipe error:", err);
        trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, {
          ...buildLobbySwipeResultPayload({
            eventId,
            platform: "web",
            swipeType,
            result: { result: "client_exception", reason: "unknown", notification_suppressed: true },
          }),
        });
        Sentry.addBreadcrumb({
          category: "event-lobby",
          message: "lobby_swipe_exception",
          level: "warning",
          data: { event_id: eventId, swipe_type: swipeType },
        });
        toast.error("Something went wrong.");
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [
      user?.id,
      eventId,
      session,
      onMatch,
      onVideoSessionReady,
      onMatchQueued,
      onVideoSessionQueued,
      canAttemptPairing,
      readinessBlockMessage,
    ]
  );

  return { swipe, isProcessing };
};
