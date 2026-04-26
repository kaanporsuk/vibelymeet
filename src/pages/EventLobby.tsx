import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { ArrowLeft, X, Heart, Star, Clock, Sparkles, Moon, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isVdbgEnabled, vdbg } from "@/lib/vdbg";
import { haptics } from "@/lib/haptics";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventDetails, useIsRegisteredForEvent } from "@/hooks/useEventDetails";
import { useEventDeck, DeckProfile } from "@/hooks/useEventDeck";
import { useSwipeAction } from "@/hooks/useSwipeAction";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useMatchQueue } from "@/hooks/useMatchQueue";
import { useActiveSession } from "@/hooks/useActiveSession";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addMinutes, differenceInSeconds } from "date-fns";
import LobbyProfileCard from "@/components/lobby/LobbyProfileCard";
import LobbyEmptyState from "@/components/lobby/LobbyEmptyState";
import ReadyGateOverlay from "@/components/lobby/ReadyGateOverlay";
import { PremiumPill } from "@/components/premium/PremiumPill";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { useQueryClient } from "@tanstack/react-query";
import { END_ACCOUNT_BREAK_PROFILE_UPDATE } from "@/lib/endAccountBreak";
import { claimDateNavigation } from "@/lib/dateNavigationGuard";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from "@clientShared/matching/activeSession";
import {
  QUEUED_MATCH_TIMED_OUT_USER_MESSAGE,
  shouldAdvanceLobbyDeckAfterSwipe,
} from "@shared/matching/videoSessionFlow";

const READY_GATE_ACTIVE_STATUSES = new Set(["ready", "ready_a", "ready_b", "both_ready", "snoozed"]);

function lobbyDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[EventLobby] ${message}`, data ?? {});
}

function logVdbgSessionStage(message: string, sessionId: string, data?: Record<string, unknown>) {
  if (!isVdbgEnabled()) return;
  vdbg(message, { sessionId, ...(data ?? {}) });
  void supabase
    .from("video_sessions")
    .select("id, event_id, ready_gate_status, state, phase, handshake_started_at, ended_at, ready_gate_expires_at, daily_room_name")
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

  // Data hooks
  const { data: event, isLoading: eventLoading } = useEventDetails(eventId);
  const { data: regSnapshot, isLoading: regLoading } = useIsRegisteredForEvent(eventId, user?.id);
  const isConfirmedSeat = regSnapshot?.isConfirmed ?? false;
  const deckEnabled = Boolean(eventId && user?.id && !user.isPaused);
  const {
    profiles,
    isLoading: deckLoading,
    isError: deckError,
    refetch: refetchDeck,
  } = useEventDeck({
    eventId: eventId || "",
    enabled: deckEnabled,
  });
  const { setStatus, currentStatus } = useEventStatus({ eventId, enabled: !!eventId && !!user?.id });

  const [searchParams, setSearchParams] = useSearchParams();

  // Ready Gate overlay state (server-backed; optimistic updates via refetch)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dateNavigationSessionId, setDateNavigationSessionId] = useState<string | null>(null);
  const [checkingNextDateAfterSurvey, setCheckingNextDateAfterSurvey] = useState(false);
  const {
    activeSession: scopedSession,
    hydrated: sessionHydrated,
    refetch: refetchScopedSession,
  } = useActiveSession(user?.id, { eventId });
  const sameEventScopedSession = useMemo(() => {
    if (!sessionHydrated || !eventId || !scopedSession || scopedSession.eventId !== eventId) {
      return null;
    }
    return scopedSession;
  }, [sessionHydrated, eventId, scopedSession]);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeServerSessionRef = useRef<string | null>(null);
  const dateNavigationSessionIdRef = useRef<string | null>(null);
  const lobbyEnteredEventRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    dateNavigationSessionIdRef.current = dateNavigationSessionId;
  }, [dateNavigationSessionId]);

  useEffect(() => {
    activeServerSessionRef.current = sameEventScopedSession?.sessionId ?? activeSessionId ?? null;
  }, [sameEventScopedSession?.sessionId, activeSessionId]);

  const openReadyGateSession = useCallback((sessionId: string, source: string) => {
    if (!sessionId || dateNavigationSessionIdRef.current) return;
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
  }, [eventId]);

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
      navigate(`/date/${sessionId}`, { replace: true });
    },
    [eventId, location.pathname, navigate]
  );

  // Pending video session from post-date queue / push deep link (canonical + legacy query names)
  useEffect(() => {
    const pending =
      searchParams.get("pendingVideoSession") ?? searchParams.get("pendingMatch");
    if (pending) {
      searchParams.delete("pendingVideoSession");
      searchParams.delete("pendingMatch");
      setSearchParams(searchParams, { replace: true });
      void refetchScopedSession();
    }
  }, [searchParams, setSearchParams, refetchScopedSession]);

  // Track seen profile IDs to prevent duplicates on refetch (bump deckNonce when this changes).
  const seenProfileIds = useRef<Set<string>>(new Set());
  const [deckNonce, setDeckNonce] = useState(0);
  // Track whether the deck ever had profiles (to distinguish "initial empty" from "exhausted")
  const deckEverLoadedRef = useRef(false);
  const deckExhaustedFiredRef = useRef(false);
  const convergenceImpressionRef = useRef(false);
  const superVibeCountDiagLoggedRef = useRef<string | null>(null);

  useEffect(() => {
    seenProfileIds.current = new Set();
    setDeckNonce((n) => n + 1);
    deckEverLoadedRef.current = false;
    deckExhaustedFiredRef.current = false;
    activeSessionIdRef.current = null;
    dateNavigationSessionIdRef.current = null;
    setActiveSessionId(null);
    setDateNavigationSessionId(null);
  }, [eventId]);

  /** Remaining super vibes this event (server caps at 3 per event on event_swipes). */
  const [superVibeRemaining, setSuperVibeRemaining] = useState(3);
  const [userVibes, setUserVibes] = useState<string[]>([]);

  // Swipe action — show Ready Gate on immediate match
  const { swipe, isProcessing } = useSwipeAction({
    eventId: eventId || "",
    onVideoSessionReady: () => {
      void refetchScopedSession();
    },
    onVideoSessionQueued: () => {
      // Toast already handled by useSwipeAction
    },
  });

  // Queue drain / realtime — activates ready gate when a queued video session becomes ready
  const { queuedCount, refreshQueueCount, isDraining: queueDrainInFlight } = useMatchQueue({
    eventId,
    currentStatus: currentStatus || "browsing",
    onVideoSessionReady: () => {
      void refetchScopedSession();
    },
    onQueuedSessionExpired: () => {
      toast.info(QUEUED_MATCH_TIMED_OUT_USER_MESSAGE, { duration: 4200 });
    },
  });

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
    if (!user?.id || !eventId) return;
    const diagKey = `${eventId}:${user.id}`;
    let cancelled = false;
    void (async () => {
      try {
        const { count, error } = await supabase
          .from("event_swipes")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("actor_id", user.id)
          .eq("swipe_type", "super_vibe");
        if (cancelled) return;
        if (import.meta.env.DEV && superVibeCountDiagLoggedRef.current !== diagKey) {
          superVibeCountDiagLoggedRef.current = diagKey;
          if (error) {
            lobbyDebug("super_vibe_count_load_failed", {
              eventId,
              userId: user.id,
              sessionKind: sameEventScopedSession?.kind ?? null,
              sessionId: sameEventScopedSession?.sessionId ?? null,
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
            sessionKind: sameEventScopedSession?.kind ?? null,
            sessionId: sameEventScopedSession?.sessionId ?? null,
            message: "exception",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, eventId]);

  // Lobby presence only when no backend-owned active session is in flight.
  useEffect(() => {
    if (!eventId || lobbyEnteredEventRef.current === eventId) return;
    lobbyEnteredEventRef.current = eventId;
    trackEvent('lobby_entered', { event_id: eventId });
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !sessionHydrated) return;
    if (dateNavigationSessionId || activeSessionId || sameEventScopedSession) return;
    void setStatus("browsing");
  }, [eventId, sessionHydrated, dateNavigationSessionId, activeSessionId, sameEventScopedSession, setStatus]);

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
    if (!eventId || !user?.id) return;

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
  }, [eventId, user?.id, location.pathname, currentStatus, refreshQueueCount]);

  // Backend-truth-first: scoped active session for this event (ready gate vs /date)
  useEffect(() => {
    if (!sessionHydrated || !eventId) return;
    vdbg("lobby_mount_active_session", {
      eventId,
      hydrated: sessionHydrated,
      activeSessionExists: Boolean(sameEventScopedSession),
      activeSessionKind: sameEventScopedSession?.kind ?? null,
      activeSessionId: sameEventScopedSession?.sessionId ?? null,
      activeSessionQueueStatus: sameEventScopedSession?.queueStatus ?? null,
      stickySessionId: activeSessionIdRef.current,
    });
    if (sameEventScopedSession?.sessionId) {
      logVdbgSessionStage("lobby_mount_active_session_detail", sameEventScopedSession.sessionId, {
        eventId,
        activeSessionKind: sameEventScopedSession.kind,
        activeSessionQueueStatus: sameEventScopedSession.queueStatus ?? null,
      });
    }
    lobbyDebug("active session hydration observed", {
      hydrated: sessionHydrated,
      eventId,
      kind: sameEventScopedSession?.kind ?? null,
      sessionId: sameEventScopedSession?.sessionId ?? null,
      queueStatus: sameEventScopedSession?.queueStatus ?? null,
      stickySessionId: activeSessionIdRef.current,
    });
    if (sameEventScopedSession?.kind === "video") {
      navigateToDateSession(sameEventScopedSession.sessionId, "active_session_hydration");
      return;
    }
    if (sameEventScopedSession?.kind === "ready_gate") {
      openReadyGateSession(sameEventScopedSession.sessionId, "active_session_hydration");
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
    sameEventScopedSession?.kind,
    sameEventScopedSession?.sessionId,
    sameEventScopedSession?.queueStatus,
    navigateToDateSession,
    openReadyGateSession,
  ]);

  // Returning from video date / survey: fresh deck, no stale overlay.
  useEffect(() => {
    const st = location.state as { lobbyRefresh?: boolean } | null;
    if (!st?.lobbyRefresh || !eventId || !user?.id) return;
    setCheckingNextDateAfterSurvey(true);
    seenProfileIds.current = new Set();
    setDeckNonce((n) => n + 1);
    dateNavigationSessionIdRef.current = null;
    setDateNavigationSessionId(null);
    clearReadyGateSession("lobby_refresh");
    void queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user.id] });
    navigate(location.pathname + location.search, { replace: true, state: {} });
  }, [
    location.state,
    location.pathname,
    location.search,
    eventId,
    user?.id,
    navigate,
    queryClient,
    clearReadyGateSession,
  ]);

  useEffect(() => {
    if (!checkingNextDateAfterSurvey) return;
    if (queueDrainInFlight || !sessionHydrated) return;
    const timer = setTimeout(() => setCheckingNextDateAfterSurvey(false), 900);
    return () => clearTimeout(timer);
  }, [checkingNextDateAfterSurvey, queueDrainInFlight, sessionHydrated]);

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
            navigateToDateSession(currentRoomId, "registration_realtime");
            return;
          }

          if (queueStatus === "in_ready_gate" && currentRoomId) {
            lobbyDebug("ready gate detected from registration realtime", { sessionId: currentRoomId });
            openReadyGateSession(currentRoomId, "registration_realtime");
            return;
          }

          if (queueStatus === "in_ready_gate" || isActiveDateQueueStatus(queueStatus) || currentRoomId) {
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
  }, [user?.id, eventId, navigateToDateSession, openReadyGateSession]);

  useEffect(() => {
    if (!user?.id || !eventId) return;
    const channel = supabase
      .channel(`lobby-video-${eventId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const session = payload.new as Record<string, unknown>;
          const isParticipant =
            session.participant_1_id === user.id || session.participant_2_id === user.id;
          if (!isParticipant) return;
          const sessionId = typeof session.id === "string" ? session.id : null;
          if (!sessionId) return;

          if (canAttemptDailyRoomFromVideoSessionTruth(session) || isActiveVideoPhase(session)) {
            lobbyDebug("same-session active date detected from video session realtime", {
              sessionId,
              state: session.state,
              phase: session.phase,
              readyGateStatus: session.ready_gate_status,
              readyGateExpiresAt: session.ready_gate_expires_at,
            });
            navigateToDateSession(sessionId, "video_session_realtime");
            return;
          }

          const status = session.ready_gate_status;
          if (typeof status === "string" && READY_GATE_ACTIVE_STATUSES.has(status)) {
            openReadyGateSession(sessionId, "video_session_realtime");
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "video_sessions",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const session = payload.new as Record<string, unknown>;
          const isParticipant =
            session.participant_1_id === user.id || session.participant_2_id === user.id;
          if (!isParticipant) return;
          const sessionId = typeof session.id === "string" ? session.id : null;
          if (!sessionId) return;

          if (canAttemptDailyRoomFromVideoSessionTruth(session) || isActiveVideoPhase(session)) {
            navigateToDateSession(sessionId, "video_session_insert");
            return;
          }

          const status = session.ready_gate_status;
          if (typeof status === "string" && READY_GATE_ACTIVE_STATUSES.has(status)) {
            openReadyGateSession(sessionId, "video_session_insert");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, eventId, navigateToDateSession, openReadyGateSession]);

  // Event countdown timer
  useEffect(() => {
    if (!event) return;
    const endTime = addMinutes(event.eventDate, event.durationMinutes);

    const tick = () => {
      const diff = differenceInSeconds(endTime, new Date());
      if (diff <= 0) {
        setTimeRemaining("Ended");
        return;
      }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setTimeRemaining(`${m}:${String(s).padStart(2, "0")}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [event]);

  // Guards: redirect if not live or not registered
  useEffect(() => {
    if (eventLoading || regLoading || !event) return;

    if (event.status === "cancelled") {
      toast.error("This event was cancelled.", { duration: 3500 });
      navigate(`/events/${eventId}`, { replace: true });
      return;
    }

    const now = new Date();
    const endTime = addMinutes(event.eventDate, event.durationMinutes);
    const isLive = now >= event.eventDate && now < endTime;

    if (!isLive) {
      toast("This event isn't live yet.", { duration: 2500 });
      navigate(`/events/${eventId}`, { replace: true });
      return;
    }

    if (!isConfirmedSeat) {
      toast(
        regSnapshot?.isWaitlisted
          ? "You're on the waitlist — we'll notify you if a spot opens."
          : "Register for this event first!",
        { duration: 3000 }
      );
      navigate(`/events/${eventId}`, { replace: true });
    }
  }, [event, eventLoading, regLoading, regSnapshot, isConfirmedSeat, eventId, navigate]);

  // Filter out already-seen profiles, then sort: super vibes first
  const sortedProfiles = useMemo(() => {
    const filtered = profiles.filter((p) => !seenProfileIds.current.has(p.id));
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

  // Track deck loaded / exhausted
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

  const afterSuccessfulSwipe = useCallback(
    (targetId: string) => {
      seenProfileIds.current.add(targetId);
      setDeckNonce((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user?.id] });
    },
    [queryClient, eventId, user?.id]
  );

  const handleVibe = useCallback(async () => {
    if (!currentProfile || isProcessing) return;
    const targetId = currentProfile.id;
    haptics.light();
    const result = await swipe(targetId, "vibe");
    if (!result || result.success === false) return;

    const code = result.result === "swipe_recorded" ? "vibe_recorded" : result.result;
    if (!shouldAdvanceLobbyDeckAfterSwipe(code)) return;

    trackEvent("lobby_profile_swiped", { event_id: eventId, swipe_type: "vibe", profile_id: targetId });

    if (code === "match" || code === "match_queued") {
      haptics.medium();
    }

    afterSuccessfulSwipe(targetId);
  }, [currentProfile, isProcessing, swipe, afterSuccessfulSwipe, eventId]);

  const handlePass = useCallback(async () => {
    if (!currentProfile || isProcessing) return;
    const targetId = currentProfile.id;
    const result = await swipe(targetId, "pass");
    if (!result || result.success === false) return;

    const code = result.result;
    if (!shouldAdvanceLobbyDeckAfterSwipe(code)) return;

    trackEvent("lobby_profile_swiped", { event_id: eventId, swipe_type: "pass", profile_id: targetId });

    afterSuccessfulSwipe(targetId);
  }, [currentProfile, isProcessing, swipe, afterSuccessfulSwipe, eventId]);

  const handleSuperVibe = useCallback(async () => {
    if (!currentProfile || isProcessing) return;
    haptics.light();
    const targetId = currentProfile.id;
    const result = await swipe(targetId, "super_vibe");
    if (!result || result.success === false) return;

    const code = result.result;
    if (!shouldAdvanceLobbyDeckAfterSwipe(code)) return;

    if (code === "super_vibe_sent") {
      setSuperVibeRemaining((prev) => Math.max(0, prev - 1));
      trackEvent("super_vibe_used", { event_id: eventId, profile_id: targetId });
    }

    trackEvent("lobby_profile_swiped", { event_id: eventId, swipe_type: "super_vibe", profile_id: targetId });

    afterSuccessfulSwipe(targetId);
  }, [currentProfile, isProcessing, swipe, afterSuccessfulSwipe, eventId]);

  const yieldingToVideoDateUi = Boolean(dateNavigationSessionId || sameEventScopedSession?.kind === "video");
  const yieldingToReadyGateUi = Boolean(
    sameEventScopedSession?.kind === "ready_gate" &&
      activeSessionId !== sameEventScopedSession.sessionId
  );
  const showPostSurveyQueueCheck =
    checkingNextDateAfterSurvey && !yieldingToVideoDateUi && !yieldingToReadyGateUi;
  const suppressDeckUiForConvergence =
    yieldingToVideoDateUi || yieldingToReadyGateUi || showPostSurveyQueueCheck;

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
  if (eventLoading || regLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin shadow-[0_0_24px_hsl(var(--primary)/0.35)]" />
      </div>
    );
  }

  const isEmpty = sortedProfiles.length === 0;
  const deckRemaining = sortedProfiles.length;
  const deckPosition = deckRemaining > 0 ? 1 : 0;
  const deckProgress =
    profiles.length > 0 ? Math.min(1, (profiles.length - deckRemaining) / profiles.length) : 0;
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
                  {deckPosition} / {deckRemaining} left
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-neon-cyan to-accent transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.min(100, deckProgress * 100)}%` }}
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
                  ? "Finding your next date..."
                  : "Opening Ready Gate..."}
            </p>
            <p className="text-sm text-white/55 mt-2">
              {yieldingToVideoDateUi
                ? "Taking you to the same video session as your match."
                : showPostSurveyQueueCheck
                  ? "Checking your queue before we refresh the deck."
                : "Syncing with your match. Almost there."}
            </p>
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
          <CardSkeleton />
        ) : isEmpty ? (
          <LobbyEmptyState eventId={eventId} onRefresh={refetchDeck} />
        ) : (
          <div className="w-full space-y-3">
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
                  disabled={isProcessing}
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
              disabled={isProcessing}
              className="w-[58px] h-[58px] rounded-full bg-white/[0.04] border-2 border-white/12 flex items-center justify-center hover:bg-rose-500/10 hover:border-rose-400/35 transition-all active:scale-[0.92] disabled:opacity-40 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
              aria-label="Pass"
            >
              <X className="w-7 h-7 text-white/55" strokeWidth={2.25} />
            </button>

            {/* Super Vibe */}
            <button
              type="button"
              onClick={handleSuperVibe}
              disabled={isProcessing || superVibeRemaining <= 0}
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
              disabled={isProcessing}
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
        {activeSessionId && eventId && !yieldingToVideoDateUi && (
          <ReadyGateOverlay
            sessionId={activeSessionId}
            eventId={eventId}
            onNavigateToDate={navigateToDateSession}
            onClose={() => {
              clearReadyGateSession("ready_gate_overlay_close");
              setStatus("browsing");
              void refetchScopedSession();
              if (eventId && user?.id) {
                void queryClient.invalidateQueries({ queryKey: ["event-deck", eventId, user.id] });
              }
            }}
          />
        )}
      </AnimatePresence>
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

const CardSkeleton = () => (
  <div
    className="relative w-full rounded-3xl overflow-hidden border border-white/[0.1] bg-zinc-900/80 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.75)]"
    style={{ aspectRatio: "3/4", maxHeight: "min(62vh, 520px)" }}
  >
    <div className="w-full h-full min-h-[280px] shimmer-effect opacity-80" />
    <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none rounded-b-3xl" />
  </div>
);

export default EventLobby;
