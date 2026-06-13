import { useCallback, useEffect } from "react";
import * as Sentry from "@sentry/react";
import {
  VideoDateSessionBroadcastEvent,
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
} from "@clientShared/matching/videoDateSessionChannel";
import { fetchVideoDateSnapshot } from "@/lib/videoDateSnapshot";
import {
  mergeVideoDateBroadcastGapRecovery,
  recordVideoDateBroadcastGapRecoveryFailure,
  recordVideoDateBroadcastGapRecoverySuccess,
  shouldAttemptVideoDateBroadcastGapRecovery,
  shouldRetainVideoDateBroadcastGapRecoveryForEvent,
  videoDateBroadcastGapRetryDelayMs,
} from "@clientShared/matching/videoDateBroadcastGapRecovery";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { vdbg } from "@/lib/vdbg";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { VideoDateBroadcastGapRecoveryState } from "@clientShared/matching/videoDateBroadcastGapRecovery";
import { useCredits } from "@/hooks/useCredits";
import type { CallPhase, VideoDateAccess } from "./videoDatePageShared";
import type { TerminalSurveyRecoveryApi } from "./useTerminalSurveyRecovery";

/**
 * Broadcast reconcile concern of the web Video Date page (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/pages/VideoDate.tsx).
 *
 * Owns seq-aware session-channel reconciliation: stale/duplicate broadcast
 * drops, gap-triggered snapshot recovery with bounded retries, extension
 * broadcasts, and the channel subscription lifecycle. Broadcast never
 * terminalizes directly; terminal truth always goes through refetch +
 * the terminal-survey recovery owner.
 */

type UseVideoDateBroadcastReconcileDeps = Pick<
  TerminalSurveyRecoveryApi,
  "recoverTerminalPostDateSurvey"
> & {
  applyTimelineSnapshot: (
    snapshot: Awaited<ReturnType<typeof fetchVideoDateSnapshot>>,
    source: string,
  ) => void;
  attemptBroadcastGapSnapshotRecoveryRef: MutableRefObject<
    (source: string) => void
  >;
  broadcastGapRecoveryRef: MutableRefObject<VideoDateBroadcastGapRecoveryState | null>;
  broadcastGapRetryTimerRef: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  broadcastPendingRefetchSeqRef: MutableRefObject<number | null>;
  broadcastRefetchInFlightRef: MutableRefObject<boolean>;
  eventId: string | undefined;
  extensionBroadcastSeenRef: MutableRefObject<Set<number>>;
  id: string | undefined;
  phase: CallPhase;
  refetchCredits: ReturnType<typeof useCredits>["refetch"];
  sessionSeqRef: MutableRefObject<number | null>;
  setPendingPartnerExtension: Dispatch<
    SetStateAction<{
      type: "extra_time" | "extended_vibe";
      expiresAt: string | null;
    } | null>
  >;
  setTimingRefreshNonce: Dispatch<SetStateAction<number>>;
  user: { id: string } | null;
  videoDateAccess: VideoDateAccess;
};

