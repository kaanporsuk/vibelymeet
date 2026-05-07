import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

export type PushAnalyticsRange = "7d" | "14d" | "30d";

export type PushTelemetrySummary = {
  queuedRows: number;
  sentRows: number;
  deliveredRows: number;
  openedRows: number;
  clickedRows: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
};

export type AppNotificationLogSummary = {
  logRows: number;
  deliveredRows: number;
  suppressedRows: number;
};

export type PushAnalyticsResult = {
  range: PushAnalyticsRange;
  telemetrySource: "admin_get_push_delivery_metrics";
  telemetryRowCount: number;
  windowLabel: string;
  windowStart: string;
  windowEnd: string;
  pushTelemetry: PushTelemetrySummary;
  appNotificationLog: AppNotificationLogSummary;
};

type PushDeliveryMetricsPayload = AdminRpcPayload & {
  push_telemetry?: Partial<Record<
    "queued_rows" | "sent_rows" | "delivered_rows" | "opened_rows" | "clicked_rows",
    number
  >>;
  app_notification_log?: Partial<Record<"log_rows" | "delivered_rows" | "suppressed_rows", number>>;
};

function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function toCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.trunc(numeric);
}

export function usePushAnalytics(range: PushAnalyticsRange) {
  return useQuery({
    queryKey: ["push-analytics", range],
    staleTime: 30_000,
    queryFn: async (): Promise<PushAnalyticsResult> => {
      const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
      const end = new Date();
      const start = subDays(end, days);
      const data = await callAdminRpc<PushDeliveryMetricsPayload>("admin_get_push_delivery_metrics", {
        p_window_start: start.toISOString(),
        p_window_end: end.toISOString(),
      });

      const pushTelemetry = (data.push_telemetry || {}) as Record<string, number>;
      const appLog = (data.app_notification_log || {}) as Record<string, number>;
      const queuedRows = toCount(pushTelemetry.queued_rows);
      const sentRows = toCount(pushTelemetry.sent_rows);
      const deliveredRows = toCount(pushTelemetry.delivered_rows);
      const openedRows = toCount(pushTelemetry.opened_rows);
      const clickedRows = toCount(pushTelemetry.clicked_rows);
      const appLogRows = toCount(appLog.log_rows);
      const appDeliveredRows = toCount(appLog.delivered_rows);
      const appSuppressedRows = toCount(appLog.suppressed_rows);
      const providerDenominator = sentRows || queuedRows;

      return {
        range,
        telemetrySource: "admin_get_push_delivery_metrics",
        telemetryRowCount: queuedRows + appLogRows,
        windowLabel: `${format(start, "MMM d")} - ${format(end, "MMM d")}`,
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        pushTelemetry: {
          queuedRows,
          sentRows,
          deliveredRows,
          openedRows,
          clickedRows,
          deliveryRate: safeRate(deliveredRows, providerDenominator),
          openRate: safeRate(openedRows, deliveredRows || providerDenominator),
          clickRate: safeRate(clickedRows, openedRows || providerDenominator),
        },
        appNotificationLog: {
          logRows: appLogRows,
          deliveredRows: appDeliveredRows,
          suppressedRows: appSuppressedRows,
        },
      };
    },
  });
}
