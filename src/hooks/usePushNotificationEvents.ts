import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export type NotificationPlatform = "web" | "ios" | "android" | "pwa";
export type NotificationStatus = "queued" | "sending" | "sent" | "delivered" | "opened" | "clicked" | "failed" | "bounced";

export interface PushNotificationEvent {
  id: string;
  campaign_id: string | null;
  user_id: string;
  user_name?: string;
  device_token: string | null;
  platform: NotificationPlatform;
  status: NotificationStatus;
  fcm_message_id: string | null;
  apns_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
  campaign_title?: string;
}

export interface NotificationStats {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  bounced: number;
  byPlatform: Record<NotificationPlatform, number>;
}

export function usePushNotificationEvents(limit: number = 50) {
  const [events, setEvents] = useState<PushNotificationEvent[]>([]);
  const [stats, setStats] = useState<NotificationStats>({
    total: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    failed: 0,
    bounced: 0,
    byPlatform: { web: 0, ios: 0, android: 0, pwa: 0 },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const queryClient = useQueryClient();

  // Fetch initial events using the secure admin view (masks device tokens)
  const fetchEvents = useCallback(async () => {
    try {
      // Fetch events from the secure admin view that masks sensitive device tokens
      const { data: eventsData, error: eventsError } = await supabase
        .from("push_notification_events_admin")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      // Fetch campaign titles separately since views don't support joins
      const campaignIds = [...new Set(eventsData?.map(e => e.campaign_id).filter(Boolean) || [])];
      const { data: campaigns } = campaignIds.length > 0 ? await supabase
        .from("push_campaigns")
        .select("id, title")
        .in("id", campaignIds) : { data: [] };
      
      const campaignMap = new Map<string, string>(
        (campaigns || []).map(c => [c.id, c.title] as [string, string])
      );

      if (eventsError) {
        console.error("Error fetching push events:", eventsError);
        return;
      }

      // Fetch user names for events
      const userIds = [...new Set(eventsData?.map(e => e.user_id) || [])];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p.name]) || []);

      const transformedEvents: PushNotificationEvent[] = (eventsData || []).map(event => ({
        id: event.id,
        campaign_id: event.campaign_id,
        user_id: event.user_id,
        user_name: profileMap.get(event.user_id) || "Unknown User",
        device_token: event.device_token,
        platform: event.platform as NotificationPlatform,
        status: event.status as NotificationStatus,
        fcm_message_id: event.fcm_message_id,
        apns_message_id: event.apns_message_id,
        error_code: event.error_code,
        error_message: event.error_message,
        queued_at: event.queued_at,
        sent_at: event.sent_at,
        delivered_at: event.delivered_at,
        opened_at: event.opened_at,
        clicked_at: event.clicked_at,
        created_at: event.created_at,
        campaign_title: event.campaign_id ? (campaignMap.get(event.campaign_id) || "Direct Notification") : "Direct Notification",
      }));

      setEvents(transformedEvents);
      calculateStats(transformedEvents);
    } catch (error) {
      console.error("Failed to fetch events:", error);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  // Calculate stats from events
  const calculateStats = (eventList: PushNotificationEvent[]) => {
    const newStats: NotificationStats = {
      total: eventList.length,
      queued: 0,
      sending: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
      bounced: 0,
      byPlatform: { web: 0, ios: 0, android: 0, pwa: 0 },
    };

    eventList.forEach(event => {
      // Count by status
      if (event.status in newStats) {
        (newStats as any)[event.status]++;
      }
      // Count by platform
      if (event.platform in newStats.byPlatform) {
        newStats.byPlatform[event.platform]++;
      }
    });

    setStats(newStats);
  };

  // Real-time subscription
  useEffect(() => {
    if (!isLive) return;

    fetchEvents();

    const channel = supabase
      .channel("push-notification-events-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "push_notification_events",
        },
        async (payload) => {
          console.log("Push notification event update:", payload);

          if (payload.eventType === "INSERT") {
            const newEvent = payload.new as any;
            
            // Fetch user name
            const { data: profile } = await supabase
              .from("profiles")
              .select("name")
              .eq("id", newEvent.user_id)
              .single();

            // Fetch campaign title if exists
            let campaignTitle = "Direct Notification";
            if (newEvent.campaign_id) {
              const { data: campaign } = await supabase
                .from("push_campaigns")
                .select("title")
                .eq("id", newEvent.campaign_id)
                .single();
              campaignTitle = campaign?.title || campaignTitle;
            }

            const transformedEvent: PushNotificationEvent = {
              id: newEvent.id,
              campaign_id: newEvent.campaign_id,
              user_id: newEvent.user_id,
              user_name: profile?.name || "Unknown User",
              device_token: newEvent.device_token,
              platform: newEvent.platform,
              status: newEvent.status,
              fcm_message_id: newEvent.fcm_message_id,
              apns_message_id: newEvent.apns_message_id,
              error_code: newEvent.error_code,
              error_message: newEvent.error_message,
              queued_at: newEvent.queued_at,
              sent_at: newEvent.sent_at,
              delivered_at: newEvent.delivered_at,
              opened_at: newEvent.opened_at,
              clicked_at: newEvent.clicked_at,
              created_at: newEvent.created_at,
              campaign_title: campaignTitle,
            };

            setEvents(prev => {
              const updated = [transformedEvent, ...prev].slice(0, limit);
              calculateStats(updated);
              return updated;
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedEvent = payload.new as any;
            
            setEvents(prev => {
              const updated = prev.map(e => {
                if (e.id === updatedEvent.id) {
                  return {
                    ...e,
                    status: updatedEvent.status,
                    sent_at: updatedEvent.sent_at,
                    delivered_at: updatedEvent.delivered_at,
                    opened_at: updatedEvent.opened_at,
                    clicked_at: updatedEvent.clicked_at,
                    error_code: updatedEvent.error_code,
                    error_message: updatedEvent.error_message,
                  };
                }
                return e;
              });
              calculateStats(updated);
              return updated;
            });
          }
        }
      )
      .subscribe((status) => {
        console.log("Push events realtime subscription:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isLive, fetchEvents, limit]);

  // Reset events
  const resetEvents = useCallback(() => {
    setEvents([]);
    setStats({
      total: 0,
      queued: 0,
      sending: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
      bounced: 0,
      byPlatform: { web: 0, ios: 0, android: 0, pwa: 0 },
    });
  }, []);

  return {
    events,
    stats,
    isLoading,
    isLive,
    setIsLive,
    refetch: fetchEvents,
    resetEvents,
  };
}
