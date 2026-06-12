import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
} from "react";
import {
  trackEvent,
} from "@/lib/analytics";
import {
  type DailyCallObject,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  vdbg,
} from "@/lib/vdbg";
import {
  NATIVE_BACKGROUND_GRACE_MS,
  NATIVE_BACKGROUND_GRACE_SECONDS,
  NATIVE_BACKGROUND_RECOVERED_BANNER_MS,
  type NativeTerminalSurveySessionRow,
  videoDateSessionDiagnostic,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  endVideoDate,
  markReconnectReturn,
  signalVideoDateLeave,
  useVideoDateSession,
} from "@/lib/videoDateApi";
import {
  LobbyPostDateEvents,
} from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  AppState,
} from "react-native";
import type { NativeVideoDateCallEndCleanupApi } from "./useNativeVideoDateCallEndCleanup";

/**
 * Foreground/background concern of the native Video Date screen: makes app backgrounding server-observable and bounded (away stamps, grace countdown, recovered banner).
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeVideoDateAppStateBackgroundDeps {
  appStateAwaySessionRef: MutableRefObject<string | null>;
  appStateBackgroundIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  appStateBackgroundStartedAtRef: MutableRefObject<number | null>;
  appStateBackgroundTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  appStateExpiredSessionRef: MutableRefObject<string | null>;
  appStateRecoveredTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  callRef: MutableRefObject<DailyCallObject | null>;
  cleanupDailyAndLocalState: NativeVideoDateCallEndCleanupApi["cleanupDailyAndLocalState"];
  confirmNativeTerminalPostDateRecovery: ( source: string, sessionOverride?: NativeTerminalSurveySessionRow | null, ) => Promise<boolean>;
  eventId: string;
  hasStartedJoinRef: MutableRefObject<boolean>;
  localInDailyRoomRef: MutableRefObject<boolean>;
  phaseRef: MutableRefObject<ReturnType<typeof useVideoDateSession>["phase"]>;
  refetchVideoSession: ReturnType<typeof useVideoDateSession>["refetch"];
  requestReconnectSyncRef: MutableRefObject<(reason: string) => void>;
  retryBroadcastGapRecovery: ReturnType<typeof useVideoDateSession>["retryBroadcastGapRecovery"];
  roomNameRef: MutableRefObject<string | null>;
  sessionId: string;
  setJoinAttemptNonce: Dispatch<SetStateAction<number>>;
  setNativeBackgroundGraceSeconds: Dispatch<SetStateAction<number>>;
  setNativeBackgroundStatus: Dispatch<SetStateAction<"none" | "grace" | "recovered">>;
}

export function useNativeVideoDateAppStateBackground(deps: NativeVideoDateAppStateBackgroundDeps) {
  const {
    appStateAwaySessionRef,
    appStateBackgroundIntervalRef,
    appStateBackgroundStartedAtRef,
    appStateBackgroundTimerRef,
    appStateExpiredSessionRef,
    appStateRecoveredTimerRef,
    callRef,
    cleanupDailyAndLocalState,
    confirmNativeTerminalPostDateRecovery,
    eventId,
    hasStartedJoinRef,
    localInDailyRoomRef,
    phaseRef,
    refetchVideoSession,
    requestReconnectSyncRef,
    retryBroadcastGapRecovery,
    roomNameRef,
    sessionId,
    setJoinAttemptNonce,
    setNativeBackgroundGraceSeconds,
    setNativeBackgroundStatus,
  } = deps;

  /** Foreground/background: make app backgrounding server-observable and bounded. */
  useEffect(() => {
    if (!sessionId) return;
    const clearBackgroundTimeout = () => {
      if (!appStateBackgroundTimerRef.current) return;
      clearTimeout(appStateBackgroundTimerRef.current);
      appStateBackgroundTimerRef.current = null;
    };
    const clearBackgroundInterval = () => {
      if (!appStateBackgroundIntervalRef.current) return;
      clearInterval(appStateBackgroundIntervalRef.current);
      appStateBackgroundIntervalRef.current = null;
    };
    const clearRecoveredBannerTimer = () => {
      if (!appStateRecoveredTimerRef.current) return;
      clearTimeout(appStateRecoveredTimerRef.current);
      appStateRecoveredTimerRef.current = null;
    };
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        clearBackgroundTimeout();
        clearBackgroundInterval();
        if (appStateAwaySessionRef.current === sessionId) {
          appStateAwaySessionRef.current = null;
          const backgroundElapsedMs =
            appStateBackgroundStartedAtRef.current == null
              ? 0
              : Date.now() - appStateBackgroundStartedAtRef.current;
          appStateBackgroundStartedAtRef.current = null;
          const timerAlreadyExpired =
            appStateExpiredSessionRef.current === sessionId;
          const expiredInBackground =
            timerAlreadyExpired ||
            backgroundElapsedMs >= NATIVE_BACKGROUND_GRACE_MS;
          if (expiredInBackground) {
            appStateExpiredSessionRef.current = null;
            vdbg("native_background_foreground_after_expiry", {
              sessionId,
              eventId: eventId || null,
              backgroundElapsedMs,
            });
            setNativeBackgroundStatus("none");
            setNativeBackgroundGraceSeconds(0);
            if (!timerAlreadyExpired) {
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_EXPIRED,
                {
                  platform: "native",
                  session_id: sessionId,
                  event_id: eventId || null,
                  source: "app_foreground_after_background_timeout",
                  grace_ms: NATIVE_BACKGROUND_GRACE_MS,
                  elapsed_ms: backgroundElapsedMs,
                },
              );
            }
            void (async () => {
              await cleanupDailyAndLocalState({
                mode: "destructive",
                reason: "app_foreground_after_background_timeout",
              });
              const ended = await endVideoDate(
                sessionId,
                "app_background_timeout",
              );
              vdbg("native_background_timeout_end_result", {
                sessionId,
                eventId: eventId || null,
                source: "app_foreground_after_background_timeout",
                ended,
              });
              if (ended) {
                await confirmNativeTerminalPostDateRecovery(
                  "app_foreground_after_background_timeout",
                );
              } else {
                await refetchVideoSession();
              }
            })();
          } else {
            void markReconnectReturn(sessionId);
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_RECOVERED,
              {
                platform: "native",
                session_id: sessionId,
                event_id: eventId || null,
                source: "app_foreground",
              },
            );
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_RETURNED, {
              platform: "native",
              session_id: sessionId,
              event_id: eventId || null,
              source: "app_foreground",
            });
            vdbg("native_background_recovered", {
              sessionId,
              eventId: eventId || null,
              hasCall: Boolean(callRef.current),
            });
            setNativeBackgroundStatus("recovered");
            setNativeBackgroundGraceSeconds(0);
            clearRecoveredBannerTimer();
            appStateRecoveredTimerRef.current = setTimeout(() => {
              setNativeBackgroundStatus("none");
              appStateRecoveredTimerRef.current = null;
            }, NATIVE_BACKGROUND_RECOVERED_BANNER_MS);
            if (!callRef.current && phaseRef.current !== "ended") {
              hasStartedJoinRef.current = false;
              setJoinAttemptNonce((n) => n + 1);
            }
          }
        }
        videoDateSessionDiagnostic("app_foreground_refetch_start", {
          session_id: sessionId,
          room_name: roomNameRef.current ?? null,
        });
        void refetchVideoSession()
          .then(() => {
            videoDateSessionDiagnostic("app_foreground_refetch_end", {
              session_id: sessionId,
              room_name: roomNameRef.current ?? null,
            });
          })
          .catch(() => {
            videoDateSessionDiagnostic("app_foreground_refetch_end", {
              session_id: sessionId,
              room_name: roomNameRef.current ?? null,
              error: 1,
            });
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED,
              {
                platform: "native",
                session_id: sessionId,
                event_id: eventId || null,
                source: "app_foreground",
                step: "refetch_video_session",
              },
            );
          });
        requestReconnectSyncRef.current("app_foreground");
        void retryBroadcastGapRecovery("app_foreground");
        return;
      }
      if (next === "background" || next === "inactive") {
        if (
          localInDailyRoomRef.current &&
          phaseRef.current !== "ended" &&
          appStateAwaySessionRef.current !== sessionId
        ) {
          appStateAwaySessionRef.current = sessionId;
          appStateBackgroundStartedAtRef.current = Date.now();
          setNativeBackgroundStatus("grace");
          setNativeBackgroundGraceSeconds(NATIVE_BACKGROUND_GRACE_SECONDS);
          trackEvent(
            LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_GRACE_STARTED,
            {
              platform: "native",
              session_id: sessionId,
              event_id: eventId || null,
              source: "app_background",
              grace_ms: NATIVE_BACKGROUND_GRACE_MS,
            },
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_STARTED, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId || null,
            source: "app_background",
            grace_ms: NATIVE_BACKGROUND_GRACE_MS,
          });
          vdbg("native_background_grace_started", {
            sessionId,
            eventId: eventId || null,
            graceMs: NATIVE_BACKGROUND_GRACE_MS,
          });
          void (async () => {
            await cleanupDailyAndLocalState({
              mode: "destructive",
              reason: "app_background",
            });
            hasStartedJoinRef.current = false;
          })();
          clearBackgroundTimeout();
          clearBackgroundInterval();
          appStateBackgroundIntervalRef.current = setInterval(() => {
            setNativeBackgroundGraceSeconds((prev) => Math.max(0, prev - 1));
          }, 1000);
          appStateBackgroundTimerRef.current = setTimeout(() => {
            if (
              appStateAwaySessionRef.current !== sessionId ||
              phaseRef.current === "ended"
            )
              return;
            clearBackgroundInterval();
            appStateExpiredSessionRef.current = sessionId;
            appStateBackgroundStartedAtRef.current = null;
            setNativeBackgroundStatus("none");
            setNativeBackgroundGraceSeconds(0);
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_EXPIRED,
              {
                platform: "native",
                session_id: sessionId,
                event_id: eventId || null,
                source: "app_background_timeout",
                grace_ms: NATIVE_BACKGROUND_GRACE_MS,
              },
            );
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_EXPIRED, {
              platform: "native",
              session_id: sessionId,
              event_id: eventId || null,
              source: "app_background_timeout",
              grace_ms: NATIVE_BACKGROUND_GRACE_MS,
            });
            vdbg("native_background_grace_expired", {
              sessionId,
              eventId: eventId || null,
              graceMs: NATIVE_BACKGROUND_GRACE_MS,
            });
            void (async () => {
              const ok = await signalVideoDateLeave(
                sessionId,
                "app_background_timeout",
              );
              if (!ok) {
                trackEvent(
                  LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_LEAVE_SIGNAL_FAILED,
                  {
                    platform: "native",
                    session_id: sessionId,
                    event_id: eventId || null,
                    source: "app_background_timeout",
                  },
                );
              }
              await cleanupDailyAndLocalState({
                mode: "destructive",
                reason: "app_background_timeout",
              });
              const ended = await endVideoDate(
                sessionId,
                "app_background_timeout",
              );
              vdbg("native_background_timeout_end_result", {
                sessionId,
                eventId: eventId || null,
                source: "app_background_timeout",
                ended,
              });
              if (!ended) {
                await refetchVideoSession().catch(() => undefined);
              }
            })();
          }, NATIVE_BACKGROUND_GRACE_MS);
        }
        requestReconnectSyncRef.current("app_background");
      }
    });
    return () => {
      clearBackgroundTimeout();
      clearBackgroundInterval();
      clearRecoveredBannerTimer();
      appStateBackgroundStartedAtRef.current = null;
      sub.remove();
    };
  }, [
    cleanupDailyAndLocalState,
    confirmNativeTerminalPostDateRecovery,
    eventId,
    retryBroadcastGapRecovery,
    sessionId,
    refetchVideoSession,
  ]);
}

export type NativeVideoDateAppStateBackgroundApi = ReturnType<typeof useNativeVideoDateAppStateBackground>;
