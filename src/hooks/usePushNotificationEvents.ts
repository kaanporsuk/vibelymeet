import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

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

type PushCampaignTitlesPayload = AdminRpcPayload & {
  campaigns?: Array<{
    id: string;
    title: string;
  }>;
};

const EMPTY_NOTIFICATION_STATS: NotificationStats = {
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
};

function emptyNotificationStats(): NotificationStats {
  return {
    ...EMPTY_NOTIFICATION_STATS,
    byPlatform: { ...EMPTY_NOTIFICATION_STATS.byPlatform },
  };
}

function isNotificationPlatform(value: string): value is NotificationPlatform {
  return value === "web" || value === "ios" || value === "android" || value === "pwa";
}

function isNotificationStatus(value: string): value is NotificationStatus {
  return (
    value === "queued" ||
    value === "sending" ||
    value === "sent" ||
    value === "delivered" ||
    value === "opened" ||
    value === "clicked" ||
    value === "failed" ||
    value === "bounced"
  );
}

function calculateNotificationStats(eventList: PushNotificationEvent[]): NotificationStats {
  const nextStats = emptyNotificationStats();
  nextStats.total = eventList.length;

  eventList.forEach((event) => {
    nextStats[event.status]++;
    nextStats.byPlatform[event.platform]++;
  });

  return nextStats;
}

export function usePushNotificationEvents(limit: number = 50) {
  const [events, setEvents] = useState<PushNotificationEvent[]>([]);
  const [stats, setStats] = useState<NotificationStats>(() => emptyNotificationStats());
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      const { data: eventsData, error: eventsError } = await supabase
        .from("push_notification_events_admin")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (eventsError) {
        console.error("Error fetching push events:", eventsError);
        setEvents([]);
        setStats(emptyNotificationStats());
        return;
      }

      // Fetch campaign titles through the governed admin read model; the browser
      // should not select directly from push campaign tables.
      const rawCampaignIds = eventsData?.map((e) => e.campaign_id) ?? [];
      const campaignIds = [...new Set(rawCampaignIds.filter((id): id is string => !!id))];
      let campaigns: PushCampaignTitlesPayload["campaigns"] = [];
      if (campaignIds.length > 0) {
        try {
          const campaignsPayload = await callAdminRpc<PushCampaignTitlesPayload>("admin_get_push_campaigns_read_model", {});
          const wantedCampaignIds = new Set(campaignIds);
          campaigns = (campaignsPayload.campaigns ?? []).filter((campaign) => wantedCampaignIds.has(campaign.id));
        } catch (error) {
          console.error("Error fetching push campaign titles:", error);
        }
      }

      const campaignMap = new Map<string, string>(
        (campaigns || []).map(c => [c.id, c.title] as [string, string])
      );

      // Fetch user names for events
      const rawUserIds = eventsData?.map((e) => e.user_id) ?? [];
      const userIds = [...new Set(rawUserIds.filter((id): id is string => !!id))];
      const { data: profiles } =
        userIds.length > 0
          ? await supabase
              .from("profiles")
              .select("id, name")
              .in("id", userIds)
          : { data: [] as { id: string; name: string | null }[] };

      const profileMap = new Map<string, string | null>(
        (profiles || []).map((p) => [p.id, p.name] as [string, string | null])
      );

      const transformedEvents: PushNotificationEvent[] = (eventsData || [])
        .filter((event): event is typeof event & {
          id: string;
          user_id: string;
          queued_at: string;
          created_at: string;
          platform: NotificationPlatform;
          status: NotificationStatus;
        } => {
          return Boolean(
            event.id &&
            event.user_id &&
            event.queued_at &&
            event.created_at &&
            typeof event.platform === "string" &&
            isNotificationPlatform(event.platform) &&
            typeof event.status === "string" &&
            isNotificationStatus(event.status)
          );
        })
        .map((event) => ({
          id: event.id,
          campaign_id: event.campaign_id,
          user_id: event.user_id,
          user_name: profileMap.get(event.user_id) || "Unknown User",
          device_token: event.device_token,
          platform: event.platform,
          status: event.status,
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
          campaign_title: event.campaign_id
            ? campaignMap.get(event.campaign_id) || "Campaign telemetry"
            : "Direct Notification",
        }));

      setEvents(transformedEvents);
      setStats(calculateNotificationStats(transformedEvents));
    } catch (error) {
      console.error("Failed to fetch events:", error);
      setEvents([]);
      setStats(emptyNotificationStats());
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  // Poll the redacted admin telemetry view. Avoid subscribing to the raw table:
  // database change-feed payloads are not the admin redaction boundary.
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!isLive) return undefined;

    const refreshInterval = window.setInterval(() => {
      void fetchEvents();
    }, 15_000);

    return () => window.clearInterval(refreshInterval);
  }, [isLive, fetchEvents]);

  // Reset events
  const resetEvents = useCallback(() => {
    setEvents([]);
    setStats(emptyNotificationStats());
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
