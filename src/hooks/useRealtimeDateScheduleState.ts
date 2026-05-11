import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { threadMessagesQueryKey } from "../../shared/chat/queryKeys";
import {
  invalidateDateScheduleRealtimeEvent,
  type RealtimePlanningScope,
} from "../../shared/dateSuggestions/realtimePlanningInvalidation";

type RealtimePayload = {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};

type UseRealtimeDateScheduleStateOptions = {
  matchId: string | null | undefined;
  currentUserId: string | null | undefined;
  participantIds?: readonly (string | null | undefined)[];
  threadOtherUserId?: string | null | undefined;
  enabled?: boolean;
};

function stringValue(row: Record<string, unknown> | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(row: Record<string, unknown> | undefined, key: string): boolean {
  return row?.[key] === true;
}

function realtimeRow(payload: RealtimePayload): Record<string, unknown> | undefined {
  return payload.new ?? payload.old;
}

function logRealtimeDiagnostic(message: string, details?: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    console.warn(message, details);
  }
}

export function useSupabaseSessionReady(
  currentUserId: string | null | undefined,
  enabled = true,
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !currentUserId) {
      setReady(false);
      return;
    }

    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setReady(data.session?.user?.id === currentUserId);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setReady(session?.user?.id === currentUserId);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [currentUserId, enabled]);

  return ready;
}

