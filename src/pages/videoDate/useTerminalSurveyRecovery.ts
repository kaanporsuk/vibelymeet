import { useCallback } from "react";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT,
  TERMINAL_SURVEY_SESSION_SELECT,
  TerminalSurveyRegistrationFallbackRow,
  TerminalSurveySessionRow,
  shouldOpenPostDateSurveyForTerminalSession,
  videoSessionIndicatesTerminalEnd,
} from "./videoDatePageShared";
import { adviseVideoSessionTruthRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import { captureSupabaseError } from "@/lib/errorTracking";
import {
  clearDateEntryTransition,
  clearVideoDateRouteOwnership,
  isVideoDateRouteOwned,
  markVideoDateRouteOwned,
} from "@/lib/videoDateNavigationIntents";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { vdbg, vdbgRedirect } from "@/lib/vdbg";
import { videoDateLifecycleRpcIndicatesTerminalSurvey } from "@clientShared/matching/videoDateLifecycleRpc";
import { videoSessionHasPostDateSurveyTruth } from "@clientShared/matching/activeSession";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { VideoDateJourneyEvent } from "@clientShared/matching/videoDateDiagnostics";
import type { VideoCallStartFailure } from "@/hooks/useVideoCall";
import { useEventStatus } from "@/hooks/useEventStatus";
import type { CallPhase, VideoDateAccess } from "./videoDatePageShared";

/**
 * Terminal-survey recovery concern of the web Video Date page (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/pages/VideoDate.tsx).
 *
 * Owns the terminal hard-stop (Daily/surface churn stops before the survey
 * opens), survey open/dedupe, terminal context hydration, and the
 * registration/in_survey + ended-truth recovery paths. Terminal-survey
 * recovery must stay reachable from every non-terminal state and force past
 * duplicate-navigation/manual-exit suppression.
 */

type UseTerminalSurveyRecoveryDeps = {
  callStartAutoRetryCountRef: MutableRefObject<number>;
  canonicalRoomNameRef: MutableRefObject<string | null>;
  clearCallStartAutoRetryTimer: () => void;
  clearEntryGraceState: () => void;
  entryStartedAt: string | null;
  eventId: string | undefined;
  id: string | undefined;
  isParticipant1: boolean;
  logJourney: (
    event: VideoDateJourneyEvent,
    payload?: Record<string, unknown>,
    dedupeKey?: string,
  ) => void;
  navigate: NavigateFunction;
  partnerId: string;
  phase: CallPhase;
  setCallStarted: Dispatch<SetStateAction<boolean>>;
  setCallStartFailure: Dispatch<SetStateAction<VideoCallStartFailure | null>>;
  setEventId: Dispatch<SetStateAction<string | undefined>>;
  setIsParticipant1: Dispatch<SetStateAction<boolean>>;
  setPartnerId: Dispatch<SetStateAction<string>>;
  setPhase: Dispatch<SetStateAction<CallPhase>>;
  setShowFeedback: Dispatch<SetStateAction<boolean>>;
  setStatus: ReturnType<typeof useEventStatus>["setStatus"];
  setTerminalSurveyRecoveryActive: Dispatch<SetStateAction<boolean>>;
  setTimeLeft: Dispatch<SetStateAction<number | null>>;
  setTimingReady: Dispatch<SetStateAction<boolean>>;
  setVideoDateAccess: Dispatch<SetStateAction<VideoDateAccess>>;
  surveyOpenedRef: MutableRefObject<boolean>;
  terminalDailyStopRef: MutableRefObject<((reason: string) => void) | null>;
  terminalDailyStopRequestedRef: MutableRefObject<boolean>;
  terminalSurveyRecoveryInFlightRef: MutableRefObject<boolean>;
  user: { id: string } | null;
};

export function useTerminalSurveyRecovery(deps: UseTerminalSurveyRecoveryDeps) {
  const {
    callStartAutoRetryCountRef,
    canonicalRoomNameRef,
    clearCallStartAutoRetryTimer,
    clearEntryGraceState,
    entryStartedAt,
    eventId,
    id,
    isParticipant1,
    logJourney,
    navigate,
    partnerId,
    phase,
    setCallStarted,
    setCallStartFailure,
    setEventId,
    setIsParticipant1,
    setPartnerId,
    setPhase,
    setShowFeedback,
    setStatus,
    setTerminalSurveyRecoveryActive,
    setTimeLeft,
    setTimingReady,
    setVideoDateAccess,
    surveyOpenedRef,
    terminalDailyStopRef,
    terminalDailyStopRequestedRef,
    terminalSurveyRecoveryInFlightRef,
    user,
  } = deps;

  const enterTerminalSurveyHardStop = useCallback(
    (reason: string) => {
      terminalSurveyRecoveryInFlightRef.current = true;
      setTerminalSurveyRecoveryActive(true);
      if (id) markVideoDateRouteOwned(id, user?.id ?? null);
      const stopDailyForTerminal = terminalDailyStopRef.current;
      if (!terminalDailyStopRequestedRef.current && stopDailyForTerminal) {
        terminalDailyStopRequestedRef.current = true;
        stopDailyForTerminal(reason);
      }
      clearEntryGraceState();
      clearCallStartAutoRetryTimer();
      callStartAutoRetryCountRef.current = 0;
      setPhase("ended");
      setTimeLeft(0);
      setVideoDateAccess("allowed");
      setTimingReady(true);
      setCallStarted(false);
      setCallStartFailure(null);
      setStatus("in_survey");
      vdbg("terminal_survey_recovery_hard_stop", {
        sessionId: id ?? null,
        userId: user?.id ?? null,
        eventId: eventId ?? null,
        reason,
      });
    },
    [
      clearCallStartAutoRetryTimer,
      clearEntryGraceState,
      eventId,
      id,
      setStatus,
      user?.id,
    ],
  );

  const openPostDateSurvey = useCallback(
    (reason: string) => {
      if (surveyOpenedRef.current) return false;
      surveyOpenedRef.current = true;
      enterTerminalSurveyHardStop(reason);
      setShowFeedback(true);
      vdbg("post_date_survey_opened", { sessionId: id ?? null, reason });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_OPENED, {
        platform: "web",
        session_id: id,
        event_id: eventId,
        reason,
        source_surface: "video_date_route",
        source_action: reason,
      });
      logJourney("survey_opened", { reason }, `survey_opened_${reason}`);
      if (reason.includes("recovery") || reason === "session_load_terminal") {
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_RECOVERED, {
          platform: "web",
          session_id: id,
          event_id: eventId,
          source_surface: "video_date_route",
          source_action: reason,
          outcome: "recovered",
          reason_code: reason,
        });
        logJourney(
          "survey_recovered",
          { reason },
          `survey_recovered_${reason}`,
        );
      }
      return true;
    },
    [enterTerminalSurveyHardStop, id, eventId, logJourney],
  );

  const hydrateTerminalSurveyContext = useCallback(
    (
      sessionRow: {
        participant_1_id?: string | null;
        participant_2_id?: string | null;
        event_id?: string | null;
        daily_room_name?: string | null;
      },
      source: string,
    ) => {
      const isP1 = sessionRow.participant_1_id === user?.id;
      const resolvedPartnerId = isP1
        ? sessionRow.participant_2_id
        : sessionRow.participant_1_id;
      if (sessionRow.daily_room_name) {
        canonicalRoomNameRef.current = sessionRow.daily_room_name;
      }
      setIsParticipant1(isP1);
      setEventId(sessionRow.event_id ?? undefined);
      setPartnerId(resolvedPartnerId ?? "");
      setVideoDateAccess("allowed");
      setTimingReady(true);
      setCallStarted(false);
      clearCallStartAutoRetryTimer();
      callStartAutoRetryCountRef.current = 0;
      setCallStartFailure(null);
      vdbg("terminal_survey_context_hydrated", {
        sessionId: id ?? null,
        userId: user?.id ?? null,
        source,
        eventId: sessionRow.event_id ?? null,
        partnerId: resolvedPartnerId ?? null,
        isParticipant1: isP1,
      });
    },
    [clearCallStartAutoRetryTimer, id, user?.id],
  );

  const recoverTerminalPostDateSurvey = useCallback(
    async (
      source: string,
      sessionOverride?: TerminalSurveySessionRow | null,
    ) => {
      if (!id || !user?.id) return false;
      const sessionResult = sessionOverride
        ? { data: sessionOverride, error: null }
        : await supabase
            .from("video_sessions")
            .select(TERMINAL_SURVEY_SESSION_SELECT)
            .eq("id", id)
            .maybeSingle();
      if (sessionResult.error) {
        captureSupabaseError(
          "terminal_post_date_survey_session_fetch_failed",
          sessionResult.error,
        );
        recordUserAction("terminal_post_date_survey_session_fetch_failed", {
          surface: "video_date",
          session_id: id,
          user_id: user.id,
          source,
          code: sessionResult.error.code,
        });
        vdbg("terminal_post_date_survey_session_fetch_failed", {
          sessionId: id,
          userId: user.id,
          source,
          code: sessionResult.error.code,
          message: sessionResult.error.message,
        });
        const { data: registrationFallback, error: registrationError } =
          await supabase
            .from("event_registrations")
            .select(TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT)
            .eq("profile_id", user.id)
            .eq("queue_status", "in_survey")
            .order("last_active_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (registrationError) {
          captureSupabaseError(
            "terminal_post_date_survey_registration_fallback_failed",
            registrationError,
          );
          recordUserAction(
            "terminal_post_date_survey_registration_fallback_failed",
            {
              surface: "video_date",
              session_id: id,
              user_id: user.id,
              source,
              code: registrationError.code,
            },
          );
          vdbg("terminal_post_date_survey_registration_fallback_failed", {
            sessionId: id,
            userId: user.id,
            source,
            code: registrationError.code,
            message: registrationError.message,
          });
          return false;
        }
        const fallbackRow =
          (registrationFallback as TerminalSurveyRegistrationFallbackRow | null) ??
          null;
        const fallbackMatchesCurrentRoute =
          fallbackRow?.current_room_id == null ||
          fallbackRow.current_room_id === id;
        if (
          fallbackRow?.queue_status === "in_survey" &&
          fallbackMatchesCurrentRoute
        ) {
          if (fallbackRow.event_id) setEventId(fallbackRow.event_id);
          if (fallbackRow.current_partner_id) {
            setPartnerId(fallbackRow.current_partner_id);
          }
          setVideoDateAccess("allowed");
          setTimingReady(true);
          setCallStarted(false);
          setCallStartFailure(null);
          setStatus("in_survey");
          vdbg("terminal_post_date_survey_registration_fallback", {
            sessionId: id,
            userId: user.id,
            source,
            eventId: fallbackRow.event_id ?? null,
            currentRoomId: fallbackRow.current_room_id ?? null,
            currentPartnerId: fallbackRow.current_partner_id ?? null,
            lastActiveAt: fallbackRow.last_active_at ?? null,
          });
          openPostDateSurvey(`${source}_registration_recovery`);
          return true;
        }
        return false;
      }
      const sessionRow = sessionResult.data;

      if (!sessionRow) {
        setVideoDateAccess("not_found");
        return true;
      }

      if (!videoSessionIndicatesTerminalEnd(sessionRow)) {
        return false;
      }

      const hasPostDateSurveyTruth =
        videoSessionHasPostDateSurveyTruth(sessionRow);
      if (hasPostDateSurveyTruth) {
        enterTerminalSurveyHardStop(source);
        hydrateTerminalSurveyContext(sessionRow, source);
      }

      let verdict: { id?: string | null } | null = null;
      const { data: verdictData, error: verdictError } = await supabase
        .from("date_feedback")
        .select("id")
        .eq("session_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (verdictError) {
        captureSupabaseError(
          "terminal_post_date_survey_verdict_fetch_failed",
          verdictError,
        );
        recordUserAction("terminal_post_date_survey_verdict_fetch_failed", {
          surface: "video_date",
          session_id: id,
          user_id: user.id,
          source,
          code: verdictError.code,
        });
        vdbg("terminal_post_date_survey_verdict_fetch_failed", {
          sessionId: id,
          userId: user.id,
          source,
          code: verdictError.code,
          message: verdictError.message,
        });
        if (!hasPostDateSurveyTruth) {
          return false;
        }
      } else {
        verdict = verdictData ?? null;
      }
      const verdictFetchFailed = Boolean(verdictError);

      const shouldOpenSurvey = shouldOpenPostDateSurveyForTerminalSession(
        sessionRow,
        verdict,
      );
      vdbg("terminal_post_date_survey_recovery_checked", {
        sessionId: id,
        userId: user.id,
        source,
        shouldOpenSurvey,
        hardStopApplied: hasPostDateSurveyTruth,
        verdictFetchFailed,
        verdictId: verdict?.id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
        state: sessionRow.state ?? null,
        phase: sessionRow.phase ?? null,
        participant1Joined: Boolean(sessionRow.participant_1_joined_at),
        participant2Joined: Boolean(sessionRow.participant_2_joined_at),
        participant1RemoteSeen: Boolean(
          sessionRow.participant_1_remote_seen_at,
        ),
        participant2RemoteSeen: Boolean(
          sessionRow.participant_2_remote_seen_at,
        ),
      });

      if (shouldOpenSurvey || (hasPostDateSurveyTruth && verdictFetchFailed)) {
        hydrateTerminalSurveyContext(sessionRow, source);
        openPostDateSurvey(source);
        return true;
      }

      clearEntryGraceState();
      terminalSurveyRecoveryInFlightRef.current = false;
      setTerminalSurveyRecoveryActive(false);
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      if (verdict?.id && sessionRow.event_id) {
        // Own verdict already persisted: release this registration before
        // leaving, or a stale in_survey stamp keeps bouncing the lobby back
        // here (2026-06-12 acceptance-run livelock). update_participant_status
        // is the canonical own-row release and refuses server-side while a
        // survey is genuinely pending, so this is safe under races. setStatus
        // is not used here because its eventId binding can be unset on cold
        // /date loads.
        let releaseError: { code?: string } | null = null;
        let releaseAttempts = 0;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
          }
          releaseAttempts = attempt + 1;
          const { error } = await supabase.rpc("update_participant_status", {
            p_event_id: sessionRow.event_id,
            p_status: "browsing",
          });
          releaseError = error ?? null;
          if (!releaseError) break;
        }
        vdbg("terminal_survey_complete_registration_release", {
          sessionId: id,
          userId: user.id,
          source,
          eventId: sessionRow.event_id,
          released: !releaseError,
          attempts: releaseAttempts,
          code: releaseError?.code ?? null,
        });
        if (releaseError) {
          captureSupabaseError(
            "terminal_survey_complete_registration_release_failed",
            releaseError,
          );
        }
      }
      const target = sessionRow.event_id
        ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
        : "/events";
      clearDateEntryTransition(id);
      clearVideoDateRouteOwnership(id, user.id);
      vdbgRedirect(target, source, {
        sessionId: id,
        userId: user.id,
        eventId: sessionRow.event_id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
      });
      navigate(target, { replace: true });
      return true;
    },
    [
      clearEntryGraceState,
      enterTerminalSurveyHardStop,
      hydrateTerminalSurveyContext,
      id,
      navigate,
      openPostDateSurvey,
      setStatus,
      user?.id,
    ],
  );

  const recoverLifecycleRpcTerminalSurvey = useCallback(
    async (source: string, payload: unknown) => {
      const rpcPayload =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (!videoDateLifecycleRpcIndicatesTerminalSurvey(rpcPayload)) {
        return false;
      }
      return recoverTerminalPostDateSurvey(source);
    },
    [recoverTerminalPostDateSurvey],
  );

  const recoverFromNotStartableDateTruth = useCallback(
    async (source: string) => {
      if (!id || !user?.id) return false;
      const [vsRes, regRes] = await Promise.all([
        supabase
          .from("video_sessions")
          .select(
            "event_id, ended_at, ended_reason, state, phase, entry_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("event_registrations")
          .select("queue_status, current_room_id")
          .eq("profile_id", user.id)
          .eq("current_room_id", id)
          .maybeSingle(),
      ]);
      const vs = vsRes.data;
      const reg = regRes.data;
      const recovery = adviseVideoSessionTruthRecovery({
        sessionId: id,
        eventId,
        truth: vs,
        platform: "web",
        surface: "video_date",
      });
      const decision = recovery.routeDecision ?? "stay_lobby";
      const canAttemptDaily = recovery.canAttemptDaily === true;
      const reason =
        recovery.action === "go_date"
          ? null
          : recovery.action === "show_terminal" ||
              recovery.action === "go_survey"
            ? "session_ended"
            : canAttemptDaily
              ? "video_truth_startable_after_refetch"
              : "video_truth_not_startable";
      vdbg("date_route_decision", {
        sessionId: id,
        userId: user.id,
        source,
        decision,
        reason,
        canAttemptDaily,
        queueStatus: reg?.queue_status ?? null,
        currentRoomId: reg?.current_room_id ?? null,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
        entryStartedAt: vs?.entry_started_at ?? null,
        readyGateStatus: vs?.ready_gate_status ?? null,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        dateRouteOwned: isVideoDateRouteOwned(id, user.id),
      });

      if (
        isVideoDateRouteOwned(id, user.id) &&
        !canAttemptDaily &&
        (recovery.action === "go_ready_gate" || recovery.action === "go_lobby")
      ) {
        vdbg("date_route_bounce_suppressed_by_route_ownership", {
          sessionId: id,
          userId: user.id,
          source,
          action: recovery.action,
          queueStatus: reg?.queue_status ?? null,
          currentRoomId: reg?.current_room_id ?? null,
          vsState: vs?.state ?? null,
          vsPhase: vs?.phase ?? null,
          readyGateStatus: vs?.ready_gate_status ?? null,
        });
        setVideoDateAccess("allowed");
        return false;
      }

      if (!canAttemptDaily && recovery.action === "go_ready_gate") {
        const target = `/ready/${encodeURIComponent(id)}`;
        clearDateEntryTransition(id);
        logJourney(
          "date_route_bounced",
          { reason: source, target },
          `date_route_bounced_${source}`,
        );
        vdbgRedirect(target, source, { sessionId: id, userId: user.id });
        navigate(target, { replace: true });
        return true;
      }

      const fallbackEventId = vs?.event_id ?? eventId;
      if (
        !canAttemptDaily &&
        recovery.action === "go_lobby" &&
        fallbackEventId
      ) {
        const target = `/event/${encodeURIComponent(fallbackEventId)}/lobby`;
        clearDateEntryTransition(id);
        logJourney(
          "date_route_bounced",
          { reason: source, target },
          `date_route_bounced_${source}`,
        );
        vdbgRedirect(target, source, {
          sessionId: id,
          userId: user.id,
          eventId: fallbackEventId,
        });
        navigate(target, { replace: true });
        return true;
      }

      if (
        recovery.action === "show_terminal" ||
        recovery.action === "go_survey"
      ) {
        return recoverTerminalPostDateSurvey(`${source}_ended_truth`);
      }

      return false;
    },
    [
      eventId,
      id,
      logJourney,
      navigate,
      recoverTerminalPostDateSurvey,
      user?.id,
    ],
  );
  return {
    enterTerminalSurveyHardStop,
    openPostDateSurvey,
    hydrateTerminalSurveyContext,
    recoverTerminalPostDateSurvey,
    recoverLifecycleRpcTerminalSurvey,
    recoverFromNotStartableDateTruth,
  };
}

export type TerminalSurveyRecoveryApi = ReturnType<
  typeof useTerminalSurveyRecovery
>;
