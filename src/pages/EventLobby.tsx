import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as Sentry from "@sentry/react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { ArrowLeft, X, Heart, Star, Clock, Sparkles, Moon, Radio, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isVdbgEnabled, vdbg } from "@/lib/vdbg";
import { haptics } from "@/lib/haptics";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventDetails, useIsRegisteredForEvent } from "@/hooks/useEventDetails";
import { useEventDeck, DeckProfile } from "@/hooks/useEventDeck";
import { useSwipeAction } from "@/hooks/useSwipeAction";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useNonBlockingVideoDateReadiness } from "@/hooks/useVideoDateReadiness";
import { persistReadyGateSuppressionV2 } from "@/lib/videoDateReadiness";
import { useMatchQueue } from "@/hooks/useMatchQueue";
import { useActiveSession } from "@/hooks/useActiveSession";
import { useEventActiveSession } from "@/contexts/SessionHydrationContext";
import { supabase } from "@/integrations/supabase/client";
import { prepareVideoDateEntry } from "@/lib/videoDatePrepareEntry";
import { preloadRoute, preloadRouteOnIdle } from "@/lib/routePreload";
import { toast } from "sonner";
import { differenceInSeconds } from "date-fns";
import LobbyProfileCard from "@/components/lobby/LobbyProfileCard";
import LobbyEmptyState from "@/components/lobby/LobbyEmptyState";
import ReadyGateOverlay from "@/components/lobby/ReadyGateOverlay";
import { EventEndedModal } from "@/components/events/EventEndedModal";
import { PremiumPill } from "@/components/premium/PremiumPill";
import { trackEvent } from "@/lib/analytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { getWebEventLobbyGateState, type EventLobbyGateState } from "@/lib/eventLobbyGating";
import { resolveEventLifecycle } from "@/lib/eventLifecycle";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import { useQueryClient } from "@tanstack/react-query";
import { END_ACCOUNT_BREAK_PROFILE_UPDATE } from "@/lib/endAccountBreak";
import { claimDateNavigation } from "@/lib/dateNavigationGuard";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from "@clientShared/matching/activeSession";
import {
  getPostDateLobbyContinuityDecision,
  secondsUntilPostDateEventEnd,
  type PostDateContinuityDecision,
} from "@clientShared/matching/postDateContinuity";
import {
  QUEUED_MATCH_TIMED_OUT_USER_MESSAGE,
  shouldAdvanceLobbyDeckAfterSwipe,
} from "@shared/matching/videoSessionFlow";
import {
  bucketEventLobbyCount,
  EventLobbyObservabilityEvents,
  resolveDeckEmptyReason,
} from "@clientShared/observability/eventLobbyObservability";
import { isActiveSessionSingleOwnerEnabled } from "@/lib/runtimeFlags";

const READY_GATE_ACTIVE_STATUSES = new Set(["ready", "ready_a", "ready_b", "both_ready", "snoozed"]);
const READY_GATE_MANUAL_EXIT_SUPPRESS_MS = 45_000;

function lobbyDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[EventLobby] ${message}`, data ?? {});
}

function logVdbgSessionStage(message: string, sessionId: string, data?: Record<string, unknown>) {
  if (!isVdbgEnabled()) return;
  vdbg(message, { sessionId, ...(data ?? {}) });
  void supabase
    .from("video_sessions")
    .select("id, event_id, ready_gate_status, state, phase, handshake_started_at, ended_at, ready_gate_expires_at, daily_room_name, daily_room_url")
    .eq("id", sessionId)
    .maybeSingle()
    .then(({ data: row, error }) => {
      vdbg(`${message}_stage`, {
        sessionId,
        ...(data ?? {}),
        row: row ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      });
    });
}

function isActiveDateQueueStatus(status: unknown): status is "in_handshake" | "in_date" {
  return status === "in_handshake" || status === "in_date";
}

function isActiveVideoPhase(row: Record<string, unknown>): boolean {
  return videoSessionRowIndicatesHandshakeOrDate({
    state: typeof row.state === "string" ? row.state : null,
    daily_room_name: typeof row.daily_room_name === "string" ? row.daily_room_name : null,
    daily_room_url: typeof row.daily_room_url === "string" ? row.daily_room_url : null,
    handshake_started_at:
      typeof row.handshake_started_at === "string" ? row.handshake_started_at : null,
  });
}

const EventLobby = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshProfile } = useUserProfile();
  const queryClient = useQueryClient();
  const [endingBreak, setEndingBreak] = useState(false);
  const [showEventEndedModal, setShowEventEndedModal] = useState(false);
  const [lobbyClockMs, setLobbyClockMs] = useState(() => Date.now());
  const [eventLifecycleOverride, setEventLifecycleOverride] = useState<
    "cancelled" | "archived" | "draft" | null
  >(null);
  const [eventEndedAtOverride, setEventEndedAtOverride] = useState<string | null>(null);

  // Data hooks
  const { data: event, isLoading: eventLoading } = useEventDetails(eventId);
  const { data: regSnapshot, isLoading: regLoading } = useIsRegisteredForEvent(eventId, user?.id);
  const eventForLobbyGate = useMemo(
    () =>
      event
        ? {
            ...event,
            status: eventLifecycleOverride ?? event.status,
            endedAt: eventEndedAtOverride ? new Date(eventEndedAtOverride) : event.endedAt,
          }
        : event,
    [event, eventEndedAtOverride, eventLifecycleOverride]
  );
  const resolvedEventLifecycle = useMemo(
    () =>
      eventForLobbyGate
        ? resolveEventLifecycle({
            status: eventForLobbyGate.status,
            eventDate: eventForLobbyGate.eventDate,
            durationMinutes: eventForLobbyGate.durationMinutes,
            endedAt: eventForLobbyGate.endedAt,
            nowMs: lobbyClockMs,
          })
        : null,
    [eventForLobbyGate, lobbyClockMs]
  );
  const eventEndTime = resolvedEventLifecycle?.endsAt ?? null;
  const eventEndTimeMs = eventEndTime?.getTime() ?? null;
  const lobbyGate = useMemo(
    () =>
      getWebEventLobbyGateState({
        eventId,
        userId: user?.id,
        userPaused: user?.isPaused ?? false,
        event: eventForLobbyGate,
        eventLoading,
        registration: regSnapshot,
        registrationLoading: regLoading,
        nowMs: lobbyClockMs,
      }),
    [
      eventForLobbyGate,
      eventId,
      eventLoading,
      lobbyClockMs,
      regLoading,
      regSnapshot,
      user?.id,
      user?.isPaused,
    ]
  );
  const deckEnabled = lobbyGate.canFetchDeck;
  const lobbySideEffectsEnabled = lobbyGate.canUseLobbySideEffects;
  const lobbyActionsEnabled = lobbyGate.canUseLobbyActions && !showEventEndedModal;
  const {
    profiles,
    isLoading: deckLoading,
    isError: deckError,
    error: deckFetchError,
    refetch: refetchDeck,
  } = useEventDeck({
    eventId: eventId || "",
    enabled: deckEnabled,
  });
  const { setStatus, currentStatus } = useEventStatus({ eventId, enabled: lobbySideEffectsEnabled });
  const readinessV2 = useFeatureFlag("video_date.readiness_v2");
  const videoDateReadiness = useNonBlockingVideoDateReadiness(
    eventId,
    readinessV2.enabled && lobbySideEffectsEnabled,
  );

  const [searchParams, setSearchParams] = useSearchParams();

  // Ready Gate overlay state (server-backed; optimistic updates via refetch)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dateNavigationSessionId, setDateNavigationSessionId] = useState<string | null>(null);
  const [checkingNextDateAfterSurvey, setCheckingNextDateAfterSurvey] = useState(false);
  const [postSurveyReturnContext, setPostSurveyReturnContext] = useState(false);
  const singleOwnerActiveSessionEnabled = isActiveSessionSingleOwnerEnabled();
  const providerScopedHydration = useEventActiveSession(eventId);
  const legacyScopedHydration = useActiveSession(user?.id, {
    eventId,
    enabled: !singleOwnerActiveSessionEnabled,
  });
  const {
    activeSession: scopedSession,
    hydrated: sessionHydrated,
    refetch: refetchScopedSession,
  } = singleOwnerActiveSessionEnabled ? providerScopedHydration : legacyScopedHydration;
  const sameEventScopedSession = useMemo(() => {
    if (!sessionHydrated || !eventId || !scopedSession || scopedSession.eventId !== eventId) {
      return null;
    }
    return scopedSession;
  }, [sessionHydrated, eventId, scopedSession]);
  const scopedSessionId = sameEventScopedSession?.sessionId ?? null;
  const scopedSessionKind = sameEventScopedSession?.kind ?? null;
  const scopedSessionQueueStatus = sameEventScopedSession?.queueStatus ?? null;
  const hasScopedSession = scopedSessionId !== null;
  const activeSessionIdRef = useRef<string | null>(null);
  const activeServerSessionRef = useRef<string | null>(null);
  const dateNavigationSessionIdRef = useRef<string | null>(null);
  const prepareNavigationInFlightRef = useRef<Set<string>>(new Set());
  const readyGateManualExitSuppressUntilRef = useRef<Map<string, number>>(new Map());
  const lobbyConvergenceRefreshTimersRef = useRef<Map<string, number>>(new Map());
  const deferredLobbyWorkTimersRef = useRef<Set<number>>(new Set());
  const lobbyEnteredEventRef = useRef<string | null>(null);
  const postSurveyRouteTrackedRef = useRef<string | null>(null);
  const deckLoadedTrackedRef = useRef<string | null>(null);
  const deckEmptyTrackedRef = useRef<string | null>(null);
  const deckErrorTrackedRef = useRef<string | null>(null);
  const lifecycleDebugKeyRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    dateNavigationSessionIdRef.current = dateNavigationSessionId;
  }, [dateNavigationSessionId]);

  useEffect(() => {
    activeServerSessionRef.current = scopedSessionId ?? activeSessionId ?? null;
  }, [scopedSessionId, activeSessionId]);

  const scheduleLobbyConvergenceRefresh = useCallback(
    (sessionId: string | null, source: string, delayMs = 180) => {
      const key = sessionId ?? "event";
      if (lobbyConvergenceRefreshTimersRef.current.has(key)) {
        lobbyDebug("lobby convergence refresh coalesced", { sessionId, source });
        return;
      }
      const timer = window.setTimeout(() => {
        lobbyConvergenceRefreshTimersRef.current.delete(key);
        void refetchScopedSession();
      }, delayMs);
      lobbyConvergenceRefreshTimersRef.current.set(key, timer);
    },
    [refetchScopedSession],
  );

  const scheduleDeferredLobbyWork = useCallback(
    (source: string, work: () => void, delayMs = 180) => {
      const timer = window.setTimeout(() => {
        deferredLobbyWorkTimersRef.current.delete(timer);
        work();
      }, delayMs);
      deferredLobbyWorkTimersRef.current.add(timer);
      lobbyDebug("lobby deferred work scheduled", { source, delayMs });
    },
    [],
  );

  useEffect(() => {
    const lobbyConvergenceTimers = lobbyConvergenceRefreshTimersRef.current;
    const deferredLobbyWorkTimers = deferredLobbyWorkTimersRef.current;
    return () => {
      for (const timer of lobbyConvergenceTimers.values()) {
        clearTimeout(timer);
      }
      lobbyConvergenceTimers.clear();
      for (const timer of deferredLobbyWorkTimers.values()) {
        clearTimeout(timer);
      }
      deferredLobbyWorkTimers.clear();
    };
  }, []);

  const isReadyGateManualExitSuppressed = useCallback((sessionId: string): boolean => {
    const suppressUntil = readyGateManualExitSuppressUntilRef.current.get(sessionId);
    if (!suppressUntil) return false;
    if (suppressUntil <= Date.now()) {
      readyGateManualExitSuppressUntilRef.current.delete(sessionId);
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!eventForLobbyGate || !resolvedEventLifecycle) return;
    const rawEndedAt = eventEndedAtOverride ?? eventForLobbyGate.endedAt?.toISOString() ?? null;
    const debugKey = [
      eventForLobbyGate.id,
      eventForLobbyGate.status ?? "",
      eventForLobbyGate.eventDate.toISOString(),
      eventForLobbyGate.durationMinutes,
      rawEndedAt ?? "",
      resolvedEventLifecycle.lifecycle,
    ].join("|");
    if (lifecycleDebugKeyRef.current === debugKey) return;
    lifecycleDebugKeyRef.current = debugKey;
    lobbyDebug("event lifecycle resolved", {
      eventId: eventForLobbyGate.id,
      rawStatus: eventForLobbyGate.status,
      event_date: eventForLobbyGate.eventDate.toISOString(),
      duration_minutes: eventForLobbyGate.durationMinutes,
      ended_at: rawEndedAt,
      resolvedLifecycle: resolvedEventLifecycle.lifecycle,
    });
  }, [eventEndedAtOverride, eventForLobbyGate, resolvedEventLifecycle]);

  useEffect(() => {
    setLobbyClockMs(Date.now());
    if (!eventEndTimeMs) return;
    const intervalId = setInterval(() => setLobbyClockMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [eventEndTimeMs]);

  const openReadyGateSession = useCallback((sessionId: string, source: string) => {
    if (!sessionId || dateNavigationSessionIdRef.current) return;
    if (isReadyGateManualExitSuppressed(sessionId)) {
      lobbyDebug("ready gate open suppressed after manual exit", { sessionId, source });
      scheduleLobbyConvergenceRefresh(sessionId, `${source}_manual_exit_suppressed`, 0);
      return;
    }
    const isBackendHydratedSession = scopedSessionId === sessionId;
    if (!lobbyActionsEnabled && !isBackendHydratedSession) {
      lobbyDebug("ready gate open suppressed by lobby gate", {
        sessionId,
        source,
        gate: lobbyGate.kind,
      });
      scheduleLobbyConvergenceRefresh(sessionId, `${source}_lobby_gate_suppressed`, 0);
      return;
    }
    if (activeSessionIdRef.current !== sessionId) {
      lobbyDebug("activeSessionId set", { sessionId, source });
    }
    logVdbgSessionStage("ready_gate_open", sessionId, {
      trigger: source,
      eventId,
      activeSessionId: activeSessionIdRef.current,
      dateNavigationSessionId: dateNavigationSessionIdRef.current,
    });
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
  }, [
    eventId,
    isReadyGateManualExitSuppressed,
    lobbyActionsEnabled,
    lobbyGate.kind,
    scheduleLobbyConvergenceRefresh,
    scopedSessionId,
  ]);

  const clearReadyGateSession = useCallback((source: string) => {
    if (dateNavigationSessionIdRef.current) {
      lobbyDebug("activeSessionId clear suppressed during date navigation", {
        sessionId: dateNavigationSessionIdRef.current,
        source,
      });
      return;
    }
    if (activeSessionIdRef.current) {
      lobbyDebug("activeSessionId cleared", { sessionId: activeSessionIdRef.current, source });
    }
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
  }, []);

  const suppressReadyGateSessionAfterManualExit = useCallback((sessionId: string) => {
    const suppressUntilMs = Date.now() + READY_GATE_MANUAL_EXIT_SUPPRESS_MS;
    readyGateManualExitSuppressUntilRef.current.set(sessionId, suppressUntilMs);
    if (readinessV2.enabled) {
      void persistReadyGateSuppressionV2(sessionId, suppressUntilMs);
    }
    if (activeSessionIdRef.current === sessionId) {
      clearReadyGateSession("ready_gate_manual_exit_confirmed");
    }
  }, [clearReadyGateSession, readinessV2.enabled]);

  useEffect(() => {
    if (!eventId || !event) return;

    if (lobbyGate.kind === "ended") {
      setShowEventEndedModal(true);
    }

    if (lobbyGate.kind !== "live" && activeSessionId && scopedSessionId !== activeSessionId) {
      clearReadyGateSession(`lobby_gate_${lobbyGate.kind}`);
    }

    const channel = supabase
      .channel(`web-event-lifecycle-${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
        (payload) => {
          const row = payload.new as { status?: string | null; ended_at?: string | null };
          const status = (row.status ?? "").toLowerCase();
          void queryClient.invalidateQueries({ queryKey: ["event-details", eventId] });
          setLobbyClockMs(Date.now());
          if (row.ended_at) {
            setEventEndedAtOverride(row.ended_at);
            setShowEventEndedModal(true);
          }
          if (status === "cancelled" || status === "archived" || status === "draft") {
            setEventLifecycleOverride(status);
            clearReadyGateSession(`event_status_${status}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    activeSessionId,
    clearReadyGateSession,
    event,
    eventId,
    lobbyGate.kind,
    queryClient,
    scopedSessionId,
  ]);

  const navigateToDateSession = useCallback(
    (sessionId: string, source: string) => {
      if (!sessionId) return;
      if (dateNavigationSessionIdRef.current === sessionId) return;
      const claim = claimDateNavigation(sessionId, location.pathname);
      if (claim.ok === false) {
        vdbg("lobby_navigate_to_date_suppressed", {
          trigger: source,
          sessionId,
          eventId,
          reason: claim.reason,
          currentPath: location.pathname,
          target: `/date/${sessionId}`,
        });
        return;
      }
      dateNavigationSessionIdRef.current = sessionId;
      setDateNavigationSessionId(sessionId);
      lobbyDebug("ready-gate success path navigating to date", { sessionId, source });
      logVdbgSessionStage("lobby_navigate_to_date", sessionId, {
        trigger: source,
        target: `/date/${sessionId}`,
        eventId,
      });
      if (eventId) {
        trackEvent(EventLobbyObservabilityEvents.DATE_ENTERED_FROM_LOBBY, {
          platform: "web",
          event_id: eventId,
          session_id_present: true,
          source_surface: "event_lobby",
          source_action: source,
        });
      }
      navigate(`/date/${sessionId}`, { replace: true });
    },
    [eventId, location.pathname, navigate]
  );

  const prepareAndNavigateToDateSession = useCallback(
    (sessionId: string, source: string) => {
      if (prepareNavigationInFlightRef.current.has(sessionId)) {
        vdbg("event_lobby_prepare_entry_suppressed", {
          sessionId,
          eventId,
          source,
          reason: "prepare_entry_already_in_flight",
        });
        return;
      }
      prepareNavigationInFlightRef.current.add(sessionId);
      const observedAtMs = Date.now();
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId,
        sourceSurface: "event_lobby",
        checkpoint: "both_ready_observed",
        nowMs: observedAtMs,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "both_ready_observed",
          sourceAction: source,
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY_OBSERVED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source,
        source_surface: "event_lobby",
        source_action: source,
      });
      const navigateAfterPrepare = (nextSource: string) => {
        const navigationContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId,
          sourceSurface: "event_lobby",
          checkpoint: "navigation_started",
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: navigationContext,
            checkpoint: "navigation_started",
            sourceAction: nextSource,
            outcome: "success",
          }),
        );
        navigateToDateSession(sessionId, nextSource);
      };
      void prepareVideoDateEntry(sessionId, {
        eventId,
        userId: user?.id ?? null,
        source: `event_lobby_${source}`,
        bothReadyObservedAtMs: observedAtMs,
      })
        .then((result) => {
          if (result.ok === true) {
            navigateAfterPrepare(`${source}_prepare_done`);
            return;
          }
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            source_surface: "event_lobby",
            source_action: "prepare_entry_failed_no_nav",
            code: result.code,
            reason_code: result.code,
            httpStatus: result.httpStatus ?? null,
            retryable: result.retryable,
          });
          vdbg("event_lobby_prepare_entry_failed_no_nav", {
            sessionId,
            eventId,
            source,
            code: result.code,
            httpStatus: result.httpStatus ?? null,
            retryable: result.retryable,
          });
          trackEvent(LobbyPostDateEvents.READY_GATE_HANDOFF_RECOVERY, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            source_surface: "event_lobby",
            source_action: `${source}_prepare_failed_ready_gate_recovery`,
            outcome: "recovered",
            code: result.code,
            reason_code: result.code,
            httpStatus: result.httpStatus ?? null,
            retryable: result.retryable,
          });
          openReadyGateSession(sessionId, `${source}_prepare_failed_ready_gate_recovery`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILED_NO_NAV, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            source_surface: "event_lobby",
            source_action: "prepare_entry_exception_no_nav",
            code: "PREPARE_ENTRY_EXCEPTION",
            reason_code: "PREPARE_ENTRY_EXCEPTION",
            httpStatus: null,
            retryable: true,
          });
          vdbg("event_lobby_prepare_entry_exception_no_nav", {
            sessionId,
            eventId,
            source,
            message,
          });
          openReadyGateSession(sessionId, `${source}_prepare_exception_ready_gate_recovery`);
        })
        .finally(() => {
          prepareNavigationInFlightRef.current.delete(sessionId);
        });
    },
    [eventId, navigateToDateSession, openReadyGateSession, user?.id],
  );

  // Pending video session from post-date queue / push deep link (canonical + legacy query names)
  useEffect(() => {
    const pending =
      searchParams.get("pendingVideoSession") ?? searchParams.get("pendingMatch");
    if (pending) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("pendingVideoSession");
      nextParams.delete("pendingMatch");
      setSearchParams(nextParams, { replace: true });
      scheduleLobbyConvergenceRefresh(pending, "pending_video_session", 0);
    }
  }, [searchParams, setSearchParams, scheduleLobbyConvergenceRefresh]);

  // Track whether the deck ever had profiles (to distinguish "initial empty" from "exhausted")
  const deckEverLoadedRef = useRef(false);
  const deckExhaustedFiredRef = useRef(false);
  const convergenceImpressionRef = useRef(false);
  const superVibeCountDiagLoggedRef = useRef<string | null>(null);

  useEffect(() => {
    deckEverLoadedRef.current = false;
    deckExhaustedFiredRef.current = false;
    activeSessionIdRef.current = null;
    dateNavigationSessionIdRef.current = null;
    prepareNavigationInFlightRef.current.clear();
    for (const timer of lobbyConvergenceRefreshTimersRef.current.values()) {
      clearTimeout(timer);
    }
    lobbyConvergenceRefreshTimersRef.current.clear();
    for (const timer of deferredLobbyWorkTimersRef.current.values()) {
      clearTimeout(timer);
    }
    deferredLobbyWorkTimersRef.current.clear();
    setActiveSessionId(null);
    setDateNavigationSessionId(null);
    setShowEventEndedModal(false);
    setEventLifecycleOverride(null);
    setEventEndedAtOverride(null);
    setPostSurveyReturnContext(false);
    setCheckingNextDateAfterSurvey(false);
    postSurveyRouteTrackedRef.current = null;
    deckLoadedTrackedRef.current = null;
    deckEmptyTrackedRef.current = null;
    deckErrorTrackedRef.current = null;
  }, [eventId]);

  /** Remaining super vibes this event (server caps at 3 per event on event_swipes). */
  const [superVibeRemaining, setSuperVibeRemaining] = useState(3);
  const [userVibes, setUserVibes] = useState<string[]>([]);

  // Swipe action — show Ready Gate on immediate match
  const { swipe, isProcessing } = useSwipeAction({
    eventId: eventId || "",
    canAttemptPairing: !readinessV2.enabled || videoDateReadiness.canAttemptPairing,
    readinessBlockMessage: videoDateReadiness.reason,
    onVideoSessionReady: (videoSessionId) => {
      openReadyGateSession(videoSessionId, "swipe_result");
      scheduleLobbyConvergenceRefresh(videoSessionId, "swipe_result");
    },
    onVideoSessionQueued: () => {
      // Toast already handled by useSwipeAction
    },
  });

  // Queue drain / realtime — activates ready gate when a queued video session becomes ready
  const { queuedCount, refreshQueueCount, isDraining: queueDrainInFlight } = useMatchQueue({
    eventId,
    currentStatus: currentStatus || "browsing",
    enabled: lobbySideEffectsEnabled,
    onVideoSessionReady: () => {
      scheduleLobbyConvergenceRefresh(null, "match_queue");
    },
    onQueuedSessionExpired: () => {
      toast.info(QUEUED_MATCH_TIMED_OUT_USER_MESSAGE, { duration: 4200 });
    },
  });

  useEffect(() => {
    if (!eventId || !lobbySideEffectsEnabled) return;
    if (!sessionHydrated && profiles.length === 0) return;
    preloadRouteOnIdle("videoDate");
  }, [eventId, lobbySideEffectsEnabled, profiles.length, sessionHydrated]);

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState("");

  // Fetch user's vibe tags for "shared vibes" display
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label)")
        .eq("profile_id", user.id);
      if (data) {
        const labels = data
          .map((v) => {
            const raw = v.vibe_tags as { label: string } | { label: string }[] | null;
            const tag = Array.isArray(raw) ? raw[0] : raw;
            return tag?.label;
          })
          .filter(Boolean) as string[];
        setUserVibes(labels);
      }
    })();
  }, [user?.id]);

  // Super vibes left this event (same rule as handle_swipe: max 3 per event). Non-fatal: lobby must mount if this fails.
  useEffect(() => {
    if (!user?.id || !eventId || !deckEnabled) return;
    const diagKey = `${eventId}:${user.id}`;
    let cancelled = false;
    void (async () => {
      try {
        const { count, error } = await supabase
          .from("event_swipes")
          .select("id", { count: "exact" })
          .eq("event_id", eventId)
          .eq("actor_id", user.id)
          .eq("swipe_type", "super_vibe")
          .limit(1);
        if (cancelled) return;
        if (import.meta.env.DEV && superVibeCountDiagLoggedRef.current !== diagKey) {
          superVibeCountDiagLoggedRef.current = diagKey;
          if (error) {
            lobbyDebug("super_vibe_count_load_failed", {
              eventId,
              userId: user.id,
              sessionKind: scopedSessionKind,
              sessionId: scopedSessionId,
              message: error.message,
            });
          } else {
            lobbyDebug("super_vibe_count_load_ok", {
              eventId,
              userId: user.id,
              used: count ?? 0,
            });
          }
        }
        if (error) return;
        const used = count ?? 0;
        setSuperVibeRemaining(Math.max(0, 3 - used));
      } catch {
        if (import.meta.env.DEV && superVibeCountDiagLoggedRef.current !== diagKey) {
          superVibeCountDiagLoggedRef.current = diagKey;
          lobbyDebug("super_vibe_count_load_failed", {
            eventId,
            userId: user.id,
            sessionKind: scopedSessionKind,
            sessionId: scopedSessionId,
            message: "exception",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, eventId, deckEnabled, scopedSessionKind, scopedSessionId]);

  // Lobby presence only when no backend-owned active session is in flight.
  useEffect(() => {
    if (!eventId || !lobbySideEffectsEnabled || lobbyEnteredEventRef.current === eventId) return;
    lobbyEnteredEventRef.current = eventId;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_ENTERED, { event_id: eventId, platform: "web" });
  }, [eventId, lobbySideEffectsEnabled]);

  useEffect(() => {
    if (!eventId || !sessionHydrated || !lobbySideEffectsEnabled) return;
    if (dateNavigationSessionId || activeSessionId || hasScopedSession) return;
    void setStatus("browsing");
  }, [
    eventId,
    sessionHydrated,
    lobbySideEffectsEnabled,
    dateNavigationSessionId,
    activeSessionId,
    hasScopedSession,
    setStatus,
  ]);

  useEffect(() => {
    return () => {
      if (dateNavigationSessionIdRef.current || activeServerSessionRef.current) {
        lobbyDebug("lobby offline status suppressed during active convergence", {
          dateNavigationSessionId: dateNavigationSessionIdRef.current,
          activeServerSessionId: activeServerSessionRef.current,
        });
        return;
      }
      void setStatus("offline");
    };
  }, [setStatus]);

  // Canonical lobby foreground proof: stamp only while this lobby route is visible in the foreground.
  useEffect(() => {
    if (!eventId || !user?.id || !lobbySideEffectsEnabled) return;

    const expectedPath = `/event/${eventId}/lobby`;
    const isOnLobbyRoute = location.pathname === expectedPath;
    const canStampStatus = currentStatus === "browsing" || currentStatus === "idle";

    if (!isOnLobbyRoute || !canStampStatus) return;

    const stampForeground = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await supabase.rpc("mark_lobby_foreground", {
          p_event_id: eventId,
        });
      } catch {}
    };

    void stampForeground();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void stampForeground();
        void refreshQueueCount();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = setInterval(() => {
      void stampForeground();
    }, 30000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, [eventId, user?.id, lobbySideEffectsEnabled, location.pathname, currentStatus, refreshQueueCount]);

  // Backend-truth-first: scoped active session for this event (ready gate vs /date)
  useEffect(() => {
    if (!sessionHydrated || !eventId) return;
    vdbg("lobby_mount_active_session", {
      eventId,
      hydrated: sessionHydrated,
      activeSessionExists: hasScopedSession,
      activeSessionKind: scopedSessionKind,
      activeSessionId: scopedSessionId,
      activeSessionQueueStatus: scopedSessionQueueStatus,
      stickySessionId: activeSessionIdRef.current,
    });
    if (scopedSessionId) {
      logVdbgSessionStage("lobby_mount_active_session_detail", scopedSessionId, {
        eventId,
        activeSessionKind: scopedSessionKind,
        activeSessionQueueStatus: scopedSessionQueueStatus,
      });
    }
    lobbyDebug("active session hydration observed", {
      hydrated: sessionHydrated,
      eventId,
      kind: scopedSessionKind,
      sessionId: scopedSessionId,
      queueStatus: scopedSessionQueueStatus,
      stickySessionId: activeSessionIdRef.current,
    });
    if (!lobbyActionsEnabled && !scopedSessionId) {
      clearReadyGateSession("lobby_gate_inactive_hydration");
      return;
    }
    if (scopedSessionKind === "video" && scopedSessionId) {
      navigateToDateSession(scopedSessionId, "active_session_hydration");
      return;
    }
    if (scopedSessionKind === "ready_gate" && scopedSessionId) {
      openReadyGateSession(scopedSessionId, "active_session_hydration");
      return;
    }
    if (activeSessionIdRef.current) {
      lobbyDebug("holding sticky ready gate through empty hydration result", {
        sessionId: activeSessionIdRef.current,
      });
    }
  }, [
    sessionHydrated,
    eventId,
    hasScopedSession,
    scopedSessionKind,
    scopedSessionId,
    scopedSessionQueueStatus,
    lobbyActionsEnabled,
    navigateToDateSession,
    openReadyGateSession,
    clearReadyGateSession,
  ]);

  // Returning from video date / survey: fresh deck, no stale overlay.
  useEffect(() => {
    const st = location.state as { lobbyRefresh?: boolean } | null;
    const hasPostSurveyQuery = searchParams.get("postSurveyComplete") === "1";
    if ((!st?.lobbyRefresh && !hasPostSurveyQuery) || !eventId || !user?.id) return;
    setCheckingNextDateAfterSurvey(true);
    setPostSurveyReturnContext(true);
    dateNavigationSessionIdRef.current = null;
    setDateNavigationSessionId(null);
    clearReadyGateSession("lobby_refresh");
    void queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user.id] });
    let nextSearch = location.search;
    if (hasPostSurveyQuery) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("postSurveyComplete");
      setSearchParams(nextParams, { replace: true });
      const serialized = nextParams.toString();
      nextSearch = serialized ? `?${serialized}` : "";
    }
    navigate(location.pathname + nextSearch, { replace: true, state: {} });
  }, [
    location.state,
    location.pathname,
    location.search,
    searchParams,
    setSearchParams,
    eventId,
    user?.id,
    navigate,
    queryClient,
    clearReadyGateSession,
  ]);

  useEffect(() => {
    if (!checkingNextDateAfterSurvey) return;
    if (queueDrainInFlight || !sessionHydrated || deckLoading) return;
    const timer = setTimeout(() => setCheckingNextDateAfterSurvey(false), 900);
    return () => clearTimeout(timer);
  }, [checkingNextDateAfterSurvey, queueDrainInFlight, sessionHydrated, deckLoading]);

  // FAILURE 1 FIX: Realtime subscription for own registration status changes
  // Uses profile_id filter for efficiency — only fires for THIS user's row
  useEffect(() => {
    if (!user?.id || !eventId) return;
    const channel = supabase
      .channel(`lobby-match-${eventId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "event_registrations",
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const newData = payload.new as Record<string, unknown>;
          if (newData.event_id !== eventId) return;

          const queueStatus = newData.queue_status;
          const currentRoomId =
            typeof newData.current_room_id === "string" ? newData.current_room_id : null;

          if (isActiveDateQueueStatus(queueStatus) && currentRoomId) {
            lobbyDebug("same-session active date detected from registration realtime", {
              sessionId: currentRoomId,
              queueStatus,
            });
            scheduleLobbyConvergenceRefresh(currentRoomId, "registration_realtime_active_date");
            prepareAndNavigateToDateSession(currentRoomId, "registration_realtime");
            return;
          }

          if (queueStatus === "in_ready_gate" && currentRoomId) {
            lobbyDebug("ready gate detected from registration realtime", { sessionId: currentRoomId });
            openReadyGateSession(currentRoomId, "registration_realtime");
            scheduleLobbyConvergenceRefresh(currentRoomId, "registration_realtime_ready_gate");
            return;
          }

          if (queueStatus === "in_ready_gate" || isActiveDateQueueStatus(queueStatus) || currentRoomId) {
            scheduleLobbyConvergenceRefresh(currentRoomId, "registration_realtime_ambiguous");
            lobbyDebug("ambiguous active registration realtime (useActiveSession reconciles)", {
              queueStatus,
              currentRoomId,
            });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, eventId, prepareAndNavigateToDateSession, openReadyGateSession, scheduleLobbyConvergenceRefresh]);

  useEffect(() => {
    if (!user?.id || !eventId) return;
    const handleVideoSessionChange = (
      payload: { new: Record<string, unknown> },
      source: "video_session_realtime" | "video_session_insert"
    ) => {
      const session = payload.new as Record<string, unknown>;
      if (session.event_id !== eventId) return;
      const isParticipant =
        session.participant_1_id === user.id || session.participant_2_id === user.id;
      if (!isParticipant) return;
      const sessionId = typeof session.id === "string" ? session.id : null;
      if (!sessionId) return;

      if (canAttemptDailyRoomFromVideoSessionTruth(session) || isActiveVideoPhase(session)) {
        lobbyDebug("same-session active date detected from participant-scoped video session realtime", {
          sessionId,
          state: session.state,
          phase: session.phase,
          readyGateStatus: session.ready_gate_status,
          readyGateExpiresAt: session.ready_gate_expires_at,
        });
        scheduleLobbyConvergenceRefresh(sessionId, `${source}_active_date`);
        prepareAndNavigateToDateSession(sessionId, source);
        return;
      }

      const status = session.ready_gate_status;
      if (typeof status === "string" && READY_GATE_ACTIVE_STATUSES.has(status)) {
        openReadyGateSession(sessionId, source);
        scheduleLobbyConvergenceRefresh(sessionId, source);
      }
    };

    const channel = supabase.channel(`lobby-video-${eventId}-${user.id}`);
    // Realtime cannot OR participant columns in one filter. Subscribe to each
    // participant side, then validate event/session truth before side effects.
    for (const filter of [`participant_1_id=eq.${user.id}`, `participant_2_id=eq.${user.id}`]) {
      channel
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "video_sessions",
            filter,
          },
          (payload) => handleVideoSessionChange(payload, "video_session_realtime")
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "video_sessions",
            filter,
          },
          (payload) => handleVideoSessionChange(payload, "video_session_insert")
        );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, eventId, prepareAndNavigateToDateSession, openReadyGateSession, scheduleLobbyConvergenceRefresh]);

  // Event countdown timer
  useEffect(() => {
    if (!eventEndTimeMs) return;
    const endTime = new Date(eventEndTimeMs);

    const tick = () => {
      const latestLifecycle = eventForLobbyGate
        ? resolveEventLifecycle({
            status: eventForLobbyGate.status,
            eventDate: eventForLobbyGate.eventDate,
            durationMinutes: eventForLobbyGate.durationMinutes,
            endedAt: eventForLobbyGate.endedAt,
          })
        : null;
      if (latestLifecycle?.isEnded || Date.now() >= eventEndTimeMs) {
        setTimeRemaining("Ended");
        return;
      }
      const diff = differenceInSeconds(endTime, new Date());
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setTimeRemaining(`${m}:${String(s).padStart(2, "0")}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [eventEndTimeMs, eventForLobbyGate]);

  // Server-dealt deck v2 is the only active source of deck exclusion truth.
  const sortedProfiles = useMemo(() => {
    const filtered = [...profiles];
    filtered.sort((a, b) => {
      if (a.has_super_vibed && !b.has_super_vibed) return -1;
      if (!a.has_super_vibed && b.has_super_vibed) return 1;
      return 0;
    });
    return filtered;
  }, [profiles]);

  const currentProfile = sortedProfiles[0] || null;
  const nextProfile = sortedProfiles[1] || null;
  const thirdProfile = sortedProfiles[2] || null;
  const eventEndsAtForContinuity = eventEndTime;
  const secondsUntilEventEnd = useMemo(
    () => secondsUntilPostDateEventEnd(eventEndsAtForContinuity),
    [eventEndsAtForContinuity]
  );

  const deckEmptyReason = useMemo(
    () =>
      resolveDeckEmptyReason({
        deckEnabled,
        gateKind: lobbyGate.kind,
        deckError,
        deckErrorValue: deckFetchError,
        totalProfiles: profiles.length,
        visibleProfiles: sortedProfiles.length,
        deckEverLoaded: deckEverLoadedRef.current,
        queuedCount,
        userPaused: user?.isPaused ?? false,
      }),
    [
      deckEnabled,
      deckError,
      deckFetchError,
      lobbyGate.kind,
      profiles.length,
      queuedCount,
      sortedProfiles.length,
      user?.isPaused,
    ],
  );

  // Track deck loaded / exhausted
  useEffect(() => {
    if (!eventId || !deckEnabled || deckLoading || deckError) return;
    const key = `${eventId}:${profiles.length}:${sortedProfiles.length}`;
    if (deckLoadedTrackedRef.current === key) return;
    deckLoadedTrackedRef.current = key;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_DECK_LOADED, {
      platform: "web",
      event_id: eventId,
      deck_count_bucket: bucketEventLobbyCount(profiles.length),
      visible_count_bucket: bucketEventLobbyCount(sortedProfiles.length),
    });
  }, [deckEnabled, deckError, deckLoading, eventId, profiles.length, sortedProfiles.length]);

  useEffect(() => {
    if (!eventId || !deckError || !deckEnabled) return;
    const key = `${eventId}:${deckEmptyReason}`;
    if (deckErrorTrackedRef.current === key) return;
    deckErrorTrackedRef.current = key;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_DECK_ERROR, {
      platform: "web",
      event_id: eventId,
      reason: deckEmptyReason,
    });
    Sentry.addBreadcrumb({
      category: "event-lobby",
      message: "lobby_deck_error",
      level: "warning",
      data: {
        event_id: eventId,
        reason: deckEmptyReason,
        gate_kind: lobbyGate.kind,
      },
    });
  }, [deckEmptyReason, deckEnabled, deckError, eventId, lobbyGate.kind]);

  useEffect(() => {
    if (sortedProfiles.length > 0) {
      deckEverLoadedRef.current = true;
      deckExhaustedFiredRef.current = false;
    }
  }, [sortedProfiles.length]);

  useEffect(() => {
    if (
      deckEverLoadedRef.current &&
      !deckExhaustedFiredRef.current &&
      sortedProfiles.length === 0 &&
      !deckLoading &&
      eventId
    ) {
      deckExhaustedFiredRef.current = true;
      trackEvent("lobby_deck_exhausted", { event_id: eventId });
    }
  }, [sortedProfiles.length, deckLoading, eventId]);

  useEffect(() => {
    if (!eventId) return;
    const canReportEmpty =
      (!deckEnabled && lobbyGate.kind !== "loading") ||
      (deckEnabled && !deckLoading && sortedProfiles.length === 0);
    if (!canReportEmpty) return;
    const key = `${eventId}:${deckEmptyReason}`;
    if (deckEmptyTrackedRef.current === key) return;
    deckEmptyTrackedRef.current = key;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_DECK_EMPTY, {
      platform: "web",
      event_id: eventId,
      reason: deckEmptyReason,
      deck_count_bucket: bucketEventLobbyCount(profiles.length),
      visible_count_bucket: bucketEventLobbyCount(sortedProfiles.length),
    });
  }, [
    deckEmptyReason,
    deckEnabled,
    deckLoading,
    eventId,
    lobbyGate.kind,
    profiles.length,
    sortedProfiles.length,
  ]);

  const advanceDeckAfterSwipe = useCallback(
    (targetId: string) => {
      queryClient.setQueryData<DeckProfile[]>(
        ["event-deck", eventId, user?.id, "deck_v2"],
        (current) => Array.isArray(current) ? current.filter((profile) => profile.id !== targetId) : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user?.id] });
    },
    [eventId, queryClient, user?.id]
  );

  const handleVibe = useCallback(async () => {
    if (!currentProfile || isProcessing || !lobbyActionsEnabled) return;
    void preloadRoute("videoDate");
    const targetId = currentProfile.id;
    recordUserAction("event_lobby_swipe_clicked", {
      surface: "event_lobby",
      event_id: eventId,
      swipe_type: "vibe",
    });
    haptics.light();
    const result = await swipe(targetId, "vibe");
    if (!result) return;

    const rawCode = result.result ?? result.outcome ?? result.error;
    const code = rawCode === "swipe_recorded" ? "vibe_recorded" : rawCode;
    if (result.success === false) {
      if (shouldAdvanceLobbyDeckAfterSwipe(code)) {
        advanceDeckAfterSwipe(targetId);
      }
      return;
    }
    if (!shouldAdvanceLobbyDeckAfterSwipe(code)) return;

    trackEvent("lobby_profile_swiped", { event_id: eventId, swipe_type: "vibe", target_present: true });
    recordUserAction("event_lobby_swipe_succeeded", {
      surface: "event_lobby",
      event_id: eventId,
      swipe_type: "vibe",
      result_code: code,
    });

    if (code === "match" || code === "match_queued") {
      haptics.medium();
      void queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
    }

    advanceDeckAfterSwipe(targetId);
  }, [currentProfile, isProcessing, lobbyActionsEnabled, swipe, advanceDeckAfterSwipe, eventId, queryClient]);

  const handlePass = useCallback(async () => {
    if (!currentProfile || isProcessing || !lobbyActionsEnabled) return;
    void preloadRoute("videoDate");
    const targetId = currentProfile.id;
    recordUserAction("event_lobby_swipe_clicked", {
      surface: "event_lobby",
      event_id: eventId,
      swipe_type: "pass",
    });
    const result = await swipe(targetId, "pass");
    if (!result) return;

    const code = result.result ?? result.outcome ?? result.error;
    if (result.success === false) {
      if (shouldAdvanceLobbyDeckAfterSwipe(code)) {
        advanceDeckAfterSwipe(targetId);
      }
      return;
    }
    if (!shouldAdvanceLobbyDeckAfterSwipe(code)) return;

    trackEvent("lobby_profile_swiped", { event_id: eventId, swipe_type: "pass", target_present: true });
    recordUserAction("event_lobby_swipe_succeeded", {
      surface: "event_lobby",
      event_id: eventId,
      swipe_type: "pass",
      result_code: code,
    });

    advanceDeckAfterSwipe(targetId);
  }, [currentProfile, isProcessing, lobbyActionsEnabled, swipe, advanceDeckAfterSwipe, eventId]);

  const handleSuperVibe = useCallback(async () => {
    if (!currentProfile || isProcessing || !lobbyActionsEnabled) return;
    void preloadRoute("videoDate");
    haptics.light();
    const targetId = currentProfile.id;
    recordUserAction("event_lobby_swipe_clicked", {
      surface: "event_lobby",
      event_id: eventId,
      swipe_type: "super_vibe",
    });
    const result = await swipe(targetId, "super_vibe");
    if (!result) return;

    const code = result.result ?? result.outcome ?? result.error;
    if (result.success === false) {
      if (shouldAdvanceLobbyDeckAfterSwipe(code)) {
        advanceDeckAfterSwipe(targetId);
      }
      return;
    }
    if (!shouldAdvanceLobbyDeckAfterSwipe(code)) return;

    if (code === "super_vibe_sent") {
      setSuperVibeRemaining((prev) => Math.max(0, prev - 1));
      trackEvent("super_vibe_used", { event_id: eventId, target_present: true });
    }

    trackEvent("lobby_profile_swiped", { event_id: eventId, swipe_type: "super_vibe", target_present: true });
    recordUserAction("event_lobby_swipe_succeeded", {
      surface: "event_lobby",
      event_id: eventId,
      swipe_type: "super_vibe",
      result_code: code,
    });

    advanceDeckAfterSwipe(targetId);
  }, [currentProfile, isProcessing, lobbyActionsEnabled, swipe, advanceDeckAfterSwipe, eventId]);

  const yieldingToVideoDateUi = Boolean(dateNavigationSessionId || sameEventScopedSession?.kind === "video");
  const yieldingToReadyGateUi = Boolean(
    sameEventScopedSession?.kind === "ready_gate" &&
      activeSessionId !== sameEventScopedSession.sessionId
  );
  const eventLiveForContinuity = Boolean(
    resolvedEventLifecycle?.isLive &&
      (secondsUntilEventEnd == null || secondsUntilEventEnd > 0)
  );
  const postSurveyContinuityDecision = useMemo(
    () =>
      getPostDateLobbyContinuityDecision({
        yieldingToVideoDate: yieldingToVideoDateUi,
        yieldingToReadyGate: yieldingToReadyGateUi,
        hasQueuedSession: queueDrainInFlight || queuedCount > 0,
        deckLoading,
        deckHasCandidate: Boolean(currentProfile),
        deckError,
        eventLive: eventLiveForContinuity,
        secondsUntilEventEnd,
      }),
    [
      currentProfile,
      deckError,
      deckLoading,
      eventLiveForContinuity,
      queueDrainInFlight,
      queuedCount,
      secondsUntilEventEnd,
      yieldingToReadyGateUi,
      yieldingToVideoDateUi,
    ]
  );
  const showPostSurveyQueueCheck =
    checkingNextDateAfterSurvey &&
    !yieldingToVideoDateUi &&
    !yieldingToReadyGateUi &&
    !(currentProfile && !deckLoading);
  const suppressDeckUiForConvergence =
    yieldingToVideoDateUi || yieldingToReadyGateUi || showPostSurveyQueueCheck;
  const readyGateOverlayAllowed = Boolean(
    activeSessionId &&
      eventId &&
      !yieldingToVideoDateUi &&
      (lobbyGate.kind === "live" || sameEventScopedSession?.sessionId === activeSessionId)
  );

  useEffect(() => {
    if (!postSurveyReturnContext || !eventId) return;
    if (checkingNextDateAfterSurvey && postSurveyContinuityDecision.action === "refreshing_deck") return;
    if (postSurveyRouteTrackedRef.current) return;
    postSurveyRouteTrackedRef.current = postSurveyContinuityDecision.action;
    const route =
      postSurveyContinuityDecision.action === "ready_gate"
        ? "event_lobby_ready_gate"
        : postSurveyContinuityDecision.action === "video_date"
          ? "date"
          : postSurveyContinuityDecision.action === "fresh_deck"
            ? "event_lobby_fresh_card"
            : postSurveyContinuityDecision.action === "last_chance"
              ? currentProfile
                ? "event_lobby_last_chance_card"
                : "event_lobby_last_chance_empty"
              : postSurveyContinuityDecision.action === "event_ended"
                ? "event_ended"
                : "event_lobby_empty";

    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
      platform: "web",
      event_id: eventId,
      action: postSurveyContinuityDecision.action,
      source: "lobby_post_survey_return",
      queued_count: queuedCount,
      deck_count: sortedProfiles.length,
      seconds_until_event_end: secondsUntilEventEnd,
    });
    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
      platform: "web",
      event_id: eventId,
      action: postSurveyContinuityDecision.action,
      route,
      queued_count: queuedCount,
      deck_count: sortedProfiles.length,
      seconds_until_event_end: secondsUntilEventEnd,
    });
  }, [
    checkingNextDateAfterSurvey,
    currentProfile,
    eventId,
    postSurveyContinuityDecision.action,
    postSurveyReturnContext,
    queuedCount,
    secondsUntilEventEnd,
    sortedProfiles.length,
  ]);

  useEffect(() => {
    if (!eventId) return;
    if (!suppressDeckUiForConvergence) {
      convergenceImpressionRef.current = false;
      return;
    }
    if (convergenceImpressionRef.current) return;
    convergenceImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.LOBBY_CONVERGENCE_IMPRESSION, {
      platform: "web",
      event_id: eventId,
      source_surface: yieldingToVideoDateUi
        ? "video_date"
        : showPostSurveyQueueCheck
          ? "post_survey_queue_check"
          : "ready_gate",
    });
  }, [eventId, showPostSurveyQueueCheck, suppressDeckUiForConvergence, yieldingToVideoDateUi]);

  // Loading state
  if (lobbyGate.kind === "loading") {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin shadow-[0_0_24px_hsl(var(--primary)/0.35)]" />
      </div>
    );
  }

  if (lobbyGate.kind !== "live" && lobbyGate.kind !== "paused") {
    return (
      <>
        <LobbyUnavailableState gate={lobbyGate} eventId={eventId} onNavigate={navigate} />
        <EventEndedModal isOpen={showEventEndedModal} />
      </>
    );
  }

  const isEmpty = sortedProfiles.length === 0;
  const deckRemaining = sortedProfiles.length;
  const timerUrgent =
    timeRemaining &&
    timeRemaining !== "Ended" &&
    /^\d+:\d{2}$/.test(timeRemaining) &&
    (() => {
      const [m, s] = timeRemaining.split(":").map(Number);
      return m * 60 + s <= 300;
    })();

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-zinc-950 text-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, hsl(var(--neon-violet) / 0.18) 0%, transparent 50%), radial-gradient(ellipse 80% 50% at 100% 60%, hsl(var(--neon-cyan) / 0.06) 0%, transparent 45%), linear-gradient(180deg, hsl(240 10% 6%) 0%, hsl(240 8% 4%) 40%, hsl(0 0% 2%) 100%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 opacity-[0.35] bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2240%22%20height=%2240%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%220.9%22%20numOctaves=%223%22%20stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect%20width=%22100%25%22%20height=%22100%25%22%20filter=%22url(%23n)%22%20opacity=%220.04%22/%3E%3C/svg%3E')]" />

      {/* Top Bar */}
      <header className="sticky top-0 z-50 relative border-b border-white/[0.08] bg-black/40 backdrop-blur-xl supports-[backdrop-filter]:bg-black/25">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-2">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/10 hover:bg-white/[0.1] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-white/90" />
            </button>

            <div className="flex-1 min-w-0 text-center px-1">
              <h1 className="text-[15px] sm:text-base font-display font-bold text-white truncate leading-tight">
                {event?.title || "Event"}
              </h1>
              <p className="text-[11px] text-white/45 mt-0.5 truncate">
                {event?.time}
                {event?.venue ? ` · ${event.venue}` : " · Live room"}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold uppercase tracking-widest shadow-[0_0_24px_rgba(52,211,153,0.12)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  Live now
                </span>
                {queuedCount > 0 && !activeSessionId && !suppressDeckUiForConvergence && (
                  <span
                    className="inline-flex max-w-[min(200px,46vw)] truncate items-center gap-1 px-2 py-1 rounded-full bg-fuchsia-500/15 text-fuchsia-200 text-[10px] font-semibold border border-fuchsia-400/25"
                    title="Mutual matches are in the queue ahead of you. You will enter Ready Gate when promoted — not the same as being in Ready Gate right now."
                  >
                    <Sparkles className="w-3 h-3 shrink-0 opacity-90" />
                    {queuedCount === 1 ? "1 waiting in queue" : `${queuedCount} waiting in queue`}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0 w-[4.5rem] sm:w-auto sm:min-w-[5.5rem]">
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-full border tabular-nums ${
                  timeRemaining === "Ended"
                    ? "bg-amber-500/15 border-amber-400/30 text-amber-200"
                    : timerUrgent
                      ? "bg-amber-500/10 border-amber-400/25 text-amber-100"
                      : "bg-white/[0.06] border-white/10 text-white/75"
                }`}
              >
                <Clock className="w-3 h-3 shrink-0 opacity-80" />
                <span className="text-[11px] font-semibold font-display">{timeRemaining || "—"}</span>
              </div>
              <PremiumPill />
            </div>
          </div>

          {!suppressDeckUiForConvergence && !isEmpty && deckRemaining > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-white/40">
                <span className="flex items-center gap-1">
                  <Radio className="w-3 h-3 text-neon-cyan opacity-80" />
                  Deck
                </span>
                <span className="text-white/55 tabular-nums">
                  Next card ready
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-neon-cyan to-accent transition-[width] duration-300 ease-out"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Card Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-5 max-w-lg mx-auto w-full relative z-10">
        {suppressDeckUiForConvergence ? (
          <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center max-w-sm mx-auto w-full min-h-[min(280px,50vh)]">
            <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin shadow-[0_0_24px_hsl(var(--primary)/0.35)] mb-5" />
            <p className="text-lg font-display font-semibold text-white">
              {yieldingToVideoDateUi
                ? "Joining your date..."
                : showPostSurveyQueueCheck
                  ? postSurveyContinuityDecision.title
                  : "Opening Ready Gate..."}
            </p>
            <p className="text-sm text-white/55 mt-2">
              {yieldingToVideoDateUi
                ? "Taking you to the same video session as your match."
                : showPostSurveyQueueCheck
                  ? postSurveyContinuityDecision.message
                : "Syncing with your match. Almost there."}
            </p>
            {showPostSurveyQueueCheck && (
              <div className="mt-6 w-full">
                <CardSkeleton decision={postSurveyContinuityDecision} compact />
              </div>
            )}
          </div>
        ) : user?.isPaused ? (
          <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center max-w-sm mx-auto w-full">
            <Moon className="w-16 h-16 text-amber-400/25 mb-4" strokeWidth={1.25} aria-hidden />
            <h2 className="text-xl font-display font-semibold text-white mb-2">{"You're on a break"}</h2>
            <p className="text-sm text-white/50 mb-1">
              {user.pauseUntil && user.pauseUntil > new Date()
                ? `Discovery is paused until ${user.pauseUntil.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : "Discovery is paused"}
            </p>
            <p className="text-sm text-white/45 mb-6 leading-relaxed">
              {
                "Other people can't see you in the event deck right now. Your matches and chats stay active."
              }
            </p>
            <Button
              variant="outline"
              className="border-amber-400/40 text-amber-200 hover:bg-amber-500/10"
              disabled={endingBreak}
              onClick={() => {
                if (!user?.id) return;
                setEndingBreak(true);
                void (async () => {
                  try {
                    const { error } = await supabase
                      .from("profiles")
                      .update(END_ACCOUNT_BREAK_PROFILE_UPDATE)
                      .eq("id", user.id);
                    if (error) {
                      toast.error(error.message);
                      return;
                    }
                    await refreshProfile();
                    await queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user.id] });
                    toast.success("You're visible again.");
                  } finally {
                    setEndingBreak(false);
                  }
                })();
              }}
            >
              {endingBreak ? "Ending break..." : "End break & start discovering"}
            </Button>
          </div>
        ) : deckError && deckEnabled && profiles.length === 0 && !deckLoading ? (
          <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center max-w-sm mx-auto w-full gap-4">
            <p className="text-lg font-display font-semibold text-white">Couldn&apos;t load deck</p>
            <p className="text-sm text-white/55">
              We couldn&apos;t load people in this room. Check your connection and tap Retry.
            </p>
            <Button
              type="button"
              variant="outline"
              className="border-white/20 bg-white/[0.06] text-white hover:bg-white/10"
              onClick={() => void refetchDeck()}
            >
              Retry
            </Button>
          </div>
        ) : deckLoading && sortedProfiles.length === 0 && !deckError ? (
          <CardSkeleton decision={postSurveyReturnContext ? postSurveyContinuityDecision : undefined} />
        ) : isEmpty ? (
          <LobbyEmptyState
            eventId={eventId}
            onRefresh={refetchDeck}
            badge={postSurveyReturnContext ? postSurveyContinuityDecision.title : undefined}
            title={postSurveyReturnContext ? postSurveyContinuityDecision.title : undefined}
            message={postSurveyReturnContext ? postSurveyContinuityDecision.message : undefined}
          />
        ) : (
          <div className="w-full space-y-3">
            {checkingNextDateAfterSurvey && postSurveyReturnContext && (
              <PostSurveyLobbyStatus decision={postSurveyContinuityDecision} />
            )}
            <div className="text-center px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Discover</p>
              <p className="text-sm text-white/70 font-medium mt-0.5">Swipe fast — vibes are live in this room</p>
            </div>
          <div className="relative w-full" style={{ aspectRatio: "3/4", maxHeight: "min(62vh, 520px)" }}>
            {thirdProfile && (
              <div className="absolute inset-0 scale-[0.92] opacity-30 pointer-events-none translate-y-2">
                <LobbyProfileCard profile={thirdProfile} userVibes={userVibes} isBehind />
              </div>
            )}
            {nextProfile && (
              <div className="absolute inset-0 scale-[0.96] opacity-60 pointer-events-none translate-y-1">
                <LobbyProfileCard profile={nextProfile} userVibes={userVibes} isBehind />
              </div>
            )}

            <AnimatePresence mode="wait">
              {currentProfile && (
                <SwipeableCard
                  key={currentProfile.id}
                  profile={currentProfile}
                  userVibes={userVibes}
                  onSwipeLeft={handlePass}
                  onSwipeRight={handleVibe}
                  disabled={isProcessing || !lobbyActionsEnabled}
                />
              )}
            </AnimatePresence>
          </div>
          </div>
        )}

        {/* Action Buttons */}
        {!suppressDeckUiForConvergence && !isEmpty && currentProfile && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 mt-6 w-full max-w-xs mx-auto"
          >
            <div className="flex items-center justify-center gap-5 sm:gap-6 w-full">
            {/* Pass */}
            <button
              type="button"
              onClick={handlePass}
              disabled={isProcessing || !lobbyActionsEnabled}
              className="w-[58px] h-[58px] rounded-full bg-white/[0.04] border-2 border-white/12 flex items-center justify-center hover:bg-rose-500/10 hover:border-rose-400/35 transition-all active:scale-[0.92] disabled:opacity-40 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
              aria-label="Pass"
            >
              <X className="w-7 h-7 text-white/55" strokeWidth={2.25} />
            </button>

            {/* Super Vibe */}
            <button
              type="button"
              onClick={handleSuperVibe}
              disabled={isProcessing || !lobbyActionsEnabled || superVibeRemaining <= 0}
              className="relative w-[52px] h-[52px] rounded-full bg-neon-yellow/12 border-2 border-neon-yellow/50 flex items-center justify-center hover:bg-neon-yellow/22 transition-all active:scale-[0.92] disabled:opacity-30 shadow-[0_0_28px_hsl(var(--neon-yellow)/0.2)]"
              aria-label="Super vibe"
            >
              <Star className="w-[22px] h-[22px] text-neon-yellow" fill="hsl(var(--neon-yellow))" />
              {superVibeRemaining > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[22px] h-[22px] px-1 rounded-full bg-neon-yellow text-zinc-950 text-[10px] font-bold flex items-center justify-center border-2 border-zinc-950">
                  {superVibeRemaining}
                </span>
              )}
            </button>

            {/* Vibe */}
            <button
              type="button"
              onClick={handleVibe}
              disabled={isProcessing || !lobbyActionsEnabled}
              className="w-[58px] h-[58px] rounded-full bg-gradient-to-br from-primary via-fuchsia-500 to-accent flex items-center justify-center hover:shadow-[0_0_36px_hsl(var(--primary)/0.45)] transition-all active:scale-[0.92] disabled:opacity-40 border border-white/20 neon-glow-pink"
              aria-label="Vibe"
            >
              <Heart className="w-7 h-7 text-primary-foreground drop-shadow-sm" fill="white" />
            </button>
            </div>
            <p className="text-[10px] text-white/35 text-center font-medium tracking-wide">
              Pass · Super · Vibe
            </p>
          </motion.div>
        )}
      </main>

      {/* Ready Gate Overlay */}
      <AnimatePresence>
        {readyGateOverlayAllowed && activeSessionId && eventId && (
          <ReadyGateOverlay
            sessionId={activeSessionId}
            eventId={eventId}
            onNavigateToDate={navigateToDateSession}
            onManualExitConfirmed={suppressReadyGateSessionAfterManualExit}
            onClose={() => {
              clearReadyGateSession("ready_gate_overlay_close");
              scheduleLobbyConvergenceRefresh(activeSessionId, "ready_gate_overlay_close");
              if (eventId && user?.id) {
                scheduleDeferredLobbyWork("ready_gate_overlay_close_deck_refresh", () => {
                  void queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user.id] });
                });
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const LobbyUnavailableState = ({
  gate,
  eventId,
  onNavigate,
}: {
  gate: EventLobbyGateState;
  eventId: string | undefined;
  onNavigate: ReturnType<typeof useNavigate>;
}) => {
  const handleAction = () => {
    if (gate.redirectTo === "auth") {
      onNavigate("/auth", { replace: true });
      return;
    }
    if (gate.redirectTo === "events") {
      onNavigate("/events", { replace: true });
      return;
    }
    if (gate.redirectTo === "matches") {
      onNavigate("/matches", { replace: true });
      return;
    }
    if (gate.redirectTo === "dashboard" || !eventId) {
      onNavigate("/dashboard", { replace: true });
      return;
    }
    onNavigate(`/events/${eventId}`, { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-zinc-950 px-4 py-8 text-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, hsl(var(--neon-violet) / 0.18) 0%, transparent 50%), radial-gradient(ellipse 80% 50% at 100% 60%, hsl(var(--neon-cyan) / 0.06) 0%, transparent 45%), linear-gradient(180deg, hsl(240 10% 6%) 0%, hsl(240 8% 4%) 40%, hsl(0 0% 2%) 100%)",
        }}
      />
      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-white/[0.12] bg-zinc-950/80 p-7 text-center shadow-[0_24px_80px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
          <AlertCircle className="h-7 w-7 text-white/70" strokeWidth={1.6} />
        </div>
        <h1 className="text-xl font-display font-bold text-white">{gate.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{gate.message}</p>
        <Button
          type="button"
          onClick={handleAction}
          className="mt-6 w-full rounded-2xl bg-gradient-to-r from-primary to-accent text-primary-foreground"
        >
          {gate.actionLabel}
        </Button>
      </div>
    </div>
  );
};

/* ---------- Swipeable wrapper ---------- */

interface SwipeableCardProps {
  profile: DeckProfile;
  userVibes: string[];
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  disabled?: boolean;
}

const SwipeableCard = ({ profile, userVibes, onSwipeLeft, onSwipeRight, disabled }: SwipeableCardProps) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-5, 0, 5]);
  const vibeOpacity = useTransform(x, [0, 100], [0, 1]);
  const passOpacity = useTransform(x, [-100, 0], [1, 0]);
  const cardOpacity = useTransform(x, [-200, -100, 0, 100, 200], [0.5, 0.8, 1, 0.8, 0.5]);

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (disabled) return;
    const threshold = 100;
    if (info.offset.x > threshold) {
      haptics.light();
      onSwipeRight();
    } else if (info.offset.x < -threshold) {
      onSwipeLeft();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
      style={{ x, rotate, opacity: cardOpacity }}
      drag={disabled ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      {/* Swipe indicators */}
      <motion.div
        className="absolute top-6 left-6 z-20 px-4 py-2 rounded-xl border-2 border-green-400 bg-green-500/20 backdrop-blur-sm"
        style={{ opacity: vibeOpacity }}
      >
        <span className="text-green-400 font-display font-bold text-lg">VIBE</span>
      </motion.div>
      <motion.div
        className="absolute top-6 right-6 z-20 px-4 py-2 rounded-xl border-2 border-destructive bg-destructive/20 backdrop-blur-sm"
        style={{ opacity: passOpacity }}
      >
        <span className="text-destructive font-display font-bold text-lg">PASS</span>
      </motion.div>

      <LobbyProfileCard profile={profile} userVibes={userVibes} />
    </motion.div>
  );
};

/* ---------- Card Skeleton ---------- */

const PostSurveyLobbyStatus = ({ decision }: { decision: PostDateContinuityDecision }) => {
  const toneClass =
    decision.tone === "ready"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
      : decision.tone === "last_chance"
        ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
        : "border-white/10 bg-white/[0.05] text-white/75";

  return (
    <div className={`rounded-2xl border px-3.5 py-3 text-left ${toneClass}`} aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-35" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current opacity-80" />
        </span>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em]">{decision.title}</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-white/55">{decision.message}</p>
    </div>
  );
};

const CardSkeleton = ({
  decision,
  compact,
}: {
  decision?: PostDateContinuityDecision;
  compact?: boolean;
}) => (
  <div
    className="relative w-full rounded-3xl overflow-hidden border border-white/[0.1] bg-zinc-900/80 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.75)]"
    style={{ aspectRatio: "3/4", maxHeight: compact ? "min(34vh, 320px)" : "min(62vh, 520px)" }}
  >
    <div className="w-full h-full min-h-[280px] shimmer-effect opacity-80" />
    <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none rounded-b-3xl" />
    {decision && (
      <div className="absolute left-4 right-4 bottom-4 rounded-2xl border border-white/10 bg-black/45 px-3 py-2.5 text-left backdrop-blur-md">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/75">
          {decision.title}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-white/50">{decision.message}</p>
      </div>
    )}
  </div>
);

export default EventLobby;
