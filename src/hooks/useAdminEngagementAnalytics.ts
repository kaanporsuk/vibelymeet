import { useQuery } from "@tanstack/react-query";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

export const ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY = ["admin-engagement-analytics"] as const;

export type AdminEngagementNotificationDay = {
  day: string;
  date: string;
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
};

export type AdminEngagementProviderTotals = {
  queued_rows: number;
  sent_rows: number;
  delivered_rows: number;
  opened_rows: number;
  clicked_rows: number;
  failed_rows: number;
  bounced_rows: number;
  delivery_rate: number;
  open_rate: number;
  click_rate: number;
  source: "push_notification_events";
};

export type AdminEngagementAppLogTotals = {
  log_rows: number;
  delivered_rows: number;
  suppressed_rows: number;
  delivery_rate: number;
  source: "notification_log";
};

export type AdminEngagementCategory = {
  category: string;
  label: string;
  total: number;
  delivered: number;
  suppressed: number;
  delivery_rate: number;
};

export type AdminEngagementDailyDropTotals = {
  total: number;
  active_unopened: number;
  active_viewed: number;
  active_opener_sent: number;
  matched: number;
  passed: number;
  expired_no_action: number;
  expired_no_reply: number;
  invalidated: number;
  engaged_rows: number;
  opener_rows: number;
  engagement_rate: number;
  opener_rate: number;
  match_conversion_rate: number;
};

export type AdminEngagementDailyDropDay = {
  day: string;
  date: string;
  total: number;
  unopened: number;
  viewed: number;
  opener_sent: number;
  matched: number;
  passed: number;
  expired: number;
  invalidated: number;
  engaged: number;
};

export type AdminEngagementDailyDropStatus = {
  status: string;
  name: string;
  value: number;
  color: string;
};

export type AdminEngagementUserActivityTotals = {
  total_messages: number;
  total_matches: number;
  total_registrations: number;
  total_activities: number;
};

export type AdminEngagementUserActivityDay = {
  day: string;
  date: string;
  messages: number;
  matches: number;
  registrations: number;
};

export type AdminEngagementAnalyticsPayload = AdminRpcPayload & {
  generated_at: string;
  reporting_timezone: "UTC";
  window_start: string;
  window_end: string;
  notifications: {
    provider_totals: AdminEngagementProviderTotals;
    by_day: AdminEngagementNotificationDay[];
    app_log_totals: AdminEngagementAppLogTotals;
    app_by_category: AdminEngagementCategory[];
  };
  daily_drop: {
    totals: AdminEngagementDailyDropTotals;
    by_day: AdminEngagementDailyDropDay[];
    status_distribution: AdminEngagementDailyDropStatus[];
  };
  user_activity: {
    totals: AdminEngagementUserActivityTotals;
    by_day: AdminEngagementUserActivityDay[];
  };
};

function getUtcWindow(days: number) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { start, end };
}

export function useAdminEngagementAnalytics(days = 30) {
  return useQuery<AdminEngagementAnalyticsPayload, Error>({
    queryKey: [...ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY, days],
    queryFn: () => {
      const window = getUtcWindow(days);

      return callAdminRpc<AdminEngagementAnalyticsPayload>("admin_get_engagement_analytics", {
        p_window_start: window.start.toISOString(),
        p_window_end: window.end.toISOString(),
      });
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}
