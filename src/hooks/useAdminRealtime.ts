import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY } from "@/hooks/useAdminOverviewDashboard";

interface UseAdminRealtimeOptions {
  enabled?: boolean;
}

export const useAdminRealtime = ({ enabled = true }: UseAdminRealtimeOptions = {}) => {
  const queryClient = useQueryClient();

  const invalidateOverview = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY });
  }, [queryClient]);

  const invalidateAllStats = useCallback(() => {
    invalidateOverview();
    queryClient.invalidateQueries({ queryKey: ["admin-unread-notifications"] });
  }, [invalidateOverview, queryClient]);

  const invalidateUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    invalidateOverview();
  }, [invalidateOverview, queryClient]);

  const invalidateMatches = useCallback(() => {
    invalidateOverview();
  }, [invalidateOverview]);

  const invalidateEvents = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    invalidateOverview();
  }, [invalidateOverview, queryClient]);

  const invalidateNotifications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-unread-notifications"] });
    queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
  }, [queryClient]);

  const invalidateReports = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
    invalidateOverview();
  }, [invalidateOverview, queryClient]);

  useEffect(() => {
    if (!enabled) return;

    // Subscribe to profiles table changes
    const profilesChannel = supabase
      .channel("admin-profiles-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        invalidateUsers
      )
      .subscribe();

    // Subscribe to matches table changes
    const matchesChannel = supabase
      .channel("admin-matches-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        invalidateMatches
      )
      .subscribe();

    // Subscribe to events table changes
    const eventsChannel = supabase
      .channel("admin-events-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        invalidateEvents
      )
      .subscribe();

    // Subscribe to event_registrations table changes
    const registrationsChannel = supabase
      .channel("admin-registrations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_registrations" },
        invalidateEvents
      )
      .subscribe();

    // Subscribe to daily drops for Overview status freshness
    const dailyDropsChannel = supabase
      .channel("admin-daily-drops-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_drops" },
        invalidateOverview
      )
      .subscribe();

    // Subscribe to admin_notifications table changes
    const notificationsChannel = supabase
      .channel("admin-notifications-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_notifications" },
        invalidateNotifications
      )
      .subscribe();

    // Subscribe to user_reports table changes
    const reportsChannel = supabase
      .channel("admin-reports-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_reports" },
        () => {
          invalidateReports();
          invalidateNotifications();
        }
      )
      .subscribe();

    // Subscribe to messages for real-time message count
    const messagesChannel = supabase
      .channel("admin-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        invalidateOverview
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(matchesChannel);
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(registrationsChannel);
      supabase.removeChannel(dailyDropsChannel);
      supabase.removeChannel(notificationsChannel);
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [
    enabled,
    invalidateOverview,
    invalidateUsers,
    invalidateMatches,
    invalidateEvents,
    invalidateNotifications,
    invalidateReports,
    queryClient,
  ]);

  return {
    invalidateAllStats,
    invalidateUsers,
    invalidateMatches,
    invalidateEvents,
    invalidateNotifications,
    invalidateReports,
  };
};
