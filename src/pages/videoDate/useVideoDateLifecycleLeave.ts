import { useCallback, useEffect } from "react";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import * as Sentry from "@sentry/react";
import {
  TERMINAL_SURVEY_RECONCILE_INTERVAL_MS,
  VideoDateEndReason,
  VideoDateManualExitStepStatus,
  runVideoDateManualExitStep,
  serializeManualExitError,
} from "./videoDatePageShared";
import {
  clearDateEntryTransition,
  clearVideoDateRouteOwnership,
  suppressDateNavigationAfterManualExit,
} from "@/lib/videoDateNavigationIntents";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { sendVideoDateSignalWithRetry } from "@clientShared/matching/videoDateSignalRetry";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { vdbg, vdbgRedirect } from "@/lib/vdbg";
import { videoSessionHasEncounterExposureTruth } from "@clientShared/matching/activeSession";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { VideoDateEntryTruth } from "@clientShared/matching/videoDateEntryPersistence";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useVideoCall } from "@/hooks/useVideoCall";
import type {
  CallPhase,
  VideoDateAccess,
  VideoDateEndReason,
} from "./videoDatePageShared";
import type { TerminalSurveyRecoveryApi } from "./useTerminalSurveyRecovery";

/**
 * Lifecycle-leave concern of the web Video Date page (Video Date rebuild
 * PR 7.5 extraction; bodies verbatim from src/pages/VideoDate.tsx).
 *
 * Owns manual-exit semantics: the pre-date server-end signal (with
 * background retry), pre-date exits, the leave flow, end-date confirmation,
 * and peer-missing terminal handling. Manual exits stay destructive and
 * server-signaled; post-encounter peer-missing terminal ends stay
 * suppressed (provider absence is server-owned after an encounter).
 */

type UseVideoDateLifecycleLeaveDeps = Pick<
  TerminalSurveyRecoveryApi,
  "recoverTerminalPostDateSurvey"
> &
  Pick<
    ReturnType<typeof useVideoCall>,
    | "clearPeerMissing"
    | "endCall"
    | "isConnected"
    | "isConnecting"
    | "mediaPermissionError"
    | "peerMissing"
    | "remotePlayback"
  > & {
    clearEntryGraceState: () => void;
    dateStartedAt: string | null;
    entryTruth: VideoDateEntryTruth | null;
    eventId: string | undefined;
    explicitEndRequestedRef: MutableRefObject<"idle" | "sending" | "acked">;
    handleCallEnd: (reason?: VideoDateEndReason) => Promise<void>;
    hasEnteredDateFlowRef: MutableRefObject<boolean>;
    id: string | undefined;
    isEndDateConfirming: boolean;
    isLeavingVideoDate: boolean;
    manualExitInFlightRef: MutableRefObject<boolean>;
    navigate: NavigateFunction;
    phase: CallPhase;
    phaseRef: MutableRefObject<CallPhase>;
    setCallStarted: Dispatch<SetStateAction<boolean>>;
    setCallStartFailure: Dispatch<
      SetStateAction<
        import("@/hooks/useVideoCall").VideoCallStartFailure | null
      >
    >;
    setIsEndDateConfirming: Dispatch<SetStateAction<boolean>>;
    setIsLeavingVideoDate: Dispatch<SetStateAction<boolean>>;
    setPhase: Dispatch<SetStateAction<CallPhase>>;
    setShowEndDateConfirm: Dispatch<SetStateAction<boolean>>;
    setShowFeedback: Dispatch<SetStateAction<boolean>>;
    setStatus: ReturnType<typeof useEventStatus>["setStatus"];
    setTimeLeft: Dispatch<SetStateAction<number | null>>;
    showFeedback: boolean;
    surveyOpenedRef: MutableRefObject<boolean>;
    terminalSurveyRecoveryActive: boolean;
    terminalSurveyRecoveryInFlightRef: MutableRefObject<boolean>;
    user: User | null;
    videoDateAccess: VideoDateAccess;
  };

