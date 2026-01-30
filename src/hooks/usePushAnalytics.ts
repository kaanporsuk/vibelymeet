import { useQuery } from "@tanstack/react-query";
import { format, subDays, eachDayOfInterval, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

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
  byDay: PushAnalyticsDay[];
  kpis: PushAnalyticsKpis;
  performance: PushAnalyticsBreakdownItem[];
  deviceDistribution: PushAnalyticsDeviceItem[];
  bestTimes: PushAnalyticsBestTime[];
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function isDelivered(status?: string | null) {
  return status === "delivered" || status === "opened" || status === "clicked";
}
function isOpened(status?: string | null) {
  return status === "opened" || status === "clicked";
}
function isClicked(status?: string | null) {
  return status === "clicked";
}

export function usePushAnalytics(range: PushAnalyticsRange) {
  return useQuery({
    queryKey: ["push-analytics", range],
    staleTime: 30_000,
    queryFn: async (): Promise<PushAnalyticsResult> => {
      const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
      const start = subDays(new Date(), days - 1);
      const dayBuckets = eachDayOfInterval({ start, end: new Date() });

      const { data: events, error } = await supabase
        .from("push_notification_events")
        .select(
          "id, campaign_id, platform, status, created_at, sent_at, delivered_at, opened_at, clicked_at",
        )
        .gte("created_at", start.toISOString());

      if (error) throw error;

      const rows = events || [];

      // ---- Device distribution ----
      const platformCounts: Record<string, number> = {};
      for (const r of rows) {
        const p = (r.platform as string) || "unknown";
        platformCounts[p] = (platformCounts[p] || 0) + 1;
      }
      const totalForDevices = rows.length;
      const platformLabel: Record<string, string> = {
        ios: "iOS",
        android: "Android",
        web: "Web",
        pwa: "PWA",
        unknown: "Unknown",
      };
      const deviceDistribution: PushAnalyticsDeviceItem[] = Object.entries(platformCounts)
        .map(([platform, count]) => ({
          name: platformLabel[platform] || platform,
          value: safeRate(count, totalForDevices),
        }))
        .sort((a, b) => b.value - a.value);

      // ---- By day ----
      const byDay: PushAnalyticsDay[] = dayBuckets.map((day) => {
        const dayStart = startOfDay(day).getTime();
        const dayRows = rows.filter((r) => startOfDay(new Date(r.created_at)).getTime() === dayStart);

        const sent = dayRows.length;
        const delivered = dayRows.filter((r) => !!r.delivered_at || isDelivered(r.status as string)).length;
        const opened = dayRows.filter((r) => !!r.opened_at || isOpened(r.status as string)).length;
        const clicked = dayRows.filter((r) => !!r.clicked_at || isClicked(r.status as string)).length;

        return {
          date: format(day, "MMM d"),
          fullDate: day.toISOString(),
          sent,
          delivered,
          opened,
          clicked,
          deliveryRate: safeRate(delivered, sent),
          openRate: safeRate(opened, delivered || sent),
          clickRate: safeRate(clicked, opened || sent),
        };
      });

      // ---- KPIs ----
      const totals = byDay.reduce(
        (acc, d) => ({
          sent: acc.sent + d.sent,
          delivered: acc.delivered + d.delivered,
          opened: acc.opened + d.opened,
          clicked: acc.clicked + d.clicked,
        }),
        { sent: 0, delivered: 0, opened: 0, clicked: 0 },
      );

      const kpis: PushAnalyticsKpis = {
        ...totals,
        avgDeliveryRate: safeRate(totals.delivered, totals.sent),
        avgOpenRate: safeRate(totals.opened, totals.delivered || totals.sent),
        avgClickRate: safeRate(totals.clicked, totals.opened || totals.sent),
      };

      // ---- Performance breakdown (Top campaigns) ----
      const byCampaign: Record<string, { sent: number; opened: number; clicked: number }> = {};
      for (const r of rows) {
        const cid = (r.campaign_id as string) || "unknown";
        if (!byCampaign[cid]) byCampaign[cid] = { sent: 0, opened: 0, clicked: 0 };
        byCampaign[cid].sent += 1;
        byCampaign[cid].opened += !!r.opened_at || isOpened(r.status as string) ? 1 : 0;
        byCampaign[cid].clicked += !!r.clicked_at || isClicked(r.status as string) ? 1 : 0;
      }

      const campaignIds = Object.keys(byCampaign).filter((id) => id !== "unknown");
      const { data: campaigns } = campaignIds.length
        ? await supabase.from("push_campaigns").select("id, title").in("id", campaignIds)
        : { data: [] as Array<{ id: string; title: string }> };

      const campaignTitleById = new Map((campaigns || []).map((c) => [c.id, c.title] as const));

      const performance: PushAnalyticsBreakdownItem[] = Object.entries(byCampaign)
        .map(([campaignId, stats]) => ({
          name: campaignId === "unknown" ? "Unattributed" : campaignTitleById.get(campaignId) || "Campaign",
          sent: stats.sent,
          opened: stats.opened,
          clicked: stats.clicked,
        }))
        .sort((a, b) => b.sent - a.sent)
        .slice(0, 6);

      // ---- Best times (by day-of-week + hour) ----
      const bySlot: Record<string, { sent: number; opened: number }> = {};
      for (const r of rows) {
        const dt = new Date((r.sent_at as string) || (r.created_at as string));
        const dow = dt.getDay();
        const hour = dt.getHours();
        const key = `${dow}-${hour}`;
        if (!bySlot[key]) bySlot[key] = { sent: 0, opened: 0 };
        bySlot[key].sent += 1;
        bySlot[key].opened += !!r.opened_at || isOpened(r.status as string) ? 1 : 0;
      }

      const bestTimes: PushAnalyticsBestTime[] = Object.entries(bySlot)
        .map(([key, stats]) => {
          const [dowStr, hourStr] = key.split("-");
          const dow = Number(dowStr);
          const hour = Number(hourStr);
          const hour12 = ((hour + 11) % 12) + 1;
          const ampm = hour >= 12 ? "PM" : "AM";
          return {
            day: DAY_LABELS[dow] || "",
            time: `${hour12}:00 ${ampm}`,
            openRate: safeRate(stats.opened, stats.sent),
            reason: "Top open window",
          };
        })
        .sort((a, b) => b.openRate - a.openRate)
        .slice(0, 4);

      return {
        range,
        byDay,
        kpis,
        performance,
        deviceDistribution,
        bestTimes,
      };
    },
  });
}
