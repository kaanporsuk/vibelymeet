import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UseAdminRealtimeOptions {
  enabled?: boolean;
}

export const useAdminRealtime = ({ enabled = true }: UseAdminRealtimeOptions = {}) => {
  const queryClient = useQueryClient();

  const invalidateAllStats = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-users-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-matches-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-messages-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-events-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-verified-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-today-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-unread-notifications"] });
  }, [queryClient]);

  const invalidateUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-users-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-today-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-verified-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-user-growth"] });
  }, [queryClient]);

  const invalidateMatches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-matches-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-match-trends"] });
  }, [queryClient]);

  const invalidateEvents = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    queryClient.invalidateQueries({ queryKey: ["admin-events-count"] });
    queryClient.invalidateQueries({ queryKey: ["admin-event-attendance"] });
  }, [queryClient]);

  const invalidateNotifications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-unread-notifications"] });
    queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
  }, [queryClient]);

  const invalidateReports = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;

    // Subscribe to profiles table changes
    const profilesChannel = supabase
      .channel("admin-profiles-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          console.log("Profile change detected");
          invalidateUsers();
        }
      )
      .subscribe();

    // Subscribe to matches table changes
    const matchesChannel = supabase
      .channel("admin-matches-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        () => {
          console.log("Match change detected");
          invalidateMatches();
        }
      )
      .subscribe();

    // Subscribe to events table changes
    const eventsChannel = supabase
      .channel("admin-events-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => {
          console.log("Event change detected");
          invalidateEvents();
        }
      )
      .subscribe();

    // Subscribe to event_registrations table changes
    const registrationsChannel = supabase
      .channel("admin-registrations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_registrations" },
        () => {
          console.log("Registration change detected");
          invalidateEvents();
        }
      )
      .subscribe();

    // Subscribe to admin_notifications table changes
    const notificationsChannel = supabase
      .channel("admin-notifications-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_notifications" },
        () => {
          console.log("Notification change detected");
          invalidateNotifications();
        }
      )
      .subscribe();

    // Subscribe to user_reports table changes
    const reportsChannel = supabase
      .channel("admin-reports-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_reports" },
        () => {
          console.log("Report change detected");
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
        () => {
          console.log("New message detected");
          queryClient.invalidateQueries({ queryKey: ["admin-messages-count"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(matchesChannel);
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(registrationsChannel);
      supabase.removeChannel(notificationsChannel);
      supabase.removeChannel(reportsChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, [
    enabled,
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