export function useVideoDateLifecycleLeave(
  deps: UseVideoDateLifecycleLeaveDeps,
) {
  const {
    clearEntryGraceState,
    clearPeerMissing,
    dateStartedAt,
    endCall,
    entryTruth,
    eventId,
    explicitEndRequestedRef,
    handleCallEnd,
    hasEnteredDateFlowRef,
    id,
    isConnected,
    isConnecting,
    isEndDateConfirming,
    isLeavingVideoDate,
    manualExitInFlightRef,
    mediaPermissionError,
    navigate,
    peerMissing,
    phase,
    phaseRef,
    recoverTerminalPostDateSurvey,
    remotePlayback,
    setCallStarted,
    setCallStartFailure,
    setIsEndDateConfirming,
    setIsLeavingVideoDate,
    setPhase,
    setShowEndDateConfirm,
    setShowFeedback,
    setStatus,
    setTimeLeft,
    showFeedback,
    surveyOpenedRef,
    terminalSurveyRecoveryActive,
    terminalSurveyRecoveryInFlightRef,
    user,
    videoDateAccess,
  } = deps;

  const resolveVideoDateExitTarget = useCallback(
    (overrideEventId?: string | null) => {
      const destinationEventId = overrideEventId ?? eventId;
      return destinationEventId
        ? `/event/${encodeURIComponent(destinationEventId)}/lobby`
        : "/events";
    },
    [eventId],
  );

  const signalPreDateManualEnd = useCallback(
    async (reason: VideoDateEndReason) => {
      if (!id) return false;
      const args = {
        p_session_id: id,
        p_action: "end",
        p_reason: reason,
      };
      vdbg("video_date_transition_before", {
        action: "end",
        source: "manual_pre_date_exit",
        args,
      });
      const transitionResult = await sendVideoDateSignalWithRetry({
        sessionId: id,
        action: "end",
        operation: async (attempt, idempotencyKey) => {
          const { data, error } = await supabase.rpc(
            "video_date_transition",
            args,
          );
          vdbg("video_date_transition_after", {
            action: "end",
            source: "manual_pre_date_exit",
            ok: !error,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
            attempt,
            idempotencyKey,
          });
          if (error) throw error;
          return data;
        },
        isSuccess: (data) =>
          (data as { success?: boolean } | null)?.success !== false,
      });

      recordUserAction(
        transitionResult.ok
          ? "video_date_pre_date_exit_end_signal_succeeded"
          : "video_date_pre_date_exit_end_signal_failed",
        {
          surface: "video_date",
          session_id: id,
          phase: phaseRef.current,
          reason,
          attempts: transitionResult.attempts,
        },
      );
      return transitionResult.ok;
    },
    [id],
  );

  const retryPreDateManualEndInBackground = useCallback(
    (
      reason: VideoDateEndReason,
      source: string,
      firstStatus: VideoDateManualExitStepStatus,
    ) => {
      if (!id) return;
      window.setTimeout(() => {
        void signalPreDateManualEnd(reason).then(
          (ok) => {
            recordUserAction(
              ok
                ? "video_date_pre_date_exit_end_background_retry_succeeded"
                : "video_date_pre_date_exit_end_background_retry_failed",
              {
                surface: "video_date",
                session_id: id,
                phase: phaseRef.current,
                reason,
                source,
                first_status: firstStatus,
              },
            );
            if (!ok) {
              Sentry.captureMessage(
                "video_date_pre_date_exit_end_background_retry_failed",
                {
                  level: "warning",
                  tags: { surface: "video_date", flow: "manual_pre_date_exit" },
                  extra: {
                    session_id: id,
                    reason,
                    source,
                    first_status: firstStatus,
                  },
                },
              );
            }
          },
          (error) => {
            recordUserAction(
              "video_date_pre_date_exit_end_background_retry_exception",
              {
                surface: "video_date",
                session_id: id,
                phase: phaseRef.current,
                reason,
                source,
                first_status: firstStatus,
                error: serializeManualExitError(error),
              },
            );
            Sentry.captureException(error, {
              tags: { surface: "video_date", flow: "manual_pre_date_exit" },
              extra: {
                session_id: id,
                reason,
                source,
                first_status: firstStatus,
              },
            });
          },
        );
      }, 750);
    },
    [id, signalPreDateManualEnd],
  );

  const handlePreDateExit = useCallback(
    async (opts?: { reason?: VideoDateEndReason; source?: string }) => {
      const reason = opts?.reason ?? "ended_from_client";
      const source = opts?.source ?? "connection_overlay_leave";
      if (manualExitInFlightRef.current) return;
      manualExitInFlightRef.current = true;
      setIsLeavingVideoDate(true);
      recordUserAction("video_date_pre_date_leave_clicked", {
        surface: "video_date",
        session_id: id,
        phase: phaseRef.current,
        reason,
        source,
      });
      clearEntryGraceState();
      if (id) {
        clearDateEntryTransition(id);
        clearVideoDateRouteOwnership(id, user?.id ?? null);
        suppressDateNavigationAfterManualExit(id);
      }
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      void setStatus("browsing");

      const [dailyCleanup, serverEnd] = await Promise.all([
        runVideoDateManualExitStep("daily_cleanup", () => endCall(source)),
        runVideoDateManualExitStep("server_end", () =>
          signalPreDateManualEnd(reason),
        ),
      ]);
      if (serverEnd.status !== "completed") {
        retryPreDateManualEndInBackground(reason, source, serverEnd.status);
      }

      const target = resolveVideoDateExitTarget();
      recordUserAction("video_date_pre_date_leave_navigating", {
        surface: "video_date",
        session_id: id,
        phase: phaseRef.current,
        reason,
        source,
        daily_cleanup_status: dailyCleanup.status,
        server_end_status: serverEnd.status,
        target,
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source,
        daily_cleanup_status: dailyCleanup.status,
        server_end_status: serverEnd.status,
      });
      vdbgRedirect(target, "manual_pre_date_exit", {
        sessionId: id ?? null,
        eventId: eventId ?? null,
        reason,
        source,
        dailyCleanupStatus: dailyCleanup.status,
        serverEndStatus: serverEnd.status,
      });
      navigate(target, { replace: true });
    },
    [
      clearEntryGraceState,
      endCall,
      eventId,
      id,
      navigate,
      resolveVideoDateExitTarget,
      retryPreDateManualEndInBackground,
      setStatus,
      signalPreDateManualEnd,
      user?.id,
    ],
  );

  const handleLeave = useCallback(
    async (opts?: { reason?: VideoDateEndReason }) => {
      const hasDateEntryTruth =
        hasEnteredDateFlowRef.current ||
        phaseRef.current === "date" ||
        Boolean(dateStartedAt) ||
        videoSessionHasEncounterExposureTruth(entryTruth);
      if (!hasDateEntryTruth) {
        await handlePreDateExit({
          reason: opts?.reason ?? "ended_from_client",
          source: "pre_date_leave_button",
        });
        return;
      }

      recordUserAction("video_date_leave_clicked", {
        surface: "video_date",
        session_id: id,
        phase,
        reason: opts?.reason ?? "ended_from_client",
      });
      clearEntryGraceState();
      await endCall("user_leave_button");
      toast("You left the date — stay safe! 💚", { duration: 2000 });
      await handleCallEnd(opts?.reason);
    },
    [
      dateStartedAt,
      endCall,
      handleCallEnd,
      handlePreDateExit,
      clearEntryGraceState,
      entryTruth,
      id,
      phase,
    ],
  );

  const requestEndDateConfirmation = useCallback(() => {
    if (isLeavingVideoDate || isEndDateConfirming) return;
    setShowEndDateConfirm(true);
  }, [isEndDateConfirming, isLeavingVideoDate]);

  const confirmEndDate = useCallback(async () => {
    if (isLeavingVideoDate || isEndDateConfirming) return;
    setIsEndDateConfirming(true);
    try {
      await handleLeave();
      setShowEndDateConfirm(false);
    } finally {
      setIsEndDateConfirming(false);
    }
  }, [handleLeave, isEndDateConfirming, isLeavingVideoDate]);

  useEffect(() => {
    if (!peerMissing.terminal || !id) return;
    trackEvent(
      LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION,
      {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
      },
    );
  }, [eventId, id, peerMissing.terminal]);

  useEffect(() => {
    if (
      !id ||
      videoDateAccess !== "allowed" ||
      showFeedback ||
      terminalSurveyRecoveryActive ||
      phase === "ended"
    )
      return;
    if (mediaPermissionError) return;
    const shouldReconcileTerminalSurvey =
      peerMissing.terminal ||
      remotePlayback.playRejected ||
      isConnecting ||
      !isConnected;
    if (!shouldReconcileTerminalSurvey) return;

    let cancelled = false;
    let inFlight = false;
    const reconcileTerminalSurvey = async (source: string) => {
      if (
        cancelled ||
        inFlight ||
        surveyOpenedRef.current ||
        terminalSurveyRecoveryInFlightRef.current
      )
        return;
      if (explicitEndRequestedRef.current !== "idle") return;
      inFlight = true;
      try {
        await recoverTerminalPostDateSurvey(source);
      } finally {
        inFlight = false;
      }
    };

    void reconcileTerminalSurvey("peer_wait_terminal_reconcile_initial");
    const interval = window.setInterval(() => {
      void reconcileTerminalSurvey("peer_wait_terminal_reconcile_interval");
    }, TERMINAL_SURVEY_RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    id,
    videoDateAccess,
    showFeedback,
    terminalSurveyRecoveryActive,
    phase,
    mediaPermissionError,
    peerMissing.terminal,
    remotePlayback.playRejected,
    isConnecting,
    isConnected,
    recoverTerminalPostDateSurvey,
  ]);

  const handlePeerMissingRetry = useCallback(() => {
    if (!id) return;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_RETRY_TAP, {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
    });
    void (async () => {
      clearPeerMissing();
      setCallStartFailure(null);
      try {
        await endCall("peer_missing_retry");
      } finally {
        setCallStarted(false);
      }
    })();
  }, [clearPeerMissing, endCall, eventId, id]);

  const handlePeerMissingKeepWaiting = useCallback(() => {
    if (id) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
      });
    }
    clearPeerMissing();
  }, [clearPeerMissing, eventId, id]);

  const handlePeerMissingLeave = useCallback(() => {
    if (id) {
      trackEvent(
        LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP,
        {
          platform: "web",
          session_id: id,
          event_id: eventId ?? null,
        },
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source: "peer_missing_back_to_lobby",
      });
    }
    const hasDateEntryTruth =
      hasEnteredDateFlowRef.current ||
      phaseRef.current === "date" ||
      Boolean(dateStartedAt) ||
      videoSessionHasEncounterExposureTruth(entryTruth);
    if (hasDateEntryTruth) {
      void handleLeave({ reason: "partner_absent_after_confirmed_encounter" });
      return;
    }
    void handlePreDateExit({
      reason: "partial_join_peer_timeout",
      source: "peer_missing_back_to_lobby",
    });
  }, [
    dateStartedAt,
    eventId,
    handleLeave,
    handlePreDateExit,
    entryTruth,
    id,
  ]);

  useEffect(() => {
    if (phase === "date" || phase === "ended") {
      clearEntryGraceState();
    }
  }, [phase, clearEntryGraceState]);

  useEffect(() => {
    return () => {
      clearEntryGraceState();
    };
  }, [clearEntryGraceState]);
  return {
    resolveVideoDateExitTarget,
    signalPreDateManualEnd,
    retryPreDateManualEndInBackground,
    handlePreDateExit,
    handleLeave,
    requestEndDateConfirmation,
    confirmEndDate,
    handlePeerMissingRetry,
    handlePeerMissingKeepWaiting,
    handlePeerMissingLeave,
  };
}

export type VideoDateLifecycleLeaveApi = ReturnType<
  typeof useVideoDateLifecycleLeave
>;
