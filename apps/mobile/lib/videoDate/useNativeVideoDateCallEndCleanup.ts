import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";
import {
  useAuth,
} from "@/context/AuthContext";
import {
  eventLobbyHref,
  tabsRootHref,
} from "@/lib/activeSessionRoutes";
import {
  trackEvent,
} from "@/lib/analytics";
import {
  type ActiveNativeDailyCallIdentity,
  type DailyCallObject,
  destroyNativeVideoDateDailyCall,
  type NativeDailyCleanupOptions,
  safeNativeDailyMeetingState,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  vdbg,
} from "@/lib/vdbg";
import {
  useNativeDailyAliveHeartbeat,
} from "@/lib/videoDate/useNativeDailyAliveHeartbeat";
import {
  addVideoDateBreadcrumb,
  type DailyTokenRefreshSourceAction,
  type NativeTerminalSurveySessionRow,
  type NativeVideoDateEndReason,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  endVideoDate,
  markReconnectPartnerAway,
  syncVideoDateReconnect,
  useVideoDateSession,
} from "@/lib/videoDateApi";
import {
  type NativeVideoDateCaptureProfile,
} from "@/lib/videoDateDailyMediaConfig";
import {
  clearDateEntryTransition,
  clearVideoDateRouteOwnership,
} from "@/lib/videoDateNavigationIntents";
import {
  LobbyPostDateEvents,
} from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  videoSessionHasEncounterExposureTruth,
} from "@clientShared/matching/activeSession";
import {
  type VideoDateSafetySubmitOutcome,
} from "@clientShared/safety/videoDateSafetyCopy";
import {
  type DailyParticipant,
} from "@daily-co/react-native-daily-js";
import {
  router,
} from "expo-router";
import {
  Alert,
} from "react-native";
import type { NativeVideoDateCallListenersApi } from "./useNativeVideoDateCallListeners";

