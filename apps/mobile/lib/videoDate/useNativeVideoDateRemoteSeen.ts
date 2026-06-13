import {
  type MutableRefObject,
  useCallback,
  useEffect,
} from "react";
import {
  useAuth,
} from "@/context/AuthContext";
import {
  type ActiveNativeDailyCallIdentity,
  type DailyCallObject,
  readNativeDailyProviderSessionId,
  safeNativeDailyMeetingState,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  supabase,
} from "@/lib/supabase";
import {
  vdbg,
} from "@/lib/vdbg";
import {
  useNativeDailyAliveHeartbeat,
} from "@/lib/videoDate/useNativeDailyAliveHeartbeat";
import {
  type NativeTerminalSurveySessionRow,
  REMOTE_SEEN_RPC_MAX_ATTEMPTS,
  REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS,
  REMOTE_SEEN_RPC_RETRY_DELAY_MS,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  useVideoDateSession,
} from "@/lib/videoDateApi";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";

/**
 * Remote-seen evidence concern of the native Video Date screen: provider-bound mark_video_date_remote_seen stamping with bounded retries plus the per-session reset effect.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeVideoDateRemoteSeenDeps {
  activeNativeDailyCallIdentityRef: MutableRefObject<ActiveNativeDailyCallIdentity | null>;
  callRef: MutableRefObject<DailyCallObject | null>;
  clearDailyAliveHeartbeatTimer: ReturnType<typeof useNativeDailyAliveHeartbeat>["clearDailyAliveHeartbeatTimer"];
  eventId: string;
  markRemoteSeenOnServerRef: MutableRefObject<((source: string) => void) | null>;
  openNativePostDateSurveyFromTerminalTruth: ( source: string, sessionOverride?: NativeTerminalSurveySessionRow | null, ) => Promise<boolean>;
  refetchVideoSession: ReturnType<typeof useVideoDateSession>["refetch"];
  remoteSeenActiveSessionRef: MutableRefObject<string | null>;
  remoteSeenInFlightSessionRef: MutableRefObject<string | null>;
  remoteSeenLastStampRef: MutableRefObject<{ sessionId: string; stampedAtMs: number; } | null>;
  remoteSeenRetryTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  roomNameRef: MutableRefObject<string | null>;
  sessionId: string;
  user: ReturnType<typeof useAuth>["user"];
}

export function useNativeVideoDateRemoteSeen(deps: NativeVideoDateRemoteSeenDeps) {
  const {
    activeNativeDailyCallIdentityRef,
    callRef,
    clearDailyAliveHeartbeatTimer,
    eventId,
    markRemoteSeenOnServerRef,
    openNativePostDateSurveyFromTerminalTruth,
    refetchVideoSession,
    remoteSeenActiveSessionRef,
    remoteSeenInFlightSessionRef,
    remoteSeenLastStampRef,
    remoteSeenRetryTimerRef,
    roomNameRef,
    sessionId,
    user,
  } = deps;

  const markRemoteSeenOnServer = useCallback(
    (source: string) => {
      if (!sessionId || !user?.id) return;
      const userId = user.id;
      if (remoteSeenInFlightSessionRef.current === sessionId) return;
      const nowMs = Date.now();
      const lastStamp = remoteSeenLastStampRef.current;
      const forceRestamp =
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
        const call = callRef.current;
        const providerSessionId = readNativeDailyProviderSessionId(call);
        const meetingState = safeNativeDailyMeetingState(call);
        const providerBackedJoined =
          meetingState === "joined-meeting" && Boolean(providerSessionId);
        const identity = activeNativeDailyCallIdentityRef.current;
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
          remoteSeenActiveSessionRef.current !== sessionId ||
          remoteSeenRetryTimerRef.current
        )
          return;
        remoteSeenRetryTimerRef.current = setTimeout(() => {
          remoteSeenRetryTimerRef.current = null;
          if (
            remoteSeenActiveSessionRef.current !== sessionId ||
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
            void openNativePostDateSurveyFromTerminalTruth(
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
              sessionId,
              stampedAtMs: Date.now(),
            };
            updateVideoDateEntryOwnerState({
              sessionId,
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
              sessionId,
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
            void refetchVideoSession();
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
    [
      activeNativeDailyCallIdentityRef,
      callRef,
      clearDailyAliveHeartbeatTimer,
      eventId,
      openNativePostDateSurveyFromTerminalTruth,
      refetchVideoSession,
      remoteSeenActiveSessionRef,
      remoteSeenInFlightSessionRef,
      remoteSeenLastStampRef,
      remoteSeenRetryTimerRef,
      roomNameRef,
      sessionId,
      user?.id,
    ],
  );

  useEffect(() => {
    markRemoteSeenOnServerRef.current = markRemoteSeenOnServer;
    return () => {
      if (markRemoteSeenOnServerRef.current === markRemoteSeenOnServer) {
        markRemoteSeenOnServerRef.current = null;
      }
    };
  }, [markRemoteSeenOnServer, markRemoteSeenOnServerRef]);

  useEffect(() => {
    remoteSeenActiveSessionRef.current = sessionId ?? null;
    return () => {
      if (remoteSeenRetryTimerRef.current) {
        clearTimeout(remoteSeenRetryTimerRef.current);
        remoteSeenRetryTimerRef.current = null;
      }
      remoteSeenInFlightSessionRef.current = null;
      remoteSeenLastStampRef.current = null;
      activeNativeDailyCallIdentityRef.current = null;
    };
  }, [
    activeNativeDailyCallIdentityRef,
    remoteSeenActiveSessionRef,
    remoteSeenInFlightSessionRef,
    remoteSeenLastStampRef,
    remoteSeenRetryTimerRef,
    sessionId,
  ]);

  return {
    markRemoteSeenOnServer,
  };
}

export type NativeVideoDateRemoteSeenApi = ReturnType<typeof useNativeVideoDateRemoteSeen>;
