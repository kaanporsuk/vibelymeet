import { useCallback, useEffect, useRef } from "react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { getVideoDateEntryOwner } from "@clientShared/matching/videoDateEntryOwner";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
} from "@clientShared/matching/videoDateLifecycleRpc";
import {
  isTerminalDailyMeetingState,
} from "@/lib/dailyCallInstance";
import {
  readDailyProviderSessionId,
  safeMeetingState,
} from "@/lib/daily/webDailyMediaHelpers";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";
import type { DailyAliveHeartbeatApi } from "./useDailyAliveHeartbeat";

/**
 * Remote-seen evidence concern of the web Video Date call (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/hooks/useVideoCall.ts).
 *
 * Owns the provider-bound mark_video_date_remote_seen stamping (bounded
 * retries, restamp throttling), the render-bound first-remote-frame proof,
 * and the live-remount identity-preservation unmount cleanup.
 */

const REMOTE_SEEN_RPC_MAX_ATTEMPTS = 3;
const REMOTE_SEEN_RPC_RETRY_DELAY_MS = 1_500;
const REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS = 10_000;

type UseVideoDateRemoteSeenDeps = VideoCallSharedRuntime &
  Pick<DailyAliveHeartbeatApi, "clearDailyAliveHeartbeatTimer">;