/**
 * Call end + cleanup concern of the native Video Date screen: Daily/local-state cleanup, abort-without-server-end, server terminal truth fetch, handleCallEnd and the in-call report end paths.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeVideoDateCallEndCleanupDeps {
  activeNativeDailyCallIdentityRef: MutableRefObject<ActiveNativeDailyCallIdentity | null>;
  callRef: MutableRefObject<DailyCallObject | null>;
  captureProfileRef: MutableRefObject<NativeVideoDateCaptureProfile>;
  clearDailyAliveHeartbeatTimer: ReturnType<typeof useNativeDailyAliveHeartbeat>["clearDailyAliveHeartbeatTimer"];
  clearDailyTokenRefreshTimer: () => void;
  clearEntryGraceState: () => void;
  clearFirstConnectWatchdog: () => void;
  clearPartnerAwayAfterTransportGrace: (reason: string) => void;
  confirmNativeTerminalPostDateRecovery: ( source: string, sessionOverride?: NativeTerminalSurveySessionRow | null, ) => Promise<boolean>;
  countdownCompletionKeyRef: MutableRefObject<string | null>;
  dailyTokenExpiresAtRef: MutableRefObject<string | null>;
  dailyTokenRecoveryInFlightRef: MutableRefObject<boolean>;
  dateEstablishedRef: MutableRefObject<boolean>;
  detachCallListeners: NativeVideoDateCallListenersApi["detachCallListeners"];
  eventId: string;
  handleCallEndRef: MutableRefObject<((source?: "local_end" | "server_end") => Promise<void>) | null>;
  lastNativeRemoteCameraSwitchHintIdRef: MutableRefObject<string | null>;
  localParticipantRef: MutableRefObject<DailyParticipant | null>;
  nativeCameraSwitchInFlightRef: MutableRefObject<boolean>;
  parkSharedCallForWarmHandoff: (call: DailyCallObject, reason: string) => boolean;
  partnerEverJoined: boolean;
  peerMissingTerminal: boolean;
  peerMissingTruthRefreshCountRef: MutableRefObject<number>;
  phase: ReturnType<typeof useVideoDateSession>["phase"];
  phaseRef: MutableRefObject<ReturnType<typeof useVideoDateSession>["phase"]>;
  postEncounterPeerMissingSuppressedRef: MutableRefObject<string | null>;
  reconnectSyncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  recoverNativeDailyTokenRef: MutableRefObject<(sourceAction: DailyTokenRefreshSourceAction, cause?: unknown) => Promise<boolean>>;
  refetchVideoSession: ReturnType<typeof useVideoDateSession>["refetch"];
  releaseSharedCallIfOwned: (call: DailyCallObject | null, reason: string) => void;
  remoteParticipantRef: MutableRefObject<DailyParticipant | null>;
  requestReconnectSyncRef: MutableRefObject<(reason: string) => void>;
  resetNativeRemoteRenderRecovery: (participant: DailyParticipant | null | undefined, reason: string) => void;
  roomNameRef: MutableRefObject<string | null>;
  session: ReturnType<typeof useVideoDateSession>["session"];
  sessionId: string;
  setAwaitingFirstConnect: Dispatch<SetStateAction<boolean>>;
  setCaptureProfile: Dispatch<SetStateAction<NativeVideoDateCaptureProfile>>;
  setIsConnecting: Dispatch<SetStateAction<boolean>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  setIsPartnerDisconnected: Dispatch<SetStateAction<boolean>>;
  setIsVideoOff: Dispatch<SetStateAction<boolean>>;
  setLocalInDailyRoom: Dispatch<SetStateAction<boolean>>;
  setLocalParticipant: Dispatch<SetStateAction<DailyParticipant | null>>;
  setNetQualityTier: Dispatch<SetStateAction<"good" | "fair" | "poor">>;
  setPartnerEverJoined: Dispatch<SetStateAction<boolean>>;
  setPeerMissingTerminal: Dispatch<SetStateAction<boolean>>;
  setPreJoinFailed: Dispatch<SetStateAction<boolean>>;
  setRemoteParticipant: Dispatch<SetStateAction<DailyParticipant | null>>;
  setSafetySubmitOutcome: Dispatch<SetStateAction<VideoDateSafetySubmitOutcome | null>>;
  setShowFeedback: Dispatch<SetStateAction<boolean>>;
  setShowInCallSafety: Dispatch<SetStateAction<boolean>>;
  setShowProfileSheet: Dispatch<SetStateAction<boolean>>;
  showFeedback: boolean;
  terminalSurveyHardStopRef: MutableRefObject<boolean>;
  user: ReturnType<typeof useAuth>["user"];
  videoDateEndedRef: MutableRefObject<boolean>;
}

export function useNativeVideoDateCallEndCleanup(deps: NativeVideoDateCallEndCleanupDeps) {
  const {
    activeNativeDailyCallIdentityRef,
    callRef,
    captureProfileRef,
    clearDailyAliveHeartbeatTimer,
    clearDailyTokenRefreshTimer,
    clearEntryGraceState,
    clearFirstConnectWatchdog,
    clearPartnerAwayAfterTransportGrace,
    confirmNativeTerminalPostDateRecovery,
    countdownCompletionKeyRef,
    dailyTokenExpiresAtRef,
    dailyTokenRecoveryInFlightRef,
    dateEstablishedRef,
    detachCallListeners,
    eventId,
    handleCallEndRef,
    lastNativeRemoteCameraSwitchHintIdRef,
    localParticipantRef,
    nativeCameraSwitchInFlightRef,
    parkSharedCallForWarmHandoff,
    partnerEverJoined,
    peerMissingTerminal,
    peerMissingTruthRefreshCountRef,
    phase,
    phaseRef,
    postEncounterPeerMissingSuppressedRef,
    reconnectSyncTimerRef,
    recoverNativeDailyTokenRef,
    refetchVideoSession,
    releaseSharedCallIfOwned,
    remoteParticipantRef,
    requestReconnectSyncRef,
    resetNativeRemoteRenderRecovery,
    roomNameRef,
    session,
    sessionId,
    setAwaitingFirstConnect,
    setCaptureProfile,
    setIsConnecting,
    setIsMuted,
    setIsPartnerDisconnected,
    setIsVideoOff,
    setLocalInDailyRoom,
    setLocalParticipant,
    setNetQualityTier,
    setPartnerEverJoined,
    setPeerMissingTerminal,
    setPreJoinFailed,
    setRemoteParticipant,
    setSafetySubmitOutcome,
    setShowFeedback,
    setShowInCallSafety,
    setShowProfileSheet,
    showFeedback,
    terminalSurveyHardStopRef,
    user,
    videoDateEndedRef,
  } = deps;

  const onPartnerLeftReconnect = useCallback(() => {
    if (!partnerEverJoined || !sessionId || phase === "ended") return;
    setIsPartnerDisconnected(true);
    void markReconnectPartnerAway(sessionId, "daily_transport_grace_expired");
    requestReconnectSyncRef.current("partner_marked_away");
  }, [sessionId, phase, partnerEverJoined]);

  const cleanupDailyAndLocalState = useCallback(
    async (options?: NativeDailyCleanupOptions) => {
      const cleanupMode = options?.mode ?? "destructive";
      const cleanupReason = options?.reason ?? "leave_and_cleanup";
      const call = callRef.current;
      if (call) {
        detachCallListeners(cleanupReason);
        const meetingStateBeforeCleanup = safeNativeDailyMeetingState(call);
        const shouldParkSingleton =
          cleanupMode === "preserve_active_handoff" &&
          !showFeedback &&
          !terminalSurveyHardStopRef.current &&
          phaseRef.current !== "ended" &&
          meetingStateBeforeCleanup !== "left-meeting" &&
          meetingStateBeforeCleanup !== "error";
        if (
          shouldParkSingleton &&
          parkSharedCallForWarmHandoff(call, cleanupReason)
        ) {
          vdbg("daily_call_live_remount_detach_only", {
            sessionId: sessionId ?? null,
            userId: user?.id ?? null,
            eventId: eventId || null,
            roomName: roomNameRef.current ?? null,
            reason: cleanupReason,
            cleanupMode,
            meetingState: meetingStateBeforeCleanup,
            heartbeatPreserved: true,
            callRefPreserved: true,
          });
          return;
        }
      }
      clearEntryGraceState();
      clearPartnerAwayAfterTransportGrace(cleanupReason);
      clearFirstConnectWatchdog();
      clearDailyTokenRefreshTimer();
      clearDailyAliveHeartbeatTimer(cleanupReason);
      activeNativeDailyCallIdentityRef.current = null;
      dailyTokenRecoveryInFlightRef.current = false;
      dailyTokenExpiresAtRef.current = null;
      recoverNativeDailyTokenRef.current = () => Promise.resolve(false);
      if (call) {
        try {
          await call.leave();
        } catch (_error) {
          void _error;
        }
        try {
          await destroyNativeVideoDateDailyCall(call, cleanupReason, {
            sessionId,
            userId: user?.id ?? null,
            roomName: roomNameRef.current ?? null,
          });
        } catch (_error) {
          void _error;
        }
        releaseSharedCallIfOwned(call, cleanupReason);
        callRef.current = null;
      }
      const roomName = roomNameRef.current;
      if (roomName) {
        vdbg("daily_room_delete_skipped", {
          action: "delete_room",
          caller: "native.leaveAndCleanup",
          reason: "backend_cleanup_owns_video_date_rooms",
          sessionId: sessionId ?? null,
          userId: user?.id ?? null,
          eventId: eventId || null,
          roomName,
        });
        roomNameRef.current = null;
      }
      localParticipantRef.current = null;
      setLocalParticipant(null);
      remoteParticipantRef.current = null;
      nativeCameraSwitchInFlightRef.current = false;
      lastNativeRemoteCameraSwitchHintIdRef.current = null;
      resetNativeRemoteRenderRecovery(null, cleanupReason);
      setRemoteParticipant(null);
      vdbg("prejoin_state_localInDailyRoom", {
        value: false,
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        step: cleanupReason,
      });
      setLocalInDailyRoom(false);
      setPartnerEverJoined(false);
      setPeerMissingTerminal(false);
      peerMissingTruthRefreshCountRef.current = 0;
      vdbg("prejoin_state_isConnecting", {
        value: false,
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        step: cleanupReason,
      });
      setIsConnecting(false);
      setIsMuted(false);
      setIsVideoOff(false);
      vdbg("prejoin_state_awaitingFirstConnect", {
        value: false,
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        step: cleanupReason,
      });
      setAwaitingFirstConnect(false);
      vdbg("prejoin_state_preJoinFailed", {
        value: false,
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        step: cleanupReason,
      });
      setPreJoinFailed(false);
      setNetQualityTier("good");
      captureProfileRef.current = "ideal";
      setCaptureProfile("ideal");
    },
    [
      sessionId,
      eventId,
      user?.id,
      showFeedback,
      clearFirstConnectWatchdog,
      clearDailyTokenRefreshTimer,
      clearDailyAliveHeartbeatTimer,
      clearPartnerAwayAfterTransportGrace,
      parkSharedCallForWarmHandoff,
      releaseSharedCallIfOwned,
      detachCallListeners,
      clearEntryGraceState,
      resetNativeRemoteRenderRecovery,
    ],
  );

  const cleanupForAbortWithoutServerEnd = useCallback(async () => {
    await cleanupDailyAndLocalState({
      mode: "destructive",
      reason: "leave_and_cleanup",
    });
    if (sessionId) {
      // Aborting the prejoin/Daily pipeline must release the date-entry latch; otherwise the
      // hydration / route-guard bounce stays suppressed for up to 180s and a re-entry into
      // the date stack pins the user with the stale latch.
      clearDateEntryTransition(sessionId);
      clearVideoDateRouteOwnership(sessionId, user?.id ?? null);
    }
  }, [cleanupDailyAndLocalState, sessionId, user?.id]);

  const fetchServerTerminalTruth = useCallback(async () => {
    if (!sessionId) return false;
    const sync = await syncVideoDateReconnect(sessionId);
    return sync?.ended === true;
  }, [sessionId]);

  const handleCallEnd = useCallback(
    async (
      source: "local_end" | "server_end" = "local_end",
      reason: NativeVideoDateEndReason = "ended_from_client",
    ) => {
      const dateWasEstablished =
        dateEstablishedRef.current ||
        phaseRef.current === "date" ||
        reason === "partner_absent_after_confirmed_encounter" ||
        videoSessionHasEncounterExposureTruth(session);
      const emitConfirmedEndedAnalytics = () => {
        if (sessionId && !videoDateEndedRef.current) {
          videoDateEndedRef.current = true;
          trackEvent("video_date_ended", { session_id: sessionId, reason });
        }
      };
      if (reason !== "date_timeout") {
        emitConfirmedEndedAnalytics();
      }
      addVideoDateBreadcrumb("Call ended (user)", "info", {
        sessionId,
        source,
        dateWasEstablished,
      });
      if (source === "server_end") {
        const terminalHandled =
          await confirmNativeTerminalPostDateRecovery(source);
        if (terminalHandled) {
          vdbg("server_end_terminal_handled", { sessionId, source });
        } else {
          setShowFeedback(false);
          router.replace(eventId ? eventLobbyHref(eventId) : tabsRootHref());
        }
        await cleanupForAbortWithoutServerEnd();
        return;
      }

      if (dateWasEstablished) {
        let terminalConfirmed = false;
        if (sessionId) {
          terminalConfirmed = await endVideoDate(sessionId, reason);
        }
        if (!terminalConfirmed) {
          terminalConfirmed = await fetchServerTerminalTruth();
        }
        if (!terminalConfirmed) {
          if (reason === "date_timeout") {
            videoDateEndedRef.current = false;
            countdownCompletionKeyRef.current = null;
            setShowFeedback(false);
            await refetchVideoSession();
            return;
          }
          setShowFeedback(false);
          await cleanupForAbortWithoutServerEnd();
          Alert.alert(
            "Could not end date yet",
            "Please try ending the date again in a moment.",
          );
          return;
        }

        if (reason === "date_timeout") {
          emitConfirmedEndedAnalytics();
        }
        const terminalHandled = await confirmNativeTerminalPostDateRecovery(
          "local_end_confirmed",
        );
        if (terminalHandled) {
          vdbg("local_end_terminal_handled", {
            sessionId,
            source: "local_end_confirmed",
          });
          await cleanupForAbortWithoutServerEnd();
          return;
        }

        if (reason === "date_timeout") {
          videoDateEndedRef.current = false;
          countdownCompletionKeyRef.current = null;
          setShowFeedback(false);
          await refetchVideoSession();
          return;
        }
        setShowFeedback(false);
        await cleanupForAbortWithoutServerEnd();
        Alert.alert(
          "Date ending is still syncing",
          "Please try ending the date again in a moment.",
        );
        return;
      }
      setShowFeedback(false);
      await cleanupForAbortWithoutServerEnd();
    },
    [
      cleanupForAbortWithoutServerEnd,
      sessionId,
      fetchServerTerminalTruth,
      confirmNativeTerminalPostDateRecovery,
      refetchVideoSession,
      eventId,
      session,
    ],
  );

  useEffect(() => {
    handleCallEndRef.current = handleCallEnd;
  }, [handleCallEnd]);

  useEffect(() => {
    if (!peerMissingTerminal || !sessionId || showFeedback) return;
    const confirmedEncounter =
      dateEstablishedRef.current ||
      phaseRef.current === "date" ||
      videoSessionHasEncounterExposureTruth(session);
    if (!confirmedEncounter) return;

    const key = `${sessionId}:post_encounter_peer_missing_terminal_suppressed`;
    if (postEncounterPeerMissingSuppressedRef.current === key) return;
    postEncounterPeerMissingSuppressedRef.current = key;

    vdbg("post_encounter_peer_missing_terminal_end_suppressed", {
      sessionId,
      userId: user?.id ?? null,
      eventId,
      phase: phaseRef.current,
      hasEncounterExposureTruth: videoSessionHasEncounterExposureTruth(session),
    });
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED, {
      platform: "native",
      session_id: sessionId,
      event_id: eventId,
      source_surface: "video_date_route",
      source_action: "post_encounter_peer_missing_terminal_end_suppressed",
      reason_code: "provider_absence_server_owned_after_encounter",
    });
  }, [
    eventId,
    peerMissingTerminal,
    session,
    sessionId,
    showFeedback,
    user?.id,
  ]);

  const clearReconnectSyncTimer = useCallback(() => {
    if (!reconnectSyncTimerRef.current) return;
    clearTimeout(reconnectSyncTimerRef.current);
    reconnectSyncTimerRef.current = null;
  }, []);

  const handleEndAfterInCallReport = useCallback(async () => {
    await handleCallEnd("local_end");
  }, [handleCallEnd]);

  const handleReportOnlySafetySuccess = useCallback(
    async (outcome: VideoDateSafetySubmitOutcome) => {
      setSafetySubmitOutcome(outcome);
      if (outcome.alsoBlock || outcome.ended) {
        setShowProfileSheet(false);
        setShowInCallSafety(false);
      }
      if (!outcome.ended) return;
      if (sessionId && !videoDateEndedRef.current) {
        videoDateEndedRef.current = true;
        trackEvent("video_date_ended", {
          session_id: sessionId,
          reason: "ended_from_client",
          source: "safety_report",
          survey_required: outcome.surveyRequired,
        });
      }
      setShowFeedback(false);
      await cleanupForAbortWithoutServerEnd();
      router.replace(eventId ? eventLobbyHref(eventId) : tabsRootHref());
    },
    [cleanupForAbortWithoutServerEnd, eventId, sessionId],
  );

  const handleServerEndedAfterInCallReport = useCallback(
    async (
      result: { surveyRequired?: boolean },
      outcome?: VideoDateSafetySubmitOutcome,
    ) => {
      setSafetySubmitOutcome((current) =>
        outcome
          ? {
              ...outcome,
              ended: true,
              surveyRequired: result.surveyRequired === true,
            }
          : current
            ? {
                ...current,
                ended: true,
                surveyRequired: result.surveyRequired === true,
              }
            : {
                mode: "end",
                alsoBlock: false,
                ended: true,
                surveyRequired: result.surveyRequired === true,
                idempotent: false,
                reportRecorded: true,
                nextDestination:
                  result.surveyRequired === true ? "survey" : "lobby",
              },
      );
      setShowProfileSheet(false);
      if (sessionId && !videoDateEndedRef.current) {
        videoDateEndedRef.current = true;
        trackEvent("video_date_ended", {
          session_id: sessionId,
          reason: "ended_from_client",
          source: "safety_report_v2",
          survey_required: result.surveyRequired === true,
        });
      }
      if (result.surveyRequired === true) {
        const terminalHandled = await confirmNativeTerminalPostDateRecovery(
          "safety_report_v2_server_end",
        );
        if (terminalHandled) {
          vdbg("safety_report_terminal_handled", {
            sessionId,
            source: "safety_report_v2_server_end",
          });
        } else {
          setShowFeedback(false);
          Alert.alert(
            "Report recorded",
            "We are still syncing the date ending. Please return to the lobby.",
          );
          router.replace(eventId ? eventLobbyHref(eventId) : tabsRootHref());
        }
      } else {
        setShowFeedback(false);
        router.replace(eventId ? eventLobbyHref(eventId) : tabsRootHref());
      }
      await cleanupForAbortWithoutServerEnd();
    },
    [
      cleanupForAbortWithoutServerEnd,
      confirmNativeTerminalPostDateRecovery,
      eventId,
      sessionId,
    ],
  );

  return {
    cleanupDailyAndLocalState,
    cleanupForAbortWithoutServerEnd,
    handleCallEnd,
    clearReconnectSyncTimer,
    handleEndAfterInCallReport,
    handleReportOnlySafetySuccess,
    handleServerEndedAfterInCallReport,
  };
}

export type NativeVideoDateCallEndCleanupApi = ReturnType<typeof useNativeVideoDateCallEndCleanup>;
