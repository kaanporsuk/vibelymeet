import { useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  invalidateAdminQueries,
  type AdminInvalidationArea,
} from "@/lib/adminQueryInvalidation";

interface UseAdminRealtimeOptions {
  enabled?: boolean;
  activePanel?: string;
}

type AdminRealtimeSpec = {
  channel: string;
  table: keyof Database["public"]["Tables"];
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  areas: readonly AdminInvalidationArea[];
};

type PendingInvalidation = {
  timer: ReturnType<typeof setTimeout>;
  areas: readonly AdminInvalidationArea[];
};

const REALTIME_INVALIDATION_DELAY_MS = 750;

const ALWAYS_ON_BADGE_SPECS: readonly AdminRealtimeSpec[] = [
  {
    channel: "admin-notifications-badges-realtime",
    table: "admin_notifications",
    areas: ["notifications"],
  },
  {
    channel: "admin-support-tickets-badges-realtime",
    table: "support_tickets",
    areas: ["badges"],
  },
  {
    channel: "admin-support-replies-badges-realtime",
    table: "support_ticket_replies",
    areas: ["badges"],
  },
];

const PANEL_REALTIME_SPECS: Record<string, readonly AdminRealtimeSpec[]> = {
  overview: [
    { channel: "admin-overview-profiles-realtime", table: "profiles", areas: ["users", "overview"] },
    { channel: "admin-overview-matches-realtime", table: "matches", areas: ["overview", "engagement"] },
    { channel: "admin-overview-events-realtime", table: "events", areas: ["events", "overview"] },
    { channel: "admin-overview-registrations-realtime", table: "event_registrations", areas: ["events", "overview", "engagement"] },
    { channel: "admin-overview-daily-drops-realtime", table: "daily_drops", areas: ["overview", "engagement"] },
    { channel: "admin-overview-daily-drop-runs-realtime", table: "daily_drop_generation_runs", areas: ["overview"] },
    { channel: "admin-overview-notification-log-realtime", table: "notification_log", areas: ["engagement"] },
    { channel: "admin-overview-messages-realtime", table: "messages", event: "INSERT", areas: ["overview", "engagement"] },
  ],
  users: [
    { channel: "admin-users-profiles-realtime", table: "profiles", areas: ["users", "overview"] },
    { channel: "admin-users-registrations-realtime", table: "event_registrations", areas: ["users", "overview"] },
    { channel: "admin-users-matches-realtime", table: "matches", areas: ["users", "overview"] },
    { channel: "admin-users-messages-realtime", table: "messages", event: "INSERT", areas: ["users", "overview"] },
    { channel: "admin-users-video-sessions-realtime", table: "video_sessions", areas: ["users", "overview"] },
    { channel: "admin-users-daily-drops-realtime", table: "daily_drops", areas: ["users", "overview"] },
  ],
  events: [
    { channel: "admin-events-realtime", table: "events", areas: ["events", "overview"] },
    { channel: "admin-event-registrations-realtime", table: "event_registrations", areas: ["events", "overview", "engagement"] },
  ],
  "event-analytics": [
    { channel: "admin-event-analytics-events-realtime", table: "events", areas: ["events", "overview"] },
    { channel: "admin-event-analytics-registrations-realtime", table: "event_registrations", areas: ["events", "overview", "engagement"] },
    { channel: "admin-event-analytics-reports-realtime", table: "user_reports", areas: ["reports", "overview"] },
  ],
  reports: [
    { channel: "admin-reports-realtime", table: "user_reports", areas: ["reports", "overview"] },
    { channel: "admin-reports-profiles-realtime", table: "profiles", areas: ["reports"] },
  ],
  engagement: [
    { channel: "admin-engagement-daily-drops-realtime", table: "daily_drops", areas: ["engagement", "overview"] },
    { channel: "admin-engagement-daily-drop-runs-realtime", table: "daily_drop_generation_runs", areas: ["engagement", "overview"] },
    { channel: "admin-engagement-notification-log-realtime", table: "notification_log", areas: ["engagement"] },
    { channel: "admin-engagement-messages-realtime", table: "messages", event: "INSERT", areas: ["engagement", "overview"] },
    { channel: "admin-engagement-matches-realtime", table: "matches", areas: ["engagement", "overview"] },
  ],
  "photo-verification": [
    { channel: "admin-photo-verifications-realtime", table: "photo_verifications", areas: ["photoVerification"] },
    { channel: "admin-photo-verification-profiles-realtime", table: "profiles", areas: ["photoVerification", "users"] },
  ],
  support: [
    { channel: "admin-support-tickets-realtime", table: "support_tickets", areas: ["support"] },
    { channel: "admin-support-replies-realtime", table: "support_ticket_replies", areas: ["support"] },
    { channel: "admin-support-events-realtime", table: "support_ticket_events", areas: ["support"] },
    { channel: "admin-support-delivery-jobs-realtime", table: "support_reply_delivery_jobs", areas: ["support"] },
  ],
  campaigns: [
    { channel: "admin-campaigns-notification-log-realtime", table: "notification_log", areas: ["engagement"] },
  ],
  deletions: [
    { channel: "admin-deletions-requests-realtime", table: "account_deletion_requests", areas: ["deletions", "users", "overview"] },
    { channel: "admin-deletions-jobs-realtime", table: "account_deletion_completion_jobs", areas: ["deletions", "users", "overview"] },
  ],
};