export function useVideoDateBroadcastReconcile(
  deps: UseVideoDateBroadcastReconcileDeps,
) {
  const {
    applyTimelineSnapshot,
    attemptBroadcastGapSnapshotRecoveryRef,
    broadcastGapRecoveryRef,
    broadcastGapRetryTimerRef,
    broadcastPendingRefetchSeqRef,
    broadcastRefetchInFlightRef,
    eventId,
    extensionBroadcastSeenRef,
    id,
    phase,
    recoverTerminalPostDateSurvey,
    refetchCredits,
    sessionSeqRef,
    setPendingPartnerExtension,
    setTimingRefreshNonce,
    user,
    videoDateAccess,
  } = deps;

  const handleExtensionBroadcastEvent = useCallback(
    (event: VideoDateSessionBroadcastEvent) => {
      if (extensionBroadcastSeenRef.current.has(event.id)) return;
      if (
        event.kind !== "date_extension_requested" &&
        event.kind !== "date_extension_applied"
      )
        return;
      extensionBroadcastSeenRef.current.add(event.id);

      const addedSeconds =
        typeof event.payload.added_seconds === "number" &&
        Number.isFinite(event.payload.added_seconds)
          ? Math.max(0, Math.floor(event.payload.added_seconds))
          : 0;
      const minutes = addedSeconds > 0 ? addedSeconds / 60 : null;
      const minutesLabel =
        minutes === null
          ? null
          : Number.isInteger(minutes)
            ? String(minutes)
            : minutes.toFixed(1);
      const creditType =
        event.payload.credit_type === "extra_time" ||
        event.payload.credit_type === "extended_vibe"
          ? event.payload.credit_type
          : null;
      const requestExpiresAt =
        typeof event.payload.request_expires_at === "string"
          ? event.payload.request_expires_at
          : null;
      const effectiveRequestExpiresAt =
        requestExpiresAt ?? new Date(Date.now() + 45_000).toISOString();

      if (event.kind === "date_extension_requested") {
        if (event.actor && event.actor === user?.id) return;
        if (creditType) {
          setPendingPartnerExtension({
            type: creditType,
            expiresAt: effectiveRequestExpiresAt,
          });
        }
        toast(
          minutesLabel
            ? `Your date asked for +${minutesLabel} min. Tap Accept +${minutesLabel} if you do too.`
            : "Your date wants to keep going. Tap +time if you do too.",
          { duration: 4000 },
        );
        trackEvent("video_date_extension_partner_requested", {
          platform: "web",
          session_id: id,
          event_id: eventId,
          credit_type: creditType,
          added_seconds: addedSeconds || null,
        });
        return;
      }

      setPendingPartnerExtension(null);
      void refetchCredits();
      if (event.actor && event.actor === user?.id) return;
      toast.success(
        `${minutesLabel ?? "Extra"} ${minutes === 1 ? "minute" : "minutes"} added!`,
        {
          duration: 2500,
        },
      );
    },
    [
      eventId,
      extensionBroadcastSeenRef,
      id,
      refetchCredits,
      setPendingPartnerExtension,
      user?.id,
    ],
  );

  const clearBroadcastGapRetryTimer = useCallback(() => {
    if (!broadcastGapRetryTimerRef.current) return;
    clearTimeout(broadcastGapRetryTimerRef.current);
    broadcastGapRetryTimerRef.current = null;
  }, [broadcastGapRetryTimerRef]);

  const attemptBroadcastGapSnapshotRecovery = useCallback(
    async (source: string) => {
      if (!id || !user?.id || videoDateAccess !== "allowed") return;
      const state = broadcastGapRecoveryRef.current;
      if (!shouldAttemptVideoDateBroadcastGapRecovery(state)) return;
      if (broadcastRefetchInFlightRef.current) return;

      broadcastRefetchInFlightRef.current = true;
      try {
        const snapshot = await fetchVideoDateSnapshot(id, {
          includeToken: false,
        });
        const latestState =
          broadcastGapRecoveryRef.current?.sessionId === state.sessionId
            ? broadcastGapRecoveryRef.current
            : state;
        if (snapshot.ok === true) {
          applyTimelineSnapshot(snapshot, source);
          sessionSeqRef.current = Math.max(
            sessionSeqRef.current ?? 0,
            snapshot.seq,
          );
          broadcastGapRecoveryRef.current =
            recordVideoDateBroadcastGapRecoverySuccess(
              latestState,
              snapshot.seq,
            );
          if (snapshot.phase === "ended") {
            const handled = await recoverTerminalPostDateSurvey(
              `${source}_terminal`,
            );
            if (handled) return;
          }
        } else {
          broadcastGapRecoveryRef.current =
            recordVideoDateBroadcastGapRecoveryFailure(
              latestState,
              snapshot.error,
            );
        }
        Sentry.addBreadcrumb({
          category: "video-date-broadcast",
          message: "snapshot_refetch_on_seq_gap_retry",
          level: snapshot.ok ? "info" : "warning",
          data: {
            session_id: id,
            event_id: eventId ?? null,
            source,
            target_seq: state.targetSeq,
            expected_seq: state.expectedSeq,
            attempt: state.attempts + 1,
            snapshot_ok: snapshot.ok,
          },
        });
        setTimingRefreshNonce((n) => n + 1);
      } catch (error) {
        broadcastGapRecoveryRef.current =
          recordVideoDateBroadcastGapRecoveryFailure(state, error);
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }

      clearBroadcastGapRetryTimer();
      const delayMs = videoDateBroadcastGapRetryDelayMs(
        broadcastGapRecoveryRef.current,
      );
      if (delayMs != null) {
        broadcastGapRetryTimerRef.current = setTimeout(() => {
          broadcastGapRetryTimerRef.current = null;
          void attemptBroadcastGapSnapshotRecovery("bounded_timer");
        }, delayMs);
      }
    },
    [
      applyTimelineSnapshot,
      broadcastGapRecoveryRef,
      broadcastGapRetryTimerRef,
      broadcastRefetchInFlightRef,
      clearBroadcastGapRetryTimer,
      eventId,
      id,
      recoverTerminalPostDateSurvey,
      sessionSeqRef,
      setTimingRefreshNonce,
      user?.id,
      videoDateAccess,
    ],
  );
  attemptBroadcastGapSnapshotRecoveryRef.current = (source: string) => {
    void attemptBroadcastGapSnapshotRecovery(source);
  };

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!id || !user?.id || videoDateAccess !== "allowed") return;
      const decision = resolveVideoDateSessionSeqDecision(
        sessionSeqRef.current,
        event.sessionSeq,
      );
      if (decision.action === "invalid" || decision.action === "duplicate")
        return;

      handleExtensionBroadcastEvent(event);
      if (decision.action === "gap") {
        broadcastGapRecoveryRef.current = mergeVideoDateBroadcastGapRecovery(
          broadcastGapRecoveryRef.current,
          {
            sessionId: id,
            targetSeq: event.sessionSeq,
            expectedSeq: decision.expectedSeq,
          },
        );
        if (broadcastRefetchInFlightRef.current) {
          broadcastPendingRefetchSeqRef.current = Math.max(
            broadcastPendingRefetchSeqRef.current ?? 0,
            event.sessionSeq,
          );
          return;
        }
        void attemptBroadcastGapSnapshotRecovery("broadcast_seq_gap");
        return;
      }

      const shouldRetainGapRecovery =
        shouldRetainVideoDateBroadcastGapRecoveryForEvent(
          broadcastGapRecoveryRef.current,
          event.sessionSeq,
        );
      if (!shouldRetainGapRecovery) {
        clearBroadcastGapRetryTimer();
        broadcastGapRecoveryRef.current = null;
      }
      sessionSeqRef.current = event.sessionSeq;
      if (broadcastRefetchInFlightRef.current) {
        broadcastPendingRefetchSeqRef.current = Math.max(
          broadcastPendingRefetchSeqRef.current ?? 0,
          event.sessionSeq,
        );
        return;
      }
      broadcastRefetchInFlightRef.current = true;
      try {
        let pendingRefetchSeq: number | null = event.sessionSeq;
        while (pendingRefetchSeq !== null) {
          const refetchSeq = pendingRefetchSeq;
          broadcastPendingRefetchSeqRef.current = null;
          const snapshot = await fetchVideoDateSnapshot(id, {
            includeToken: false,
          });
          if (snapshot.ok === true) {
            applyTimelineSnapshot(
              snapshot,
              refetchSeq === event.sessionSeq
                ? "broadcast_seq_gap"
                : "broadcast_queued_seq",
            );
            sessionSeqRef.current = Math.max(
              sessionSeqRef.current ?? 0,
              snapshot.seq,
            );
            if (snapshot.phase === "ended") {
              const handled = await recoverTerminalPostDateSurvey(
                "broadcast_snapshot_terminal",
              );
              if (handled) return;
            }
          }
          Sentry.addBreadcrumb({
            category: "video-date-broadcast",
            message: "snapshot_refetch_on_seq_gap",
            level: snapshot.ok ? "info" : "warning",
            data: {
              session_id: id,
              event_id: eventId ?? null,
              event_kind: event.kind,
              incoming_seq: refetchSeq,
              expected_seq: null,
              snapshot_ok: snapshot.ok,
            },
          });
          pendingRefetchSeq = broadcastPendingRefetchSeqRef.current;
        }
        setTimingRefreshNonce((n) => n + 1);
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }
      if (shouldRetainGapRecovery) {
        void attemptBroadcastGapSnapshotRecovery("broadcast_event_progress");
      } else if (broadcastGapRecoveryRef.current) {
        void attemptBroadcastGapSnapshotRecovery("broadcast_refetch_complete");
      }
    },
    [
      applyTimelineSnapshot,
      attemptBroadcastGapSnapshotRecovery,
      broadcastGapRecoveryRef,
      broadcastPendingRefetchSeqRef,
      broadcastRefetchInFlightRef,
      clearBroadcastGapRetryTimer,
      eventId,
      handleExtensionBroadcastEvent,
      id,
      recoverTerminalPostDateSurvey,
      sessionSeqRef,
      setTimingRefreshNonce,
      user?.id,
      videoDateAccess,
    ],
  );

  useEffect(() => {
    if (!id || !user?.id || videoDateAccess !== "allowed") return;
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId: id,
      onEvent: (event) => {
        void reconcileBroadcastEvent(event);
      },
      onInvalidPayload: () => {
        vdbg("video_date_broadcast_invalid_payload_ignored", {
          sessionId: id,
          eventId: eventId ?? null,
        });
      },
      onStatusChange: (status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          vdbg("video_date_broadcast_channel_degraded", {
            sessionId: id,
            eventId: eventId ?? null,
            status,
            error: error instanceof Error ? error.message : String(error ?? ""),
          });
        }
      },
    });
    return () => {
      subscription.unsubscribe();
      clearBroadcastGapRetryTimer();
      broadcastGapRecoveryRef.current = null;
    };
  }, [
    broadcastGapRecoveryRef,
    clearBroadcastGapRetryTimer,
    eventId,
    id,
    reconcileBroadcastEvent,
    user?.id,
    videoDateAccess,
  ]);
  return {
    handleExtensionBroadcastEvent,
    clearBroadcastGapRetryTimer,
    attemptBroadcastGapSnapshotRecovery,
    reconcileBroadcastEvent,
  };
}

export type VideoDateBroadcastReconcileApi = ReturnType<
  typeof useVideoDateBroadcastReconcile
>;
