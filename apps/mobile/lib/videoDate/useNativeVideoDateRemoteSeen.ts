import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
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
  getVideoDateDailyOwner,
  getVideoDateEntryOwner,
  subscribeVideoDateDailyOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";
import {
  buildVideoDateRemoteSeenProviderMissingPayload,
  isVideoDateRemoteSeenRenderEvidenceSource,
  normalizeVideoDateRemoteSeenEvidenceSource,
  VIDEO_DATE_REMOTE_SEEN_PENDING_EVIDENCE_TTL_MS,
} from "@clientShared/matching/videoDateRemoteSeenEvidence";

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

type NativeRemoteSeenPendingEvidence = {
  createdAtMs: number;
  roomName: string | null;
  sessionId: string;
  source: string;
  userId: string;
};

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

  const remoteSeenPendingEvidenceRef =
    useRef<NativeRemoteSeenPendingEvidence | null>(null);

  const markRemoteSeenOnServer = useCallback(
    (source: string) => {
      if (!sessionId || !user?.id) return;
      const userId = user.id;
      const nowMs = Date.now();
      const baseEvidenceSource =
        normalizeVideoDateRemoteSeenEvidenceSource(source);
      const forceRestamp =
        isVideoDateRemoteSeenRenderEvidenceSource(baseEvidenceSource);
      if (forceRestamp) {
        const pending = remoteSeenPendingEvidenceRef.current;
        remoteSeenPendingEvidenceRef.current = {
          createdAtMs:
            pending?.sessionId === sessionId &&
            pending.userId === userId &&
            pending.source === baseEvidenceSource
              ? pending.createdAtMs
              : nowMs,
          roomName: roomNameRef.current,
          sessionId,
          source: baseEvidenceSource,
          userId,
        };
      }
      if (remoteSeenInFlightSessionRef.current === sessionId) return;
      const lastStamp = remoteSeenLastStampRef.current;
      if (
        !forceRestamp &&
        lastStamp?.sessionId === sessionId &&
        nowMs - lastStamp.stampedAtMs < REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS
      ) {
        return;
      }

      const buildProviderBoundRemoteSeenArgs = (
        attemptSource: string,
        attempt: number,
      ) => {
        const call = callRef.current;
        const callProviderSessionId = readNativeDailyProviderSessionId(call);
        const meetingState = safeNativeDailyMeetingState(call);
        const identity = activeNativeDailyCallIdentityRef.current;
        const identityCurrent =
          identity?.sessionId === sessionId && identity.userId === userId
            ? identity
            : null;
        const entryOwner = getVideoDateEntryOwner(sessionId, userId);
        const dailyOwner = getVideoDateDailyOwner({
          sessionId,
          userId,
          roomName: roomNameRef.current,
        });
        const providerSessionId =
          callProviderSessionId ??
          entryOwner?.providerSessionId ??
          dailyOwner?.providerSessionId ??
          null;
        const providerBackedJoined =
          meetingState === "joined-meeting" && Boolean(providerSessionId);
        const ownerId =
          identityCurrent?.ownerId ??
          entryOwner?.ownerId ??
          dailyOwner?.ownerId ??
          null;
        const callInstanceId =
          identityCurrent?.callInstanceId ??
          entryOwner?.callInstanceId ??
          dailyOwner?.callInstanceId ??
          null;
        const entryAttemptId =
          identityCurrent?.entryAttemptId ??
          entryOwner?.entryAttemptId ??
          dailyOwner?.entryAttemptId ??
          null;
        const videoDateTraceId =
          identityCurrent?.videoDateTraceId ??
          entryOwner?.videoDateTraceId ??
          dailyOwner?.videoDateTraceId ??
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
          const payload = buildVideoDateRemoteSeenProviderMissingPayload({
            code,
            retryAfterMs: REMOTE_SEEN_RPC_RETRY_DELAY_MS,
            terminal,
          });
          vdbg(
            terminal
              ? "mark_video_date_remote_seen_skipped_provider_missing"
              : "mark_video_date_remote_seen_provider_pending",
            {
              sessionId,
              eventId,
              userId,
              source: attemptSource,
              baseEvidenceSource,
              code,
              attempt,
              providerSessionId,
              callProviderSessionId,
              meetingState,
              providerBackedJoined,
              callInstanceId,
              ownerId,
              terminal,
              retryable: payload.retryable,
              willRetry: payload.retryable === true,
              hasIdentityCallInstance: Boolean(identityCurrent?.callInstanceId),
              hasEntryOwnerCallInstance: Boolean(entryOwner?.callInstanceId),
              hasDailyOwnerCallInstance: Boolean(dailyOwner?.callInstanceId),
              hasCallProviderSession: Boolean(callProviderSessionId),
              hasEntryOwnerProviderSession: Boolean(
                entryOwner?.providerSessionId,
              ),
              hasDailyOwnerProviderSession: Boolean(
                dailyOwner?.providerSessionId,
              ),
              pendingEvidenceAgeMs:
                remoteSeenPendingEvidenceRef.current?.sessionId === sessionId
                  ? Math.max(
                      0,
                      nowMs - remoteSeenPendingEvidenceRef.current.createdAtMs,
                    )
                  : null,
            },
          );
          return {
            ok: false as const,
            code,
            payload,
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
          remoteSeenPendingEvidenceRef.current = null;
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
          remoteSeenPendingEvidenceRef.current = null;
          return;
        }
        if (attempt < REMOTE_SEEN_RPC_MAX_ATTEMPTS) {
          scheduleRetry(attemptSource, attempt + 1);
          return;
        }
      };

      function stamp(attemptSource: string, attempt: number) {
        const proof = buildProviderBoundRemoteSeenArgs(attemptSource, attempt);
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
            remoteSeenPendingEvidenceRef.current = null;
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
    return subscribeVideoDateDailyOwner((owner) => {
      const pending = remoteSeenPendingEvidenceRef.current;
      if (!pending) return;
      const nowMs = Date.now();
      if (
        nowMs - pending.createdAtMs >
        VIDEO_DATE_REMOTE_SEEN_PENDING_EVIDENCE_TTL_MS
      ) {
        remoteSeenPendingEvidenceRef.current = null;
        return;
      }
      if (
        !owner ||
        owner.sessionId !== pending.sessionId ||
        owner.userId !== pending.userId
      ) {
        return;
      }
      if (
        owner.roomName &&
        pending.roomName &&
        owner.roomName !== pending.roomName
      ) {
        return;
      }
      if (owner.state !== "joined" && owner.state !== "remote_seen") return;
      if (!owner.callInstanceId || !owner.providerSessionId) return;
      if (remoteSeenActiveSessionRef.current !== pending.sessionId) return;
      if (remoteSeenInFlightSessionRef.current === pending.sessionId) return;
      vdbg("mark_video_date_remote_seen_pending_evidence_drain", {
        sessionId: pending.sessionId,
        eventId,
        userId: pending.userId,
        source: pending.source,
        ownerState: owner.state,
        ownerSource: owner.source ?? null,
        ownerRoomName: owner.roomName ?? null,
        pendingRoomName: pending.roomName,
        pendingEvidenceAgeMs: Math.max(0, nowMs - pending.createdAtMs),
        callInstanceId: owner.callInstanceId,
        providerSessionId: owner.providerSessionId,
      });
      markRemoteSeenOnServer(pending.source);
    });
  }, [
    eventId,
    markRemoteSeenOnServer,
    remoteSeenActiveSessionRef,
    remoteSeenInFlightSessionRef,
  ]);

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
      remoteSeenPendingEvidenceRef.current = null;
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
