import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  Heart,
  MessageSquare,
  Calendar,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { callAdminRpc } from "@/lib/adminRpc";

const AdminStatsCards = () => {
  const { data: metrics } = useQuery({
    queryKey: ['admin-overview-metrics'],
    queryFn: async () => {
      return callAdminRpc("admin_get_overview_metrics", {
        p_now: new Date().toISOString(),
      });
    },
  });

  const usersCount = Number(metrics?.total_users || 0);
  const todayUsersCount = Number(metrics?.today_users || 0);
  const matchesCount = Number(metrics?.total_matches || 0);
  const messagesCount = Number(metrics?.total_messages || 0);
  const eventsCount = Number((metrics?.events as { total?: number } | undefined)?.total || 0);
  const verifiedCount = Number(metrics?.verified_users || 0);
  const matchesPerUser = Number(metrics?.matches_per_user || 0).toFixed(2);

  const stats = [
    {
      label: 'Total Users',
      value: usersCount?.toLocaleString() || '0',
      icon: Users,
      color: 'from-primary to-accent',
      change: `+${todayUsersCount} today`,
    },
    {
      label: 'Total Matches',
      value: matchesCount?.toLocaleString() || '0',
      icon: Heart,
      color: 'from-pink-500 to-rose-600',
      change: 'All time',
    },
    {
      label: 'Messages Sent',
      value: messagesCount?.toLocaleString() || '0',
      icon: MessageSquare,
      color: 'from-cyan-500 to-blue-600',
      change: 'All time',
    },
    {
      label: 'Total Events',
      value: eventsCount?.toLocaleString() || '0',
      icon: Calendar,
      color: 'from-orange-500 to-amber-600',
      change: 'All rows',
      description: 'All event rows, including draft/cancelled/archived/ended.',
    },
    {
      label: 'Verified Users',
      value: verifiedCount?.toLocaleString() || '0',
      icon: UserCheck,
      color: 'from-green-500 to-emerald-600',
      change: `${usersCount ? Math.round((verifiedCount || 0) / usersCount * 100) : 0}% of total`,
    },
    {
      label: 'Matches/User',
      value: matchesPerUser,
      icon: TrendingUp,
      color: 'from-violet-500 to-purple-600',
      change: 'All-time avg',
      description: 'Server-computed all-time matches divided by total users. UTC reporting.',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="glass-card p-6 rounded-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-full">
                {stat.change}
              </span>
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              {stat.description && (
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{stat.description}</p>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default AdminStatsCards;