export function useVideoDateRemoteSeen(deps: UseVideoDateRemoteSeenDeps) {
  const {
    activeDailyCallIdentityRef,
    activePreparedEntryCacheHitRef,
    activePreparedEntryCacheRef,
    callObjectRef,
    clearDailyAliveHeartbeatTimer,
    hasSameSessionDailyContinuity,
    lastDailyPrewarmConsumedRef,
    lastMediaHandoffMissReasonRef,
    lastMediaHandoffUsedRef,
    lastPrewarmedAlreadyJoinedRef,
    lastPrewarmedJoinInFlightRef,
    lastProviderVerifySkippedRef,
    optionsRef,
    remoteFirstFrameTrackedRef,
    roomNameRef,
    setRemotePlayback,
  } = deps;

  const remoteSeenInFlightSessionRef = useRef<string | null>(null);
  const remoteSeenLastStampRef = useRef<{
    sessionId: string;
    stampedAtMs: number;
  } | null>(null);
  const remoteSeenRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const markRemoteSeenOnServer = useCallback(
    (source: string) => {
      const currentOptions = optionsRef.current;
      const sessionId = currentOptions?.roomId ?? null;
      if (!sessionId) return;
      const activeSessionId = sessionId;
      const eventId = currentOptions?.eventId ?? null;
      const currentUserId = currentOptions?.userId;
      if (!currentUserId) return;
      const userId = currentUserId;
      if (remoteSeenInFlightSessionRef.current === sessionId) return;
      const nowMs = Date.now();
      const lastStamp = remoteSeenLastStampRef.current;
      const forceRestamp =
        source === "loadeddata" ||
        source === "playing" ||
        source === "remote_track_mounted" ||
        source === "first_remote_frame" ||
        source === "request_video_frame_callback";
      if (
        !forceRestamp &&
        lastStamp?.sessionId === sessionId &&
        nowMs - lastStamp.stampedAtMs < REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS
      ) {
        return;
      }

      const baseEvidenceSource = source;
      const buildProviderBoundRemoteSeenArgs = (attemptSource: string) => {
        const call = callObjectRef.current;
        const providerSessionId = readDailyProviderSessionId(call);
        const meetingState = safeMeetingState(call);
        const providerBackedJoined =
          meetingState === "joined-meeting" && Boolean(providerSessionId);
        const identity = activeDailyCallIdentityRef.current;
        const identityCurrent =
          identity?.sessionId === sessionId && identity.userId === userId
            ? identity
            : null;
        const entryOwner = getVideoDateEntryOwner(sessionId, userId);
        const ownerId = identityCurrent?.ownerId ?? entryOwner?.ownerId ?? null;
        const callInstanceId = identityCurrent?.callInstanceId ?? null;
        const entryAttemptId =
          identityCurrent?.entryAttemptId ?? entryOwner?.entryAttemptId ?? null;
        const videoDateTraceId =
          identityCurrent?.videoDateTraceId ??
          entryOwner?.videoDateTraceId ??
          null;

        if (!providerBackedJoined || !providerSessionId || !callInstanceId) {
          const terminal =
            meetingState === "left-meeting" || meetingState === "error";
          if (terminal) {
            clearDailyAliveHeartbeatTimer(
              "remote_seen_provider_missing_terminal_state",
            );
          }
          const code = !providerSessionId
            ? "REMOTE_SEEN_PROVIDER_SESSION_MISSING"
            : !callInstanceId
              ? "REMOTE_SEEN_CALL_INSTANCE_MISSING"
              : "REMOTE_SEEN_OWNER_NOT_JOINED";
          vdbg("mark_video_date_remote_seen_skipped_provider_missing", {
            sessionId,
            eventId,
            userId,
            source: attemptSource,
            providerSessionId,
            meetingState,
            providerBackedJoined,
            callInstanceId,
            ownerId,
            terminal,
          });
          return {
            ok: false as const,
            code,
            payload: {
              ok: false,
              error: code.toLowerCase(),
              code,
              retryable: false,
              provider_presence_required: true,
              provider_presence_missing: true,
              provider_presence_terminal: terminal,
            },
          };
        }

        return {
          ok: true as const,
          providerSessionId,
          meetingState,
          ownerId,
          callInstanceId,
          entryAttemptId,
          videoDateTraceId,
          args: {
            p_session_id: sessionId,
            p_owner_id: ownerId,
            p_call_instance_id: callInstanceId,
            p_provider_session_id: providerSessionId,
            p_entry_attempt_id: entryAttemptId,
            p_owner_state: "joined",
            p_evidence_source: baseEvidenceSource,
          },
        };
      };

      const initialProof = buildProviderBoundRemoteSeenArgs(source);
      if (!initialProof.ok) return;

      if (remoteSeenRetryTimerRef.current) {
        clearTimeout(remoteSeenRetryTimerRef.current);
        remoteSeenRetryTimerRef.current = null;
      }
      remoteSeenInFlightSessionRef.current = sessionId;

      const scheduleRetry = (attemptSource: string, nextAttempt: number) => {
        if (
          optionsRef.current?.roomId !== sessionId ||
          remoteSeenRetryTimerRef.current
        )
          return;
        remoteSeenRetryTimerRef.current = setTimeout(() => {
          remoteSeenRetryTimerRef.current = null;
          if (
            optionsRef.current?.roomId !== sessionId ||
            remoteSeenInFlightSessionRef.current === sessionId
          )
            return;
          remoteSeenInFlightSessionRef.current = sessionId;
          stamp(`${attemptSource}_retry_${nextAttempt}`, nextAttempt);
        }, REMOTE_SEEN_RPC_RETRY_DELAY_MS);
      };

      const handleFailure = (
        attemptSource: string,
        attempt: number,
        code: string,
        errorDetail: unknown,
        payload?: Record<string, unknown> | null,
      ) => {
        if (remoteSeenInFlightSessionRef.current === sessionId) {
          remoteSeenInFlightSessionRef.current = null;
        }
        const terminalSurvey =
          videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
        const terminalStop =
          terminalSurvey ||
          videoDateLifecycleRpcIndicatesTerminalStop(payload) ||
          payload?.provider_presence_terminal === true;
        const retryable =
          videoDateLifecycleRpcRetryable(payload) ?? !terminalStop;
        if (terminalStop) {
          if (remoteSeenRetryTimerRef.current) {
            clearTimeout(remoteSeenRetryTimerRef.current);
            remoteSeenRetryTimerRef.current = null;
          }
          clearDailyAliveHeartbeatTimer(
            terminalSurvey
              ? "remote_seen_terminal_survey_truth"
              : "remote_seen_terminal_truth",
          );
          if (terminalSurvey) {
            optionsRef.current?.onTerminalSurveyTruth?.(
              "remote_seen_terminal_survey_truth",
            );
          }
        }
        vdbg("mark_video_date_remote_seen_failed", {
          sessionId,
          eventId,
          userId,
          source: attemptSource,
          code,
          error: errorDetail,
          attempt,
          retryable,
          terminalStop,
          payload: payload ?? null,
        });
        if (!retryable || terminalStop) {
          return;
        }
        if (attempt < REMOTE_SEEN_RPC_MAX_ATTEMPTS) {
          scheduleRetry(attemptSource, attempt + 1);
          return;
        }
        void emitWebVideoDateClientStuckState({
          sessionId,
          eventName: "remote_seen_canonical_repair_failed",
          payload: {
            source_surface: "video_date_daily",
            source_action: "mark_video_date_remote_seen",
            reason_code: code,
            code,
            source: attemptSource,
            attempt_count: attempt,
            retryable,
            exhausted: true,
          },
        });
      };

      function stamp(attemptSource: string, attempt: number) {
        const proof = buildProviderBoundRemoteSeenArgs(attemptSource);
        if (!proof.ok) {
          handleFailure(
            attemptSource,
            attempt,
            proof.code,
            null,
            proof.payload,
          );
          return;
        }
        void Promise.resolve(
          supabase.rpc("mark_video_date_remote_seen", proof.args),
        )
          .then(({ data, error }) => {
            const payload =
              data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : null;
            if (error || payload?.ok !== true) {
              handleFailure(
                attemptSource,
                attempt,
                error?.code ??
                  videoDateLifecycleRpcCode(payload) ??
                  String(payload?.error ?? "unknown"),
                error ? { code: error.code, message: error.message } : null,
                payload,
              );
              return;
            }
            if (remoteSeenRetryTimerRef.current) {
              clearTimeout(remoteSeenRetryTimerRef.current);
              remoteSeenRetryTimerRef.current = null;
            }
            if (remoteSeenInFlightSessionRef.current === sessionId) {
              remoteSeenInFlightSessionRef.current = null;
            }
            remoteSeenLastStampRef.current = {
              sessionId: activeSessionId,
              stampedAtMs: Date.now(),
            };
            updateVideoDateEntryOwnerState({
              sessionId: activeSessionId,
              userId,
              ownerId: proof.ownerId,
              state: "remote_seen",
              source: `remote_seen_${attemptSource}`,
              roomName: roomNameRef.current,
              entryAttemptId: proof.entryAttemptId,
              videoDateTraceId: proof.videoDateTraceId,
              callInstanceId: proof.callInstanceId,
              providerSessionId: proof.providerSessionId,
            });
            updateVideoDateDailyOwnerState({
              sessionId: activeSessionId,
              userId,
              ownerId: proof.ownerId,
              roomName: roomNameRef.current,
              state: "remote_seen",
              source: `remote_seen_${attemptSource}`,
              entryAttemptId: proof.entryAttemptId,
              videoDateTraceId: proof.videoDateTraceId,
              callInstanceId: proof.callInstanceId,
              providerSessionId: proof.providerSessionId,
            });
            vdbg("mark_video_date_remote_seen_after", {
              sessionId,
              eventId,
              userId,
              source: attemptSource,
              providerSessionId: proof.providerSessionId,
              callInstanceId: proof.callInstanceId,
              participant1RemoteSeenAt:
                payload?.participant_1_remote_seen_at ?? null,
              participant2RemoteSeenAt:
                payload?.participant_2_remote_seen_at ?? null,
            });
          })
          .catch((error: unknown) => {
            handleFailure(
              attemptSource,
              attempt,
              "promise_rejected",
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: String(error) },
            );
          });
      }

      stamp(source, 1);
    },
    [clearDailyAliveHeartbeatTimer],
  );

  useEffect(() => {
    return () => {
      if (remoteSeenRetryTimerRef.current) {
        clearTimeout(remoteSeenRetryTimerRef.current);
        remoteSeenRetryTimerRef.current = null;
      }
      remoteSeenInFlightSessionRef.current = null;
      const sessionId = optionsRef.current?.roomId ?? null;
      const call = callObjectRef.current;
      const shouldPreserveActiveIdentity =
        Boolean(sessionId) &&
        Boolean(call) &&
        hasSameSessionDailyContinuity(sessionId) &&
        optionsRef.current?.videoSessionState !== "ended" &&
        !isTerminalDailyMeetingState(safeMeetingState(call));
      if (shouldPreserveActiveIdentity) {
        vdbg("daily_call_live_remount_identity_preserved", {
          sessionId,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          meetingState: safeMeetingState(call),
        });
        return;
      }
      activeDailyCallIdentityRef.current = null;
    };
  }, [hasSameSessionDailyContinuity]);

  const markRemoteFirstFrameRendered = useCallback(
    (source: string) => {
      setRemotePlayback((prev) => {
        if (prev.firstFrameRendered) return prev;
        return {
          ...prev,
          mediaAttached: true,
          playRejected: false,
          firstFrameRendered: true,
        };
      });

      const currentOptions = optionsRef.current;
      if (!currentOptions?.roomId) return;
      const sessionId = currentOptions.roomId;
      markRemoteSeenOnServer(source);
      if (remoteFirstFrameTrackedRef.current) return;
      remoteFirstFrameTrackedRef.current = true;

      const nowMs = Date.now();
      const entry = activePreparedEntryCacheRef.current;
      const bothReadyToFirstRemoteFrameMs =
        entry?.bothReadyObservedAtMs == null
          ? null
          : Math.max(0, nowMs - entry.bothReadyObservedAtMs);
      vdbg("daily_remote_first_frame_rendered", {
        sessionId: optionsRef.current?.roomId ?? null,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        source,
        bothReadyToFirstRemoteFrameMs,
      });
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId: currentOptions.eventId ?? null,
        sourceSurface: "video_date_daily",
        checkpoint: "first_remote_frame",
        nowMs,
        entryAttemptId:
          entry?.entryAttemptId ?? entry?.value.entry_attempt_id ?? null,
        videoDateTraceId:
          entry?.value.video_date_trace_id ?? entry?.entryAttemptId ?? null,
        cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
        providerVerifySkipped:
          entry?.value.provider_verify_skipped ??
          lastProviderVerifySkippedRef.current,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "first_remote_frame",
          sourceAction: source,
          outcome: "success",
          durationMs: bothReadyToFirstRemoteFrameMs,
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_FIRST_REMOTE_FRAME, {
        platform: "web",
        session_id: sessionId,
        event_id: currentOptions.eventId ?? null,
        source_surface: "video_date_daily",
        source_action: source,
        source,
        bothReadyToFirstRemoteFrameMs,
        duration_ms: bothReadyToFirstRemoteFrameMs,
        latency_bucket: bucketVideoDateLatencyMs(bothReadyToFirstRemoteFrameMs),
        media_handoff_used: lastMediaHandoffUsedRef.current,
        media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        daily_prewarm_consumed: lastDailyPrewarmConsumedRef.current,
        prewarmed_join_in_flight: lastPrewarmedJoinInFlightRef.current,
        prewarmed_already_joined: lastPrewarmedAlreadyJoinedRef.current,
        provider_verify_skipped:
          entry?.value.provider_verify_skipped ??
          lastProviderVerifySkippedRef.current,
      });
    },
    [markRemoteSeenOnServer],
  );
  return {
    markRemoteSeenOnServer,
    markRemoteFirstFrameRendered,
  };
}

export type VideoDateRemoteSeenApi = ReturnType<typeof useVideoDateRemoteSeen>;
