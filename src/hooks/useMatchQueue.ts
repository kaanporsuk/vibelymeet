import { useEffect, useCallback, useState, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import {
  type DrainMatchQueueResult,
  isVideoSessionQueuedTtlExpiryTransition,
  videoSessionIdFromDrainPayload,
} from "@shared/matching/videoSessionFlow";
import { getMatchQueueDrainReasonCopy } from "@clientShared/matching/matchQueueDrainReasonCopy";
import { isMatchQueueDrainEligible } from "@clientShared/matching/matchQueueDrainEligibility";
import { isVideoDateReadyGateActiveStatus } from "@clientShared/matching/videoDateRouteDecision";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildQueueDrainResultPayload,
  EventLobbyObservabilityEvents,
} from "@clientShared/observability/eventLobbyObservability";
import {
  buildVideoDateQueueDrainIdempotencyKey,
  createVideoDateClientRequestId,
} from "@clientShared/matching/videoDateTransitionCommands";
import { fetchVideoDateQueueHint } from "@/lib/videoDateQueueHint";

type MatchQueueSourceSurface = "event_lobby" | "post_date_survey";

const QUEUED_SESSION_RECOVERY_FIRST_DRAIN_MS = 1_200;
const QUEUED_SESSION_RECOVERY_DRAIN_MS = 5_000;

interface UseMatchQueueOptions {
  eventId: string | undefined;
  currentStatus: string;
  enabled?: boolean;
  sourceSurface?: MatchQueueSourceSurface;
  suppressDrainReasonToasts?: boolean;
  /**
   * When true, post-date survey (`/date/:id`) may poll `drain_match_queue` while local status is `in_survey`
   * (fallback if `video_sessions` realtime lags). Lobby callers should omit this.
   */
  enableSurveyPhaseDrain?: boolean;
  /** Canonical: `video_sessions.id` when queue drain or realtime activates ready gate. */
  onVideoSessionReady?: (videoSessionId: string, partnerId: string) => void;
  /** Fired at most once per session id (deduped) when a queued session expires (TTL) for this user. */
  onQueuedSessionExpired?: (videoSessionId: string) => void;
}

