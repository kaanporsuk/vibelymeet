import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Shield, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { subDays, startOfWeek } from "date-fns";

const AdminReportsSummary = () => {
  const { data: summary } = useQuery({
    queryKey: ["admin-reports-summary"],
    queryFn: async () => {
      const now = new Date();
      const weekStart = startOfWeek(now).toISOString();
      const monthStart = subDays(now, 30).toISOString();

      const { count: openReports } = await supabase
        .from("user_reports")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");

      const { count: reportsThisWeek } = await supabase
        .from("user_reports")
        .select("*", { count: "exact", head: true })
        .gte("created_at", weekStart);

      const { count: suspended } = await supabase
        .from("user_suspensions")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      const { count: bannedThisMonth } = await supabase
        .from("user_suspensions")
        .select("*", { count: "exact", head: true })
        .is("expires_at", null)
        .gte("suspended_at", monthStart);

      return {
        openReports: openReports || 0,
        reportsThisWeek: reportsThisWeek || 0,
        suspended: suspended || 0,
        bannedThisMonth: bannedThisMonth || 0,
      };
    },
    refetchInterval: 30000,
  });

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
