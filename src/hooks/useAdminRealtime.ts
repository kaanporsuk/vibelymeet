import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY } from "@/hooks/useAdminEngagementAnalytics";
import { ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY } from "@/hooks/useAdminOverviewDashboard";

interface UseAdminRealtimeOptions {
  enabled?: boolean;
}

export const useAdminRealtime = ({ enabled = true }: UseAdminRealtimeOptions = {}) => {
  const queryClient = useQueryClient();

  const invalidateOverview = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY });
  }, [queryClient]);

  const invalidateEngagement = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY });
  }, [queryClient]);

  const invalidateAllStats = useCallback(() => {
    invalidateOverview();
    invalidateEngagement();
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard-badge-counts"] });
  }, [invalidateEngagement, invalidateOverview, queryClient]);

  const invalidateUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    invalidateOverview();
  }, [invalidateOverview, queryClient]);

  const invalidateMatches = useCallback(() => {
    invalidateOverview();
    invalidateEngagement();
  }, [invalidateEngagement, invalidateOverview]);

  const invalidateEvents = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    invalidateOverview();
  }, [invalidateOverview, queryClient]);

  const invalidateEventEngagement = useCallback(() => {
    invalidateEvents();
    invalidateEngagement();
  }, [invalidateEngagement, invalidateEvents]);

  const invalidateNotifications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard-badge-counts"] });
    queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
  }, [queryClient]);

  const invalidateBadges = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard-badge-counts"] });
  }, [queryClient]);

  const invalidateSupport = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard-badge-counts"] });
    queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    queryClient.invalidateQueries({ queryKey: ["admin-support-thread"] });
  }, [queryClient]);

  const invalidateReports = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
    queryClient.invalidateQueries({ queryKey: ["admin-reports-summary"] });
    invalidateOverview();
  }, [invalidateOverview, queryClient]);

  const invalidatePhotoVerifications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-photo-verifications"] });
    queryClient.invalidateQueries({ queryKey: ["admin-verification-stats"] });
  }, [queryClient]);

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
        invalidateEventEngagement
      )
      .subscribe();

    // Subscribe to daily drops for Overview status freshness
    const dailyDropsChannel = supabase
      .channel("admin-daily-drops-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_drops" },
        () => {
          invalidateOverview();
          invalidateEngagement();
        }
      )
      .subscribe();

    const engagementPushTelemetryChannel = supabase
      .channel("admin-engagement-push-telemetry-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "push_notification_events" },
        invalidateEngagement
      )
      .subscribe();

    const engagementNotificationLogChannel = supabase
      .channel("admin-engagement-notification-log-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification_log" },
        invalidateEngagement
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

    const supportTicketsChannel = supabase
      .channel("admin-support-tickets-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        invalidateSupport
      )
      .subscribe();

    const supportRepliesChannel = supabase
      .channel("admin-support-replies-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_ticket_replies" },
        invalidateSupport
      )
      .subscribe();

    const supportEventsChannel = supabase
      .channel("admin-support-events-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_ticket_events" },
        invalidateSupport
      )
      .subscribe();

    const feedbackChannel = supabase
      .channel("admin-feedback-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback" },
        invalidateBadges
      )
      .subscribe();

    const photoVerificationsChannel = supabase
      .channel("admin-photo-verifications-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_verifications" },
        invalidatePhotoVerifications
      )
      .subscribe();

    // Subscribe to messages for real-time message count
    const messagesChannel = supabase
      .channel("admin-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          invalidateOverview();
          invalidateEngagement();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(matchesChannel);
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(registrationsChannel);
      supabase.removeChannel(dailyDropsChannel);
      supabase.removeChannel(engagementPushTelemetryChannel);
      supabase.removeChannel(engagementNotificationLogChannel);
      supabase.removeChannel(notificationsChannel);
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(supportTicketsChannel);
      supabase.removeChannel(supportRepliesChannel);
      supabase.removeChannel(supportEventsChannel);
      supabase.removeChannel(feedbackChannel);
      supabase.removeChannel(photoVerificationsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [
    enabled,
    invalidateEngagement,
    invalidateEventEngagement,
    invalidateOverview,
    invalidateUsers,
    invalidateMatches,
    invalidateEvents,
    invalidateNotifications,
    invalidateReports,
    invalidateBadges,
    invalidateSupport,
    invalidatePhotoVerifications,
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