export const useMatchQueue = ({
  eventId,
  currentStatus,
  enabled = true,
  sourceSurface = "event_lobby",
  suppressDrainReasonToasts = false,
  enableSurveyPhaseDrain,
  onVideoSessionReady,
  onQueuedSessionExpired,
}: UseMatchQueueOptions) => {
  const { user } = useUserProfile();
  const drainMatchQueueV2 = useFeatureFlag("video_date.outbox_v2.drain_match_queue");
  const [queuedCount, setQueuedCount] = useState(0);
  const [isDraining, setIsDraining] = useState(false);
  const onReadyRef = useRef(onVideoSessionReady);
  const onQueuedExpiredRef = useRef(onQueuedSessionExpired);
  /** Dedupe ready callbacks across drain polling plus realtime INSERT/UPDATE fan-out. */
  const readyNotifiedIdsRef = useRef(new Set<string>());
  /** Dedupe TTL-expiry toasts per `video_sessions.id` for this hook instance. */
  const queuedExpiryNotifiedIdsRef = useRef(new Set<string>());
  /** Dedupe informational drain-reason toasts per user/event/reason for this hook instance. */
  const drainReasonNotifiedKeysRef = useRef(new Set<string>());
  const lastQueuedCountRef = useRef(0);
  const drainInFlightRef = useRef(false);
  const activeDrainSeqRef = useRef(0);
  const activeRefreshSeqRef = useRef(0);
  const scopeRef = useRef({
    enabled,
    eventId: eventId ?? null,
    userId: user?.id ?? null,
  });

  scopeRef.current = {
    enabled,
    eventId: eventId ?? null,
    userId: user?.id ?? null,
  };

  useEffect(() => {
    onReadyRef.current = onVideoSessionReady;
  }, [onVideoSessionReady]);

  useEffect(() => {
    onQueuedExpiredRef.current = onQueuedSessionExpired;
  }, [onQueuedSessionExpired]);

  const isCurrentScope = useCallback((requestEventId: string, requestUserId: string) => {
    const scope = scopeRef.current;
    return (
      scope.enabled &&
      scope.eventId === requestEventId &&
      scope.userId === requestUserId
    );
  }, []);

  useEffect(() => {
    activeDrainSeqRef.current += 1;
    activeRefreshSeqRef.current += 1;
    drainInFlightRef.current = false;
    lastQueuedCountRef.current = 0;
    setQueuedCount(0);
    setIsDraining(false);
    readyNotifiedIdsRef.current.clear();
    queuedExpiryNotifiedIdsRef.current.clear();
    drainReasonNotifiedKeysRef.current.clear();
  }, [eventId, user?.id]);

  const notifyReadyOnce = useCallback((videoSessionId: string, partnerId: string) => {
    if (readyNotifiedIdsRef.current.has(videoSessionId)) return;
    readyNotifiedIdsRef.current.add(videoSessionId);
    onReadyRef.current?.(videoSessionId, partnerId);
  }, []);

  const refreshQueueCount = useCallback(async (minimumOnFailure = 0) => {
    if (!enabled || !eventId || !user?.id) {
      lastQueuedCountRef.current = 0;
      setQueuedCount(0);
      return;
    }

    const requestEventId = eventId;
    const requestUserId = user.id;
    const requestSeq = activeRefreshSeqRef.current + 1;
    activeRefreshSeqRef.current = requestSeq;

    const hint = await fetchVideoDateQueueHint(requestEventId, requestUserId);

    if (!isCurrentScope(requestEventId, requestUserId) || activeRefreshSeqRef.current !== requestSeq) {
      return;
    }

    if (!hint.ok) {
      if (import.meta.env.DEV) {
        console.warn("[useMatchQueue] queued hint query failed:", hint.reason ?? "unknown");
      }
      const fallbackCount = Math.max(lastQueuedCountRef.current, minimumOnFailure);
      lastQueuedCountRef.current = fallbackCount;
      setQueuedCount(fallbackCount);
      return;
    }

    const nextCount = hint.userQueuedCount;
    lastQueuedCountRef.current = nextCount;
    setQueuedCount(nextCount);
  }, [enabled, eventId, isCurrentScope, user?.id]);

  useEffect(() => {
    if (enabled) return;
    activeDrainSeqRef.current += 1;
    activeRefreshSeqRef.current += 1;
    lastQueuedCountRef.current = 0;
    drainInFlightRef.current = false;
    setQueuedCount(0);
    setIsDraining(false);
  }, [enabled]);

  const drainQueueOnce = useCallback(async (sourceAction: string) => {
    if (
      !enabled ||
      !eventId ||
      !user?.id ||
      !isMatchQueueDrainEligible(currentStatus, { enableSurveyPhaseDrain })
    ) return;

    if (drainInFlightRef.current) return;
    const requestEventId = eventId;
    const requestUserId = user.id;
    const requestSeq = activeDrainSeqRef.current + 1;
    activeDrainSeqRef.current = requestSeq;
    drainInFlightRef.current = true;
    setIsDraining(true);
    trackEvent(EventLobbyObservabilityEvents.QUEUE_DRAIN_ATTEMPTED, {
      platform: "web",
      event_id: requestEventId,
      source_surface: sourceSurface,
      source_action: sourceAction,
      queue_status: currentStatus,
    });
    try {
      const { data, error } = drainMatchQueueV2.enabled
        ? await supabase.rpc("drain_match_queue_v2" as never, {
            p_event_id: requestEventId,
            p_idempotency_key: buildVideoDateQueueDrainIdempotencyKey(
              requestEventId,
              createVideoDateClientRequestId(),
            ),
          } as never)
        : await supabase.rpc("drain_match_queue", {
            p_event_id: requestEventId,
          });

      if (!isCurrentScope(requestEventId, requestUserId) || activeDrainSeqRef.current !== requestSeq) {
        return;
      }

      if (error) {
        trackEvent(EventLobbyObservabilityEvents.QUEUE_DRAIN_RESULT, {
          ...buildQueueDrainResultPayload({
            eventId: requestEventId,
            platform: "web",
            error,
            sourceAction,
          }),
          source_surface: sourceSurface,
          queue_status: currentStatus,
        });
        return;
      }

      const result = data as DrainMatchQueueResult;
      trackEvent(EventLobbyObservabilityEvents.QUEUE_DRAIN_RESULT, {
        ...buildQueueDrainResultPayload({
          eventId: requestEventId,
          platform: "web",
          result,
          sourceAction,
        }),
        source_surface: sourceSurface,
        queue_status: currentStatus,
      });
      const reason =
        data && typeof data === "object" && "reason" in data
          ? String((data as { reason?: unknown }).reason ?? "")
          : null;
      const sessionId = videoSessionIdFromDrainPayload(result);
      if (result?.found && sessionId && result.partner_id) {
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_FOUND, {
          platform: "web",
          event_id: requestEventId,
          source_surface: sourceSurface,
          session_id: sessionId,
        });
        notifyReadyOnce(sessionId, result.partner_id);
      } else if (result?.queued || reason) {
        trackEvent(
          result?.queued
            ? LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_BLOCKED
            : LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_NOT_FOUND,
          {
            platform: "web",
            event_id: requestEventId,
            source_surface: sourceSurface,
            reason,
          },
        );
      } else {
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_NOT_FOUND, {
          platform: "web",
          event_id: requestEventId,
          source_surface: sourceSurface,
        });
      }

      const copy = result?.found ? null : getMatchQueueDrainReasonCopy(reason);
      if (copy && !suppressDrainReasonToasts) {
        const key = `${requestUserId}:${requestEventId}:${copy.reason}`;
        if (!drainReasonNotifiedKeysRef.current.has(key)) {
          drainReasonNotifiedKeysRef.current.add(key);
          toast.info(copy.message, { id: `match-queue-drain:${key}`, duration: 3800 });
        }
      }
    } catch (err) {
      console.error("Error draining queue:", err);
      if (!isCurrentScope(requestEventId, requestUserId) || activeDrainSeqRef.current !== requestSeq) {
        return;
      }
      trackEvent(EventLobbyObservabilityEvents.QUEUE_DRAIN_RESULT, {
        ...buildQueueDrainResultPayload({
          eventId: requestEventId,
          platform: "web",
          error: err,
          sourceAction,
        }),
        source_surface: sourceSurface,
        queue_status: currentStatus,
      });
    } finally {
      if (!isCurrentScope(requestEventId, requestUserId) || activeDrainSeqRef.current !== requestSeq) {
        return;
      }
      drainInFlightRef.current = false;
      setIsDraining(false);
      void refreshQueueCount();
    }
  }, [
    enabled,
    eventId,
    user?.id,
    currentStatus,
    enableSurveyPhaseDrain,
    sourceSurface,
    suppressDrainReasonToasts,
    refreshQueueCount,
    notifyReadyOnce,
    drainMatchQueueV2.enabled,
    isCurrentScope,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !eventId ||
      !user?.id ||
      !isMatchQueueDrainEligible(currentStatus, { enableSurveyPhaseDrain })
    ) return;

    void drainQueueOnce("use_match_queue");
    void refreshQueueCount();
  }, [
    enabled,
    eventId,
    user?.id,
    currentStatus,
    enableSurveyPhaseDrain,
    drainQueueOnce,
    refreshQueueCount,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !eventId ||
      !user?.id ||
      queuedCount <= 0 ||
      !isMatchQueueDrainEligible(currentStatus, { enableSurveyPhaseDrain })
    ) return;

    const firstTimer = setTimeout(() => {
      void drainQueueOnce("queued_recovery_poll");
    }, QUEUED_SESSION_RECOVERY_FIRST_DRAIN_MS);
    const intervalId = setInterval(() => {
      void drainQueueOnce("queued_recovery_poll");
    }, QUEUED_SESSION_RECOVERY_DRAIN_MS);

    return () => {
      clearTimeout(firstTimer);
      clearInterval(intervalId);
    };
  }, [
    enabled,
    eventId,
    user?.id,
    queuedCount,
    currentStatus,
    enableSurveyPhaseDrain,
    drainQueueOnce,
  ]);

  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;

    const handleUpdate = (payload: {
      new: Record<string, unknown>;
      old?: Record<string, unknown> | null;
    }) => {
      const session = payload.new as {
        id?: string;
        event_id?: string;
        participant_1_id?: string;
        participant_2_id?: string;
        ready_gate_status?: string;
      };
      if (session.event_id !== eventId || !session.id) return;

      const isParticipant =
        session.participant_1_id === user.id || session.participant_2_id === user.id;

      if (!isParticipant) return;

      const oldRow = payload.old as Record<string, unknown> | null | undefined;
      const newRow = payload.new as Record<string, unknown>;
      if (
        isVideoSessionQueuedTtlExpiryTransition(oldRow, newRow, user.id) &&
        !queuedExpiryNotifiedIdsRef.current.has(session.id)
      ) {
        queuedExpiryNotifiedIdsRef.current.add(session.id);
        onQueuedExpiredRef.current?.(session.id);
      }

      if (isVideoDateReadyGateActiveStatus(session.ready_gate_status)) {
        const partnerId =
          session.participant_1_id === user.id
            ? session.participant_2_id
            : session.participant_1_id;
        if (partnerId) notifyReadyOnce(session.id, partnerId);
      }

      void refreshQueueCount();
    };

    const handleInsert = (payload: { new: Record<string, unknown> }) => {
      const session = payload.new as {
        id?: string;
        event_id?: string;
        participant_1_id?: string;
        participant_2_id?: string;
        ready_gate_status?: string;
      };
      if (session.event_id !== eventId || !session.id) return;

      const isParticipant =
        session.participant_1_id === user.id || session.participant_2_id === user.id;

      if (!isParticipant) return;

      if (isVideoDateReadyGateActiveStatus(session.ready_gate_status)) {
        const partnerId =
          session.participant_1_id === user.id
            ? session.participant_2_id
            : session.participant_1_id;
        if (partnerId) notifyReadyOnce(session.id, partnerId);
      }

      void refreshQueueCount();
    };

    const channel = supabase.channel(`match-queue-${eventId}-${user.id}`);
    // Realtime cannot OR participant columns in one filter, so discovery uses
    // participant-scoped bindings plus event validation and the polling/refetch fallback.
    for (const filter of [`participant_1_id=eq.${user.id}`, `participant_2_id=eq.${user.id}`]) {
      channel
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "video_sessions",
            filter,
          },
          handleUpdate
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "video_sessions",
            filter,
          },
          handleInsert
        );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, eventId, user?.id, refreshQueueCount, notifyReadyOnce]);

  return { queuedCount, refreshQueueCount, isDraining };
};