const uniqueRealtimeSpecs = (specs: readonly AdminRealtimeSpec[]) => {
  const byChannel = new Map<string, AdminRealtimeSpec>();
  for (const spec of specs) byChannel.set(spec.channel, spec);
  return [...byChannel.values()];
};

export const useAdminRealtime = ({ enabled = true, activePanel = "overview" }: UseAdminRealtimeOptions = {}) => {
  const queryClient = useQueryClient();
  const invalidationTimers = useRef<Map<string, PendingInvalidation>>(new Map());

  const scheduleInvalidation = useCallback((areas: readonly AdminInvalidationArea[]) => {
    const uniqueAreas = [...new Set(areas)];
    if (uniqueAreas.length === 0) return;

    const timerKey = [...uniqueAreas].sort().join("|");
    const existing = invalidationTimers.current.get(timerKey);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      invalidationTimers.current.delete(timerKey);
      void invalidateAdminQueries(queryClient, uniqueAreas);
    }, REALTIME_INVALIDATION_DELAY_MS);

    invalidationTimers.current.set(timerKey, { timer, areas: uniqueAreas });
  }, [queryClient]);

  const clearTimers = useCallback((flushPending = false) => {
    const pending = [...invalidationTimers.current.values()];
    for (const { timer } of pending) clearTimeout(timer);
    invalidationTimers.current.clear();
    if (!flushPending || pending.length === 0) return;

    const areasToFlush = new Set<AdminInvalidationArea>();
    for (const { areas } of pending) {
      for (const area of areas) areasToFlush.add(area);
    }
    void invalidateAdminQueries(queryClient, [...areasToFlush]);
  }, [queryClient]);

  const invalidateAllStats = useCallback(() => {
    void invalidateAdminQueries(queryClient, ["overview", "engagement", "badges"]);
  }, [queryClient]);

  const invalidateUsers = useCallback(() => {
    void invalidateAdminQueries(queryClient, ["users", "overview"]);
  }, [queryClient]);

  const invalidateMatches = useCallback(() => {
    void invalidateAdminQueries(queryClient, ["overview", "engagement"]);
  }, [queryClient]);

  const invalidateEvents = useCallback(() => {
    void invalidateAdminQueries(queryClient, ["events", "overview"]);
  }, [queryClient]);

  const invalidateNotifications = useCallback(() => {
    void invalidateAdminQueries(queryClient, ["notifications"]);
  }, [queryClient]);

  const invalidateReports = useCallback(() => {
    void invalidateAdminQueries(queryClient, ["reports", "overview"]);
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) {
      clearTimers(true);
      return undefined;
    }

    const specs = uniqueRealtimeSpecs([
      ...ALWAYS_ON_BADGE_SPECS,
      ...(PANEL_REALTIME_SPECS[activePanel] ?? []),
    ]);

    const channels = specs.map((spec) => {
      const channel = supabase.channel(spec.channel);
      const onPostgresChanges = channel.on as unknown as (
        type: "postgres_changes",
        filter: { event: AdminRealtimeSpec["event"] | "*"; schema: "public"; table: string },
        callback: () => void,
      ) => typeof channel;

      return onPostgresChanges(
        "postgres_changes",
        {
          event: spec.event ?? "*",
          schema: "public",
          table: spec.table,
        },
        () => scheduleInvalidation(spec.areas),
      ).subscribe();
    });

    return () => {
      clearTimers(true);
      for (const channel of channels) {
        supabase.removeChannel(channel);
      }
    };
  }, [activePanel, clearTimers, enabled, scheduleInvalidation]);

  return {
    invalidateAllStats,
    invalidateUsers,
    invalidateMatches,
    invalidateEvents,
    invalidateNotifications,
    invalidateReports,
  };
};
