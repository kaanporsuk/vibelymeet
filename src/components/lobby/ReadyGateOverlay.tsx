import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Sparkles, X } from "lucide-react";
import { useReadyGate } from "@/hooks/useReadyGate";
import { vdbg } from "@/lib/vdbg";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { prepareVideoDateEntry } from "@/lib/videoDatePrepareEntry";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { toast } from "sonner";
import { READY_GATE_STALE_OR_ENDED_USER_MESSAGE } from "@shared/matching/videoSessionFlow";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
  startReadyGateToDateLatencyContext,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from "@clientShared/matching/activeSession";
import {
  getReadyGateCountdownProgress,
  getReadyGateRemainingSeconds,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from "@clientShared/matching/readyGateCountdown";

interface ReadyGateOverlayProps {
  sessionId: string;
  eventId: string;
  onClose: () => void;
  onNavigateToDate: (sessionId: string, source: string) => void;
}

const GATE_TIMEOUT = READY_GATE_DEFAULT_TIMEOUT_SECONDS;
const ACTIVE_DATE_QUEUE_STATUSES = new Set(["in_handshake", "in_date"]);
const PREPARE_ENTRY_NAV_GRACE_MS = 900;

function readyGateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[ReadyGateOverlay] ${message}`, data ?? {});
}

const ReadyGateOverlay = ({ sessionId, eventId, onClose, onNavigateToDate }: ReadyGateOverlayProps) => {
  const { user } = useUserProfile();
  const { setStatus } = useEventStatus({ eventId, enabled: !!eventId && !!user?.id });

  const [partnerPhotos, setPartnerPhotos] = useState<string[] | null>(null);
  const [partnerAvatarUrl, setPartnerAvatarUrl] = useState<string | null>(null);
  const [sharedVibes, setSharedVibes] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [requestingSnooze, setRequestingSnooze] = useState(false);
  const closedRef = useRef(false);
  const dateNavigationStartedRef = useRef(false);
  const invalidCloseToastRef = useRef(false);
  const readyGateImpressionRef = useRef(false);
  const openingWaitImpressionRef = useRef(false);
  const terminalOutcomeRef = useRef(false);
  const timeoutForfeitSentRef = useRef(false);
  const fallbackGateDeadlineMsRef = useRef(Date.now() + GATE_TIMEOUT * 1000);
  const bothReadyObservedAtMsRef = useRef<number | null>(null);
  const prepareEntryHandoffStartedRef = useRef(false);

  const navigateToDate = useCallback(
    (source: string) => {
      if (dateNavigationStartedRef.current) return;
      dateNavigationStartedRef.current = true;
      closedRef.current = true;
      setIsTransitioning(true);
      readyGateDebug("success-path navigation to date", { sessionId, source });
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId,
        sourceSurface: "ready_gate_overlay",
        checkpoint: "navigation_started",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "navigation_started",
          sourceAction: source,
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source,
        source_surface: "ready_gate_overlay",
        source_action: source,
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_BOTH_READY, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source,
        source_surface: "ready_gate_overlay",
        source_action: source,
      });
      vdbg("lobby_navigate_to_date", {
        trigger: `ready_gate_overlay_${source}`,
        sessionId,
        eventId,
        target: `/date/${sessionId}`,
      });
      onNavigateToDate(sessionId, `ready_gate_overlay_${source}`);
    },
    [sessionId, eventId, onNavigateToDate]
  );

  const handleBothReady = useCallback(() => {
    if (closedRef.current && !dateNavigationStartedRef.current) return;
    if (prepareEntryHandoffStartedRef.current || dateNavigationStartedRef.current) return;
    prepareEntryHandoffStartedRef.current = true;
    const observedAtMs = Date.now();
    bothReadyObservedAtMsRef.current = observedAtMs;
    setIsTransitioning(true);
    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId,
      sourceSurface: "ready_gate_overlay",
      checkpoint: "both_ready_observed",
      nowMs: observedAtMs,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: latencyContext,
        checkpoint: "both_ready_observed",
        sourceAction: "both_ready_observed",
        outcome: "success",
      }),
    );
    trackEvent(LobbyPostDateEvents.READY_GATE_BOTH_READY_OBSERVED, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
      source: "both_ready",
      source_surface: "ready_gate_overlay",
      source_action: "both_ready_observed",
    });
    vdbg("ready_gate_both_ready_observed", {
      sessionId,
      eventId,
      source: "both_ready",
    });

    const fallback = window.setTimeout(() => {
      navigateToDate("both_ready_prepare_grace");
    }, PREPARE_ENTRY_NAV_GRACE_MS);

    void prepareVideoDateEntry(sessionId, {
      eventId,
      source: "ready_gate_both_ready",
      bothReadyObservedAtMs: observedAtMs,
    }).then((result) => {
      if (dateNavigationStartedRef.current) return;
      if (result.ok === true) {
        window.clearTimeout(fallback);
        navigateToDate("both_ready_prepare_success");
        return;
      }
      vdbg("ready_gate_prepare_entry_failed_before_nav", {
        sessionId,
        eventId,
        code: result.code,
        retryable: result.retryable,
      });
    });
  }, [eventId, navigateToDate, sessionId]);

  const handleForfeited = useCallback(
    (reason: "timeout" | "skip") => {
      if (closedRef.current || dateNavigationStartedRef.current) return;
      closedRef.current = true;
      readyGateDebug("terminal ready-gate close", { sessionId, reason });
      if (!terminalOutcomeRef.current) {
        terminalOutcomeRef.current = true;
        trackEvent(LobbyPostDateEvents.READY_GATE_TIMEOUT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          reason,
        });
      }
      setStatus("browsing");
      toast(reason === "timeout" ? "They weren't ready. Back to browsing — your deck is waiting." : "No worries — back to browsing 💚", {
        duration: 2500,
      });
      onClose();
    },
    [setStatus, onClose, sessionId, eventId]
  );

  const closeAsStale = useCallback(
    (source: string, detail?: Record<string, unknown>) => {
      if (closedRef.current || dateNavigationStartedRef.current) return;
      closedRef.current = true;
      readyGateDebug("stale ready-gate close", { sessionId, source, ...(detail ?? {}) });
      trackEvent(LobbyPostDateEvents.READY_GATE_STALE_CLOSE, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        reason: String((detail as { reason?: unknown } | undefined)?.reason ?? source),
      });
      if (!invalidCloseToastRef.current) {
        invalidCloseToastRef.current = true;
        toast.info(READY_GATE_STALE_OR_ENDED_USER_MESSAGE, { duration: 3600 });
      }
      onClose();
    },
    [onClose, sessionId, eventId]
  );

  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    expiresAt,
    markReady,
    skip,
    snooze,
    refetchSession,
  } = useReadyGate({
    sessionId,
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  const reconcileSession = useCallback(
    async (source: string) => {
      if (!sessionId || !eventId || !user?.id || dateNavigationStartedRef.current) return;

      const [{ data: reg, error: regError }, { data: vs, error: vsError }] = await Promise.all([
        supabase
          .from("event_registrations")
          .select("queue_status, current_room_id")
          .eq("event_id", eventId)
          .eq("profile_id", user.id)
          .maybeSingle(),
        supabase
          .from("video_sessions")
          .select("participant_1_id, participant_2_id, ended_at, state, phase, ready_gate_status, ready_gate_expires_at, handshake_started_at")
          .eq("id", sessionId)
          .maybeSingle(),
      ]);

      if (dateNavigationStartedRef.current) return;

      if (regError || vsError) {
        readyGateDebug("session reconciliation deferred after query error", {
          sessionId,
          source,
          regError: regError?.message,
          vsError: vsError?.message,
        });
        return;
      }

      const sameRoom = reg?.current_room_id === sessionId;
      const queueStatus = reg?.queue_status ?? null;
      const readyGateStatus = (vs?.ready_gate_status as string | null | undefined) ?? null;
      const isParticipant = vs?.participant_1_id === user.id || vs?.participant_2_id === user.id;
      const decision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      const routedTo =
        canAttemptDaily || decision === "navigate_date"
          ? "date"
          : decision === "navigate_ready"
            ? "ready"
            : "lobby";

      readyGateDebug("session reconciliation", {
        sessionId,
        source,
        queueStatus,
        sameRoom,
        decision,
        canAttemptDaily,
        routedTo,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
        readyGateStatus,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        isParticipant,
        ended: Boolean(vs?.ended_at),
      });
      vdbg("ready_gate_date_route_decision", {
        sessionId,
        eventId,
        source,
        decision,
        canAttemptDaily,
        routed_to: routedTo,
        queueStatus,
        currentRoomId: reg?.current_room_id ?? null,
        readyGateStatus,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        state: vs?.state ?? null,
        phase: vs?.phase ?? null,
      });

      if (!vs) {
        closeAsStale(source, {
          reason: "session_missing",
        });
        return;
      }

      if (!isParticipant) {
        closeAsStale(source, { reason: "not_session_participant" });
        return;
      }

      if (canAttemptDaily || decision === "navigate_date") {
        handleBothReady();
        return;
      }

      if (decision !== "navigate_ready") {
        closeAsStale(source, {
          reason: decision === "ended" ? "session_ended" : "session_not_ready_gate_eligible",
          queueStatus,
          currentRoomId: reg?.current_room_id ?? null,
        });
        return;
      }

      void refetchSession();
    },
    [sessionId, eventId, user?.id, handleBothReady, closeAsStale, refetchSession]
  );

  // Set status to in_ready_gate only when that will not overwrite active date truth.
  useEffect(() => {
    if (!sessionId || !eventId || !user?.id) return;
    let cancelled = false;
    void (async () => {
      const { data: reg } = await supabase
        .from("event_registrations")
        .select("queue_status, current_room_id")
        .eq("event_id", eventId)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (cancelled || dateNavigationStartedRef.current) return;
      if (reg?.current_room_id === sessionId && !ACTIVE_DATE_QUEUE_STATUSES.has(reg.queue_status ?? "")) {
        void setStatus("in_ready_gate");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, eventId, user?.id, setStatus]);

  useEffect(() => {
    void reconcileSession("initial");
  }, [reconcileSession]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id) return;
    const channel = supabase
      .channel(`ready-gate-reconcile-${sessionId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "event_registrations",
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.event_id !== eventId) return;
          const queueStatus = row.queue_status;
          const currentRoomId = row.current_room_id;
          if (currentRoomId === sessionId && ACTIVE_DATE_QUEUE_STATUSES.has(String(queueStatus))) {
            readyGateDebug("same-session active date detected from registration realtime", {
              sessionId,
              queueStatus,
            });
            handleBothReady();
            return;
          }
          void reconcileSession("registration_realtime");
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (
            canAttemptDailyRoomFromVideoSessionTruth(row) ||
            decideVideoSessionRouteFromTruth(row) === "navigate_date"
          ) {
            readyGateDebug("same-session active date detected from video session realtime", {
              sessionId,
              state: row.state,
              phase: row.phase,
              readyGateStatus: row.ready_gate_status,
              readyGateExpiresAt: row.ready_gate_expires_at,
            });
            handleBothReady();
            return;
          }
          void reconcileSession("video_session_realtime");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, eventId, user?.id, handleBothReady, reconcileSession]);

  useEffect(() => {
    if (!sessionId || !eventId || !user?.id || dateNavigationStartedRef.current) return;
    const intervalId = setInterval(() => {
      void reconcileSession("poll");
    }, 2000);
    return () => clearInterval(intervalId);
  }, [sessionId, eventId, user?.id, reconcileSession]);

  useEffect(() => {
    if (iAmReady) setMarkingReady(false);
  }, [iAmReady]);

  useEffect(() => {
    closedRef.current = false;
    dateNavigationStartedRef.current = false;
    invalidCloseToastRef.current = false;
    readyGateImpressionRef.current = false;
    openingWaitImpressionRef.current = false;
    terminalOutcomeRef.current = false;
    timeoutForfeitSentRef.current = false;
    bothReadyObservedAtMsRef.current = null;
    prepareEntryHandoffStartedRef.current = false;
    fallbackGateDeadlineMsRef.current = Date.now() + GATE_TIMEOUT * 1000;
    setIsTransitioning(false);
    setMarkingReady(false);
    setRequestingSnooze(false);
    setTimeLeft(GATE_TIMEOUT);
    if (!readyGateImpressionRef.current) {
      readyGateImpressionRef.current = true;
      const latencyContext = startReadyGateToDateLatencyContext({
        platform: "web",
        sessionId,
        eventId,
        sourceSurface: "ready_gate_overlay",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_STARTED,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "ready_gate_impression",
          sourceAction: "impression",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.READY_GATE_IMPRESSION, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "ready_gate_overlay",
        source_action: "impression",
      });
    }
  }, [sessionId, eventId]);

  useEffect(() => {
    if (isTransitioning || !iAmReady || partnerReady || snoozedByPartner) return;
    if (openingWaitImpressionRef.current) return;
    openingWaitImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.READY_GATE_OPENING_WAIT_IMPRESSION, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
    });
  }, [eventId, iAmReady, isTransitioning, partnerReady, sessionId, snoozedByPartner]);

  // Fetch partner photo + shared vibes
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    (async () => {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!session) return;

      const partnerId =
        session.participant_1_id === user.id
          ? session.participant_2_id
          : session.participant_1_id;

      // Partner photo + vibes through the session-aware profile RPC.
      const { data: profile } = await supabase.rpc("get_profile_for_viewer", {
        p_target_id: partnerId,
      });

      const partnerProfile = profile as { avatar_url?: string | null; photos?: string[] | null; vibes?: string[] | null } | null;
      if (partnerProfile) {
        setPartnerPhotos(partnerProfile.photos || null);
        setPartnerAvatarUrl(partnerProfile.avatar_url || null);
      }

      // Shared vibes
      const { data: myVibes } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label, emoji)")
        .eq("profile_id", user.id);

      if (myVibes && partnerProfile?.vibes) {
        const myLabels = new Set(
          myVibes
            .map((v) => {
              const raw = v.vibe_tags as { label: string } | { label: string }[] | null;
              const tag = Array.isArray(raw) ? raw[0] : raw;
              return tag?.label;
            })
            .filter(Boolean)
        );
        const shared = partnerProfile.vibes.filter((label) => myLabels.has(label));
        setSharedVibes(shared);
      }
    })();
  }, [sessionId, user?.id]);

  // Countdown timer (only when user hasn't pressed ready yet)
  useEffect(() => {
    if (isTransitioning || iAmReady || snoozedByPartner) return;

    const tick = () => {
      const next = getReadyGateRemainingSeconds({
        expiresAt,
        fallbackDeadlineMs: fallbackGateDeadlineMsRef.current,
      });
      setTimeLeft(next);
      if (next <= 0 && !timeoutForfeitSentRef.current) {
        timeoutForfeitSentRef.current = true;
        void skip();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [isTransitioning, iAmReady, snoozedByPartner, expiresAt, skip]);

  const progress = getReadyGateCountdownProgress(timeLeft, GATE_TIMEOUT);
  const ringSize = 96;
  const strokeWidth = 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => {}} />

      {/* Transitioning to video */}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-10 bg-background flex items-center justify-center"
          >
            <div className="text-center space-y-4">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Sparkles className="w-12 h-12 text-primary mx-auto" />
              </motion.div>
              <p className="text-lg font-display font-semibold text-foreground">
                Joining your date...
              </p>
              <p className="text-sm text-muted-foreground">This should only take a moment.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <motion.div
        initial={{ y: 100, scale: 0.95, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 100, scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-white/10 overflow-hidden mb-4 sm:mb-0"
        style={{
          background:
            "linear-gradient(145deg, hsl(var(--card)), hsl(var(--card) / 0.95))",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="p-6 space-y-5">
          {/* Heading */}
          <div className="text-center space-y-1">
            <h2 className="text-xl font-display font-bold text-foreground">
              Ready to vibe?
            </h2>
            <p className="text-sm text-muted-foreground">
              You matched with {partnerName || "someone"}.
            </p>
          </div>

          {/* Blurred partner photo */}
          <div className="flex justify-center">
            <div className="relative w-28 h-28 rounded-full overflow-hidden border-2 border-primary/30">
              <div style={{ filter: "blur(15px)" }}>
                <ProfilePhoto
                  photos={partnerPhotos}
                  avatarUrl={partnerAvatarUrl}
                  name={partnerName || "Match"}
                  size="full"
                  rounded="full"
                  loading="eager"
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="text-white font-display font-semibold text-sm">
                  {partnerName || "Match"}
                </span>
              </div>
            </div>
          </div>

          {/* Shared vibes */}
          {sharedVibes.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {sharedVibes.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Partner ready indicator */}
          <AnimatePresence>
            {partnerReady && !iAmReady && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 py-2"
              >
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400 font-medium">
                  {partnerName} is ready!
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Snoozed by partner */}
          <AnimatePresence>
            {snoozedByPartner && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 py-2"
              >
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {partnerName} needs a moment...
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action area */}
          {!iAmReady ? (
            <div className="space-y-3">
              {/* Ready button with countdown ring */}
              <div className="flex justify-center">
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    if (markingReady || requestingSnooze) return;
                    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
                      sessionId,
                      platform: "web",
                      eventId,
                      sourceSurface: "ready_gate_overlay",
                      checkpoint: "ready_tap",
                    });
                    trackEvent(
                      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                      buildReadyGateToDateLatencyPayload({
                        context: latencyContext,
                        checkpoint: "ready_tap",
                        sourceAction: "ready_tap",
                        outcome: "success",
                      }),
                    );
                    trackEvent(LobbyPostDateEvents.READY_GATE_READY_TAP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      source_surface: "ready_gate_overlay",
                      source_action: "ready_tap",
                    });
                    trackEvent(LobbyPostDateEvents.VIDEO_DATE_READY_GATE_READY, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      source_surface: "ready_gate_overlay",
                      source_action: "ready_tap",
                    });
                    setMarkingReady(true);
                    void (async () => {
                      try {
                        await markReady();
                      } finally {
                        setMarkingReady(false);
                      }
                    })();
                  }}
                  disabled={markingReady || requestingSnooze}
                  className="relative"
                >
                  <svg
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                    className="absolute inset-0 -rotate-90"
                  >
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth={strokeWidth}
                      opacity={0.3}
                    />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      className="transition-all duration-1000 linear"
                    />
                  </svg>
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
                    <span className="text-sm font-display font-bold text-primary-foreground text-center leading-tight px-1">
                      {markingReady ? "Marking ready..." : "I'm Ready ✨"}
                    </span>
                  </div>
                </motion.button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Snooze gives you up to 2 extra minutes. Step away exits this match attempt.
              </p>

              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => {
                    if (requestingSnooze || markingReady) return;
                    trackEvent(LobbyPostDateEvents.READY_GATE_SNOOZE_TAP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                    });
                    setRequestingSnooze(true);
                    void (async () => {
                      try {
                        await snooze();
                      } finally {
                        setRequestingSnooze(false);
                      }
                    })();
                  }}
                  disabled={requestingSnooze || markingReady}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {requestingSnooze ? "Snoozing..." : "Snooze — give me 2 min"}
                </button>
                <span className="text-muted-foreground/70">·</span>
                <button
                  onClick={() => {
                    if (dateNavigationStartedRef.current || markingReady || requestingSnooze) return;
                    trackEvent(LobbyPostDateEvents.READY_GATE_NOT_NOW_TAP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      dismiss_variant: "skip_this_one",
                    });
                    closedRef.current = true;
                    skip();
                    setStatus("browsing");
                    onClose();
                  }}
                  disabled={markingReady || requestingSnooze}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Step away
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary/10 border border-primary/20"
              >
                <Check className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  You're ready. Waiting for {partnerName}...
                </span>
              </motion.div>
              <button
                onClick={() => {
                  if (dateNavigationStartedRef.current || requestingSnooze || markingReady) return;
                  trackEvent(LobbyPostDateEvents.READY_GATE_NOT_NOW_TAP, {
                    platform: "web",
                    session_id: sessionId,
                    event_id: eventId,
                    dismiss_variant: "cancel_go_back",
                  });
                  closedRef.current = true;
                  skip();
                  setStatus("browsing");
                  onClose();
                }}
                disabled={requestingSnooze || markingReady}
                className="block mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Step away
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ReadyGateOverlay;
