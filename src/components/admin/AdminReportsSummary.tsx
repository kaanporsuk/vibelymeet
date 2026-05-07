import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Shield, Ban } from "lucide-react";
import { subDays, startOfWeek } from "date-fns";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

type ReportsSummaryCountsPayload = AdminRpcPayload & {
  open_reports?: number;
  reports_this_week?: number;
  suspended?: number;
  banned_this_month?: number;
};

const AdminReportsSummary = () => {
  const { data: summary, isError } = useQuery({
    queryKey: ["admin-reports-summary"],
    queryFn: async () => {
      const now = new Date();
      const weekStart = startOfWeek(now).toISOString();
      const monthStart = subDays(now, 30).toISOString();

      const counts = await callAdminRpc<ReportsSummaryCountsPayload>("admin_get_reports_summary_counts", {
        p_week_start: weekStart,
        p_month_start: monthStart,
      });

      return {
        openReports: Number(counts.open_reports ?? 0),
        reportsThisWeek: Number(counts.reports_this_week ?? 0),
        suspended: Number(counts.suspended ?? 0),
        bannedThisMonth: Number(counts.banned_this_month ?? 0),
      };
    },
    refetchInterval: 30000,
  });

  if (isError && !summary) {
    return (
      <div className="glass-card p-4 rounded-2xl mb-6 border border-destructive/40 text-sm text-destructive">
        <AlertTriangle className="w-4 h-4 inline mr-2" />
        Report summary counts unavailable.
      </div>
    );
  }

  if (!summary) return null;

  const cards = [
    {
      icon: AlertTriangle,
      label: "Open Reports",
      value: summary.openReports,
      color: "bg-red-500/20 text-red-400",
      urgent: summary.openReports > 0,
    },
    {
      icon: Clock,
      label: "Reports This Week",
      value: summary.reportsThisWeek,
      color: "bg-orange-500/20 text-orange-400",
    },
    {
      icon: Shield,
      label: "Currently Suspended",
      value: summary.suspended,
      color: "bg-yellow-500/20 text-yellow-400",
    },
    {
      icon: Ban,
      label: "Banned (30d)",
      value: summary.bannedThisMonth,
      color: "bg-purple-500/20 text-purple-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="glass-card p-4 rounded-2xl relative">
            {card.urgent && (
              <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
            )}
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-xl ${card.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{card.value}</p>
          </div>
        );
      })}
    </div>
  );
};

export default AdminReportsSummary;