export function useRealtimeDateScheduleState({
  matchId,
  currentUserId,
  participantIds,
  threadOtherUserId,
  enabled = true,
}: UseRealtimeDateScheduleStateOptions) {
  const queryClient = useQueryClient();
  const hasSession = useSupabaseSessionReady(currentUserId, enabled);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryCountRef = useRef(0);

  const participantKey = (participantIds ?? []).filter(Boolean).join("|");
  const normalizedParticipantIds = useMemo(
    () =>
      Array.from(
        new Set(
          (participantIds ?? [])
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participantKey],
  );

  const scope = useMemo<RealtimePlanningScope | null>(() => {
    if (!matchId || !currentUserId) return null;
    return {
      matchId,
      currentUserId,
      participantIds: normalizedParticipantIds,
      threadMessagesQueryKey:
        threadOtherUserId && currentUserId
          ? threadMessagesQueryKey(threadOtherUserId, currentUserId)
          : null,
    };
  }, [currentUserId, matchId, normalizedParticipantIds, threadOtherUserId]);

  const invalidate = useCallback(
    (event: Parameters<typeof invalidateDateScheduleRealtimeEvent>[2]) => {
      if (!scope) return;
      invalidateDateScheduleRealtimeEvent(queryClient, scope, event);
    },
    [queryClient, scope],
  );

  const resolveRevisionEvent = useCallback(
    async (payload: RealtimePayload) => {
      if (!scope) return;
      const row = realtimeRow(payload);
      const suggestionId = stringValue(row, "date_suggestion_id");
      if (!suggestionId) return;

      const cached = queryClient.getQueryData<Array<{ id?: string }>>([
        "date-suggestions",
        scope.matchId,
      ]);
      if (cached?.some((suggestion) => suggestion.id === suggestionId)) {
        invalidate({
          table: "date_suggestion_revisions",
          matchId: scope.matchId,
          scheduleShareRelated: booleanValue(row, "schedule_share_enabled"),
        });
        return;
      }

      const { data, error } = await supabase
        .from("date_suggestions")
        .select("match_id")
        .eq("id", suggestionId)
        .maybeSingle();

      if (error) {
        logRealtimeDiagnostic("[useRealtimeDateScheduleState] revision lookup failed", {
          matchId: scope.matchId,
          suggestionId,
          error: error.message,
        });
        return;
      }

      if (data?.match_id === scope.matchId) {
        invalidate({
          table: "date_suggestion_revisions",
          matchId: scope.matchId,
          scheduleShareRelated: booleanValue(row, "schedule_share_enabled"),
        });
      }
    },
    [invalidate, queryClient, scope],
  );

  const resolveGrantSlotEvent = useCallback(
    async (payload: RealtimePayload) => {
      if (!scope) return;
      const row = realtimeRow(payload);
      const grantId = stringValue(row, "grant_id");
      if (!grantId) {
        invalidate({ table: "schedule_share_grant_slots", matchId: scope.matchId });
        return;
      }

      const { data, error } = await supabase
        .from("schedule_share_grants")
        .select("match_id, subject_user_id")
        .eq("id", grantId)
        .maybeSingle();

      if (error) {
        logRealtimeDiagnostic("[useRealtimeDateScheduleState] grant lookup failed", {
          matchId: scope.matchId,
          grantId,
          error: error.message,
        });
        invalidate({ table: "schedule_share_grant_slots", matchId: scope.matchId });
        return;
      }

      if (!data) {
        invalidate({ table: "schedule_share_grant_slots", matchId: scope.matchId });
        return;
      }

      if (data.match_id === scope.matchId) {
        invalidate({
          table: "schedule_share_grant_slots",
          matchId: data.match_id,
          subjectUserId: data.subject_user_id,
        });
      }
    },
    [invalidate, scope],
  );

  useEffect(() => {
    if (!scope || !hasSession) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempted = false;
    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const channel = supabase.channel(`match-date-schedule:${scope.matchId}`);

    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "date_suggestions", filter: `match_id=eq.${scope.matchId}` },
        (payload) => {
          const row = realtimeRow(payload as RealtimePayload);
          invalidate({
            table: "date_suggestions",
            matchId: stringValue(row, "match_id"),
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "date_suggestion_revisions" },
        (payload) => {
          void resolveRevisionEvent(payload as RealtimePayload);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "date_plans", filter: `match_id=eq.${scope.matchId}` },
        (payload) => {
          const row = realtimeRow(payload as RealtimePayload);
          invalidate({
            table: "date_plans",
            matchId: stringValue(row, "match_id"),
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_share_grants", filter: `match_id=eq.${scope.matchId}` },
        (payload) => {
          const row = realtimeRow(payload as RealtimePayload);
          invalidate({
            table: "schedule_share_grants",
            matchId: stringValue(row, "match_id"),
            subjectUserId: stringValue(row, "subject_user_id"),
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_share_grant_slots" },
        (payload) => {
          void resolveGrantSlotEvent(payload as RealtimePayload);
        },
      );

    const userScheduleIds = new Set([...(scope.participantIds ?? []), scope.currentUserId]);
    for (const participantId of userScheduleIds) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_schedules", filter: `user_id=eq.${participantId}` },
        (payload) => {
          const row = realtimeRow(payload as RealtimePayload);
          invalidate({
            table: "user_schedules",
            matchId: scope.matchId,
            userId: stringValue(row, "user_id") ?? participantId,
          });
        },
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearRetryTimer();
        retryAttempted = false;
        retryCountRef.current = 0;
        return;
      }
      if (status !== "CHANNEL_ERROR") return;

      invalidate({ table: "channel_error", matchId: scope.matchId });
      logRealtimeDiagnostic("[useRealtimeDateScheduleState] channel error", {
        matchId: scope.matchId,
      });
      if (!retryAttempted && retryCountRef.current < 2) {
        retryAttempted = true;
        retryCountRef.current += 1;
        retryTimer = setTimeout(() => setRetryNonce((value) => value + 1), 1500);
      }
    });

    return () => {
      clearRetryTimer();
      void supabase.removeChannel(channel);
    };
  }, [hasSession, invalidate, resolveGrantSlotEvent, resolveRevisionEvent, retryNonce, scope]);
}

export function useRealtimeUserScheduleState(
  currentUserId: string | null | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const hasSession = useSupabaseSessionReady(currentUserId, enabled);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!currentUserId || !hasSession) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempted = false;
    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["user-schedule", currentUserId], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["schedule-hub", currentUserId], exact: true });
    };

    const channel = supabase
      .channel(`user-schedule:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_schedules", filter: `user_id=eq.${currentUserId}` },
        invalidate,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearRetryTimer();
          retryAttempted = false;
          retryCountRef.current = 0;
          return;
        }
        if (status !== "CHANNEL_ERROR") return;

        invalidate();
        logRealtimeDiagnostic("[useRealtimeUserScheduleState] channel error", {
          currentUserId,
        });
        if (!retryAttempted && retryCountRef.current < 2) {
          retryAttempted = true;
          retryCountRef.current += 1;
          retryTimer = setTimeout(() => setRetryNonce((value) => value + 1), 1500);
        }
      });

    return () => {
      clearRetryTimer();
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, hasSession, queryClient, retryNonce]);
}

export function useRealtimeScheduleHubState(
  currentUserId: string | null | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const hasSession = useSupabaseSessionReady(currentUserId, enabled);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!currentUserId || !hasSession) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempted = false;
    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["schedule-hub", currentUserId], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["user-schedule", currentUserId], exact: true });
    };

    const channel = supabase
      .channel(`schedule-hub:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "date_suggestions", filter: `proposer_id=eq.${currentUserId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "date_suggestions", filter: `recipient_id=eq.${currentUserId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "date_plans" },
        invalidate,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearRetryTimer();
          retryAttempted = false;
          retryCountRef.current = 0;
          return;
        }
        if (status !== "CHANNEL_ERROR") return;

        invalidate();
        logRealtimeDiagnostic("[useRealtimeScheduleHubState] channel error", {
          currentUserId,
        });
        if (!retryAttempted && retryCountRef.current < 2) {
          retryAttempted = true;
          retryCountRef.current += 1;
          retryTimer = setTimeout(() => setRetryNonce((value) => value + 1), 1500);
        }
      });

    return () => {
      clearRetryTimer();
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, hasSession, queryClient, retryNonce]);
}
