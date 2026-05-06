import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { callAdminRpc } from "@/lib/adminRpc";

export type PushAnalyticsRange = "7d" | "14d" | "30d";

export type PushAnalyticsDay = {
  date: string;
  fullDate: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
};

export type PushAnalyticsKpis = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  avgDeliveryRate: number;
  avgOpenRate: number;
  avgClickRate: number;
};

export type PushAnalyticsBreakdownItem = {
  name: string;
  sent: number;
  opened: number;
  clicked: number;
};

export type PushAnalyticsDeviceItem = {
  name: string;
  value: number; // percent
};

export type PushAnalyticsBestTime = {
  time: string;
  day: string;
  openRate: number;
  reason: string;
};

export type PushAnalyticsResult = {
  range: PushAnalyticsRange;
  telemetrySource: "admin_get_push_delivery_metrics";
  telemetryRowCount: number;
  byDay: PushAnalyticsDay[];
  kpis: PushAnalyticsKpis;
  performance: PushAnalyticsBreakdownItem[];
  deviceDistribution: PushAnalyticsDeviceItem[];
  bestTimes: PushAnalyticsBestTime[];
};

function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

export function usePushAnalytics(range: PushAnalyticsRange) {
  return useQuery({
    queryKey: ["push-analytics", range],
    staleTime: 30_000,
    queryFn: async (): Promise<PushAnalyticsResult> => {
      const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
      const start = subDays(new Date(), days - 1);
      const end = new Date();
      const data = await callAdminRpc("admin_get_push_delivery_metrics", {
        p_window_start: start.toISOString(),
        p_window_end: end.toISOString(),
      });

      const pushTelemetry = (data.push_telemetry || {}) as Record<string, number>;
      const appLog = (data.app_notification_log || {}) as Record<string, number>;
      const totals = {
        sent: Number(pushTelemetry.sent_rows || pushTelemetry.queued_rows || 0),
        delivered: Number(pushTelemetry.delivered_rows || 0),
        opened: Number(pushTelemetry.opened_rows || 0),
        clicked: Number(pushTelemetry.clicked_rows || 0),
      };

      const byDay: PushAnalyticsDay[] = [
        {
          date: `${format(start, "MMM d")}–${format(end, "MMM d")}`,
          fullDate: start.toISOString(),
          sent: totals.sent,
          delivered: totals.delivered,
          opened: totals.opened,
          clicked: totals.clicked,
          deliveryRate: safeRate(totals.delivered, totals.sent),
          openRate: safeRate(totals.opened, totals.delivered || totals.sent),
          clickRate: safeRate(totals.clicked, totals.opened || totals.sent),
        },
      ];

      const kpis: PushAnalyticsKpis = {
        ...totals,
        avgDeliveryRate: safeRate(totals.delivered, totals.sent),
        avgOpenRate: safeRate(totals.opened, totals.delivered || totals.sent),
        avgClickRate: safeRate(totals.clicked, totals.opened || totals.sent),
      };

      const performance: PushAnalyticsBreakdownItem[] = [
        {
          name: "Provider telemetry",
          sent: totals.sent,
          opened: totals.opened,
          clicked: totals.clicked,
        },
        {
          name: "App notification log",
          sent: Number(appLog.log_rows || 0),
          opened: Number(appLog.delivered_rows || 0),
          clicked: 0,
        },
      ].filter((item) => item.sent > 0 || item.opened > 0 || item.clicked > 0);

      const deviceDistribution: PushAnalyticsDeviceItem[] = [];
      const bestTimes: PushAnalyticsBestTime[] = [];

      return {
        range,
        telemetrySource: "admin_get_push_delivery_metrics",
        telemetryRowCount: totals.sent,
        byDay,
        kpis,
        performance,
        deviceDistribution,
        bestTimes,
      };
    },
  });
}
