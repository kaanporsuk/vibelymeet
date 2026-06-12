import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import { useReadyGate } from "@/lib/readyGateApi";
import { useAuth } from "@/context/AuthContext";
import { eventLobbyHref, tabsRootHref } from "@/lib/activeSessionRoutes";
import { RC_CATEGORY, rcBreadcrumb } from "@/lib/nativeRcDiagnostics";
import { getReadyGateCountdownFromServerClock } from "@clientShared/matching/readyGateCountdown";
import { resolveReadyGateTransitionFailureCopy } from "@clientShared/matching/readyGateDiagnosticCopy";
import { router } from "expo-router";

/**
 * Forfeit + expiry concern of the native Ready Gate screen: explicit skip forfeit and the expired-gate server sync.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/ready/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

const EXPIRY_SYNC_RETRY_DELAY_MS = 3_000;
export interface NativeReadyGateForfeitExpiryDeps {
  GATE_TIMEOUT_SEC: number;
  cancelTerminalReadyGateWork: (cancelReason: string) => void;
  clientSyncedAtMs: ReturnType<typeof useReadyGate>["clientSyncedAtMs"];
  eventId: string | null;
  expirySyncInFlightRef: MutableRefObject<boolean>;
  expirySyncRetryAtMsRef: MutableRefObject<number>;
  forfeit: ReturnType<typeof useReadyGate>["forfeit"];
  guardedSyncSession: (source: string, options?: { allowWhileMarking?: boolean }) => Promise<Awaited<ReturnType<ReturnType<typeof useReadyGate>["syncSession"]>> | null>;
  phaseDeadlineAtMs: ReturnType<typeof useReadyGate>["phaseDeadlineAtMs"];
  readyGateOpenedAtMsRef: MutableRefObject<number>;
  serverNowMs: ReturnType<typeof useReadyGate>["serverNowMs"];
  sessionId: string;
  sessionLookupDone: boolean;
  setTerminalActionError: Dispatch<SetStateAction<string | null>>;
  setTerminalActionPending: Dispatch<SetStateAction<boolean>>;
  setTimeLeft: Dispatch<SetStateAction<number>>;
  terminal: ReturnType<typeof useReadyGate>["terminal"];
  terminalActionPending: boolean;
  user: ReturnType<typeof useAuth>["user"];
}

export function useNativeReadyGateForfeitExpiry(deps: NativeReadyGateForfeitExpiryDeps) {
  const {
    GATE_TIMEOUT_SEC,
    cancelTerminalReadyGateWork,
    clientSyncedAtMs,
    eventId,
    expirySyncInFlightRef,
    expirySyncRetryAtMsRef,
    forfeit,
    guardedSyncSession,
    phaseDeadlineAtMs,
    readyGateOpenedAtMsRef,
    serverNowMs,
    sessionId,
    sessionLookupDone,
    setTerminalActionError,
    setTerminalActionPending,
    setTimeLeft,
    terminal,
    terminalActionPending,
    user,
  } = deps;

  const runReadyGateForfeit = useCallback(
    async (reason: 'skip') => {
      if (terminalActionPending) return;
      setTerminalActionPending(true);
      setTerminalActionError(null);
      let transitionFailure: ReturnType<
        typeof resolveReadyGateTransitionFailureCopy
      > | null = null;
      try {
        const result = await forfeit();
        if (result.ok === false) {
          transitionFailure = resolveReadyGateTransitionFailureCopy({
            action: 'forfeit',
            code: result.code,
            errorCode: result.errorCode,
            reason: result.reason,
            error: result.error,
            status: result.status,
            platform: 'native',
          });
          throw new Error(transitionFailure.message);
        }
        if (result.status === 'both_ready') {
          setTerminalActionPending(false);
          setTerminalActionError(null);
          return;
        }
        const terminal =
          result.terminal === true ||
          result.isTerminal === true ||
          result.status === 'forfeited' ||
          result.status === 'expired' ||
          result.status === 'cancelled' ||
          result.status === 'ended';
        if (!terminal) {
          transitionFailure = resolveReadyGateTransitionFailureCopy({
            action: 'forfeit',
            code: result.code,
            errorCode: result.errorCode,
            reason: result.reason ?? 'ready_gate_forfeit_not_terminal',
            status: result.status,
            platform: 'native',
          });
          throw new Error(transitionFailure.message);
        }
        setTerminalActionPending(false);
        setTerminalActionError(null);
        if (eventId) router.replace(eventLobbyHref(eventId));
        else if (sessionLookupDone) router.replace(tabsRootHref());
        cancelTerminalReadyGateWork('ready_standalone_forfeit_terminal');
      } catch (e) {
        const fallback =
          transitionFailure ??
          resolveReadyGateTransitionFailureCopy({
            action: 'forfeit',
            error: e instanceof Error ? e.message : String(e),
            platform: 'native',
          });
        setTerminalActionError(fallback.message);
        setTerminalActionPending(false);
        rcBreadcrumb(
          RC_CATEGORY.readyGate,
          'standalone_forfeit_failed_kept_open',
          {
            session_id: sessionId ?? null,
            event_id: eventId,
            reason,
            reason_code: fallback.reasonCode,
            error_code: fallback.code ?? fallback.reasonCode,
            multi_device_conflict: fallback.staleOrConflict,
            message_snippet:
              e instanceof Error ? e.message.slice(0, 120) : 'unknown',
          },
        );
      }
    },
    [
      cancelTerminalReadyGateWork,
      eventId,
      forfeit,
      sessionId,
      sessionLookupDone,
      terminalActionPending,
    ],
  );

  const syncExpiredReadyGate = useCallback(
    async (source: string) => {
      if (!sessionId || !user?.id) return;
      const now = Date.now();
      if (expirySyncInFlightRef.current || expirySyncRetryAtMsRef.current > now)
        return;

      expirySyncInFlightRef.current = true;
      expirySyncRetryAtMsRef.current = now + EXPIRY_SYNC_RETRY_DELAY_MS;
      try {
        const result = await guardedSyncSession(source);
        if (result?.ok === true && result.expiresAt) {
          setTimeLeft(
            getReadyGateCountdownFromServerClock({
              expiresAt: phaseDeadlineAtMs ?? result.expiresAt,
              serverNowMs,
              clientSyncedAtMs,
              fallbackDeadlineMs:
                readyGateOpenedAtMsRef.current + GATE_TIMEOUT_SEC * 1000,
              fallbackSeconds: GATE_TIMEOUT_SEC,
            }).remainingSeconds,
          );
          return;
        }
        if (result?.ok === false) {
          rcBreadcrumb(
            RC_CATEGORY.readyGate,
            'standalone_countdown_expiry_sync_deferred',
            {
              session_id: sessionId,
              source,
              error: result.error,
            },
          );
        }
      } finally {
        expirySyncInFlightRef.current = false;
      }
    },
    [
      clientSyncedAtMs,
      phaseDeadlineAtMs,
      serverNowMs,
      sessionId,
      guardedSyncSession,
      user?.id,
    ],
  );

  return {
    runReadyGateForfeit,
    syncExpiredReadyGate,
  };
}

export type NativeReadyGateForfeitExpiryApi = ReturnType<typeof useNativeReadyGateForfeitExpiry>;
