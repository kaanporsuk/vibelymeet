import { useCallback, useEffect, useRef } from "react";
import { DailyCall } from "@daily-co/daily-js";
import * as Sentry from "@sentry/react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
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
import {
  readDailyProviderSessionId,
  safeMeetingState,
  VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS,
} from "@/lib/daily/webDailyMediaHelpers";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";

/**
 * Daily keepalive + runtime health concern of the web Video Date call
 * (Video Date rebuild PR 7.5 extraction; bodies verbatim from
 * src/hooks/useVideoCall.ts).
 *
 * Owns the provider-proofed mark_video_date_daily_alive heartbeat, Daily
 * listener/token-timer teardown helpers, the network-tier receive-settings
 * adaptation, and the Daily SDK unresponsive watchdog.
 */
export function useDailyAliveHeartbeat(deps: VideoCallSharedRuntime) {
  const {
    callObjectRef,
    dailyEventListenerCleanupsRef,
    dailyTokenRefreshTimerRef,
    isConnected,
    isConnecting,
    networkTier,
    options,
    optionsRef,
  } = deps;

  const dailySdkUnresponsiveKeyRef = useRef<string | null>(null);
  const resilienceReceiveSettingsKeyRef = useRef<string | null>(null);
  const dailyAliveHeartbeatTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const dailyAliveHeartbeatKeyRef = useRef<string | null>(null);

  const clearDailyEventListeners = useCallback((reason: string) => {
    const cleanups = dailyEventListenerCleanupsRef.current;
    if (cleanups.length === 0) return;
    dailyEventListenerCleanupsRef.current = [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        vdbg("daily_call_listener_cleanup_failed", {
          reason,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
    }
    vdbg("daily_call_listeners_cleared", {
      reason,
      count: cleanups.length,
    });
  }, []);

  const clearDailyTokenRefreshTimer = useCallback(() => {
    if (!dailyTokenRefreshTimerRef.current) return;
    clearTimeout(dailyTokenRefreshTimerRef.current);
    dailyTokenRefreshTimerRef.current = null;
  }, []);

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

  const markVideoDateDailyAlive = useCallback(
    async (input: {
      sessionId: string;
      userId: string;
      roomName: string | null;
      entryAttemptId?: string | null;
      videoDateTraceId?: string | null;
      callInstanceId?: string | null;
      source: string;
    }) => {
      const call = callObjectRef.current;
      const providerSessionId = readDailyProviderSessionId(call);
      const meetingState = safeMeetingState(call);
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
            optionsRef.current?.onTerminalSurveyTruth?.(
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
    [clearDailyAliveHeartbeatTimer],
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
        void markVideoDateDailyAlive(input);
        return;
      }
      clearDailyAliveHeartbeatTimer("heartbeat_replaced");
      dailyAliveHeartbeatKeyRef.current = heartbeatKey;
      void markVideoDateDailyAlive(input);
      dailyAliveHeartbeatTimerRef.current = setInterval(() => {
        void markVideoDateDailyAlive({
          ...input,
          source: "daily_alive_heartbeat",
        });
      }, VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS);
    },
    [clearDailyAliveHeartbeatTimer, markVideoDateDailyAlive],
  );

  useEffect(() => {
    const sessionId = options?.roomId ?? null;
    if (!sessionId) return;
    if (!isConnected) {
      resilienceReceiveSettingsKeyRef.current = null;
      return;
    }

    const mode = networkTier === "poor" ? "audio_priority" : "standard";
    if (mode === "standard" && resilienceReceiveSettingsKeyRef.current === null)
      return;

    const key = `${sessionId}:${mode}`;
    if (resilienceReceiveSettingsKeyRef.current === key) return;

    const call = callObjectRef.current;
    const payload = {
      platform: "web",
      session_id: sessionId,
      event_id: options?.eventId ?? null,
      network_tier: networkTier,
      adaptation: mode,
    };

    if (!call || typeof call.updateReceiveSettings !== "function") {
      resilienceReceiveSettingsKeyRef.current = key;
      trackEvent("video_date_resilience_daily_adaptation", {
        ...payload,
        capability_available: false,
        outcome: "unsupported",
      });
      return;
    }

    const receiveSettings: Parameters<DailyCall["updateReceiveSettings"]>[0] =
      mode === "audio_priority"
        ? { "*": { video: { layer: 0 } } }
        : { "*": "inherit" };
    resilienceReceiveSettingsKeyRef.current = key;
    void call
      .updateReceiveSettings(receiveSettings)
      .then(() => {
        trackEvent("video_date_resilience_daily_adaptation", {
          ...payload,
          capability_available: true,
          outcome: "applied",
        });
      })
      .catch((error) => {
        trackEvent("video_date_resilience_daily_adaptation", {
          ...payload,
          capability_available: true,
          outcome: "failed",
          reason:
            error instanceof Error ? error.message.slice(0, 120) : "unknown",
        });
      });
  }, [
    isConnected,
    networkTier,
    options?.eventId,
    options?.roomId,
  ]);

  useEffect(() => {
    if (!isConnecting && !isConnected) {
      dailySdkUnresponsiveKeyRef.current = null;
      return;
    }

    const emitUnresponsive = (
      reason: string,
      meetingState: string | null,
      error?: unknown,
    ) => {
      const sessionId = optionsRef.current?.roomId ?? null;
      const key = `${sessionId ?? "unknown"}:${reason}:${meetingState ?? "none"}`;
      if (dailySdkUnresponsiveKeyRef.current === key) return;
      dailySdkUnresponsiveKeyRef.current = key;
      const payload = {
        platform: "web",
        session_id: sessionId,
        event_id: optionsRef.current?.eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "daily_sdk_heartbeat",
        reason,
        daily_meeting_state: meetingState,
        connected: isConnected,
        connecting: isConnecting,
      };
      trackEvent(
        LobbyPostDateEvents.VIDEO_DATE_DAILY_SDK_UNRESPONSIVE,
        payload,
      );
      Sentry.captureMessage("video_date_daily_sdk_unresponsive", {
        level: "warning",
        extra: {
          ...payload,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : (error ?? null),
        },
      });
    };

    const intervalId = setInterval(() => {
      const call = callObjectRef.current as
        | (DailyCall & { meetingState?: () => unknown })
        | null;
      if (!call || typeof call.meetingState !== "function") return;
      let meetingState: string | null = null;
      try {
        const state = call.meetingState();
        meetingState =
          typeof state === "string"
            ? state
            : state == null
              ? null
              : String(state);
      } catch (error) {
        emitUnresponsive("meeting_state_throw", null, error);
        return;
      }
      if (
        meetingState === "error" ||
        (isConnected && meetingState === "left-meeting")
      ) {
        emitUnresponsive("unexpected_meeting_state", meetingState);
      }
    }, 5_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected, isConnecting]);

  return {
    clearDailyEventListeners,
    clearDailyTokenRefreshTimer,
    clearDailyAliveHeartbeatTimer,
    markVideoDateDailyAlive,
    startDailyAliveHeartbeat,
  };
}

export type DailyAliveHeartbeatApi = ReturnType<typeof useDailyAliveHeartbeat>;
