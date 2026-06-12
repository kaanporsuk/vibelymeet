/**
 * Native provider-proofed `mark_video_date_daily_alive` heartbeat
 * (3s interval, provider-backed joined precheck, terminal-truth stop +
 * terminal-survey recovery handoff). Extracted verbatim from
 * `app/date/[id].tsx` (VD rebuild PR 8); shared refs/setters keep their
 * original names so contract pins keep matching and closure capture is
 * unchanged. Native twin of web `src/hooks/videoCall/useDailyAliveHeartbeat.ts`.
 */
import { useCallback, useRef, type MutableRefObject } from "react";
import { supabase } from "@/lib/supabase";
import { vdbg } from "@/lib/vdbg";
import {
  readNativeDailyProviderSessionId,
  safeNativeDailyMeetingState,
  type DailyCallObject,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  NATIVE_VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS,
  type NativeTerminalSurveySessionRow,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
} from "@clientShared/matching/videoDateLifecycleRpc";

export type NativeDailyAliveHeartbeatDeps = {
  callRef: MutableRefObject<DailyCallObject | null>;
  openNativePostDateSurveyFromTerminalTruth: (
    source: string,
    sessionOverride?: NativeTerminalSurveySessionRow | null,
  ) => Promise<boolean>;
};

export function useNativeDailyAliveHeartbeat(
  deps: NativeDailyAliveHeartbeatDeps,
) {
  const { callRef, openNativePostDateSurveyFromTerminalTruth } = deps;

  const dailyAliveHeartbeatTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const dailyAliveHeartbeatKeyRef = useRef<string | null>(null);

  const clearDailyAliveHeartbeatTimer = useCallback((reason: string) => {
    if (dailyAliveHeartbeatTimerRef.current) {
      clearInterval(dailyAliveHeartbeatTimerRef.current);
      dailyAliveHeartbeatTimerRef.current = null;
    }
    if (dailyAliveHeartbeatKeyRef.current) {
      vdbg("mark_video_date_daily_alive_stopped", {
        reason,
        heartbeatKey: dailyAliveHeartbeatKeyRef.current,
      });
      dailyAliveHeartbeatKeyRef.current = null;
    }
  }, []);

  const markNativeVideoDateDailyAlive = useCallback(
    async (input: {
      sessionId: string;
      userId: string;
      roomName: string | null;
      entryAttemptId?: string | null;
      videoDateTraceId?: string | null;
      callInstanceId?: string | null;
      source: string;
    }) => {
      const call = callRef.current;
      const providerSessionId = readNativeDailyProviderSessionId(call);
      const meetingState = safeNativeDailyMeetingState(call);
      const providerBackedJoined =
        meetingState === "joined-meeting" && Boolean(providerSessionId);
      const dailyOwnerState = providerBackedJoined
        ? "joined"
        : meetingState === "left-meeting" || meetingState === "error"
          ? "lost"
          : "joining";
      const entryOwner = getVideoDateEntryOwner(input.sessionId, input.userId);
      const ownerId = entryOwner?.ownerId ?? null;
      updateVideoDateDailyOwnerState({
        sessionId: input.sessionId,
        userId: input.userId,
        ownerId,
        roomName: input.roomName,
        state: dailyOwnerState,
        source: input.source,
        entryAttemptId:
          input.entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
        videoDateTraceId:
          input.videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
        callInstanceId: input.callInstanceId ?? null,
        providerSessionId,
      });
      updateVideoDateEntryOwnerState({
        sessionId: input.sessionId,
        userId: input.userId,
        ownerId,
        state: providerBackedJoined ? "joined" : "joining",
        source: input.source,
        roomName: input.roomName,
        entryAttemptId:
          input.entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
        videoDateTraceId:
          input.videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
        callInstanceId: input.callInstanceId ?? null,
        providerSessionId,
      });

      if (!providerBackedJoined) {
        vdbg("mark_video_date_daily_alive_skipped_provider_missing", {
          sessionId: input.sessionId,
          userId: input.userId,
          roomName: input.roomName,
          source: input.source,
          ownerId,
          callInstanceId: input.callInstanceId ?? null,
          providerSessionId,
          meetingState,
          ownerState: dailyOwnerState,
          terminal: dailyOwnerState === "lost",
        });
        if (dailyOwnerState === "lost") {
          clearDailyAliveHeartbeatTimer("provider_missing_terminal_state");
        }
        return;
      }

      const args = {
        p_session_id: input.sessionId,
        p_owner_id: ownerId,
        p_call_instance_id: input.callInstanceId ?? null,
        p_provider_session_id: providerSessionId,
        p_entry_attempt_id:
          input.entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
        p_owner_state: dailyOwnerState,
      };
      try {
        const { data, error } = await (
          supabase as unknown as {
            rpc: (
              name: string,
              args: Record<string, unknown>,
            ) => Promise<{
              data: unknown;
              error: { code?: string; message?: string } | null;
            }>;
          }
        ).rpc("mark_video_date_daily_alive", args);
        vdbg("mark_video_date_daily_alive_after", {
          sessionId: input.sessionId,
          userId: input.userId,
          roomName: input.roomName,
          source: input.source,
          ownerId,
          callInstanceId: input.callInstanceId ?? null,
          providerSessionId,
          providerBackedJoined,
          meetingState,
          ownerState: dailyOwnerState,
          payload: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
        });
        const payload =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : null;
        const terminalSurvey =
          videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
        const terminalStop =
          terminalSurvey ||
          videoDateLifecycleRpcIndicatesTerminalStop(payload) ||
          payload?.provider_presence_terminal === true;
        if (terminalStop) {
          clearDailyAliveHeartbeatTimer(
            videoDateLifecycleRpcCode(payload) === "session_ended"
              ? "server_session_ended"
              : payload?.provider_presence_terminal === true
                ? "provider_presence_terminal"
                : "server_terminal_truth",
          );
          if (terminalSurvey) {
            void openNativePostDateSurveyFromTerminalTruth(
              "daily_alive_terminal_survey_truth",
            );
          }
        }
      } catch (error) {
        vdbg("mark_video_date_daily_alive_failed", {
          sessionId: input.sessionId,
          userId: input.userId,
          roomName: input.roomName,
          source: input.source,
          ownerId,
          callInstanceId: input.callInstanceId ?? null,
          providerSessionId,
          providerBackedJoined,
          meetingState,
          ownerState: dailyOwnerState,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
    },
    [callRef, clearDailyAliveHeartbeatTimer, openNativePostDateSurveyFromTerminalTruth],
  );

  const startDailyAliveHeartbeat = useCallback(
    (input: {
      sessionId: string;
      userId: string;
      roomName: string | null;
      entryAttemptId?: string | null;
      videoDateTraceId?: string | null;
      callInstanceId?: string | null;
      source: string;
    }) => {
      const heartbeatKey = `${input.sessionId}:${input.userId}:${input.roomName ?? ""}:${input.callInstanceId ?? ""}`;
      if (dailyAliveHeartbeatKeyRef.current === heartbeatKey) {
        void markNativeVideoDateDailyAlive(input);
        return;
      }
      clearDailyAliveHeartbeatTimer("heartbeat_replaced");
      dailyAliveHeartbeatKeyRef.current = heartbeatKey;
      void markNativeVideoDateDailyAlive(input);
      dailyAliveHeartbeatTimerRef.current = setInterval(() => {
        void markNativeVideoDateDailyAlive({
          ...input,
          source: "daily_alive_heartbeat",
        });
      }, NATIVE_VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS);
    },
    [clearDailyAliveHeartbeatTimer, markNativeVideoDateDailyAlive],
  );

  return {
    clearDailyAliveHeartbeatTimer,
    markNativeVideoDateDailyAlive,
    startDailyAliveHeartbeat,
  };
}
