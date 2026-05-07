import { motion } from "framer-motion";
import {
  AlertTriangle,
  Users,
  Heart,
  MessageSquare,
  Calendar,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatAdminCount,
  useAdminOverviewDashboard,
} from "@/hooks/useAdminOverviewDashboard";

const AdminStatsCards = () => {
  const {
    data: overview,
    error,
    isError,
    isLoading,
    refetch,
  } = useAdminOverviewDashboard();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading Overview metrics">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="glass-card p-6 rounded-2xl animate-pulse">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-secondary" />
              <div className="w-20 h-6 rounded-full bg-secondary" />
            </div>
            <div className="space-y-2">
              <div className="h-8 w-24 rounded bg-secondary" />
              <div className="h-4 w-28 rounded bg-secondary" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError || !overview?.stats) {
    return (
      <div className="glass-card p-6 rounded-2xl border-destructive/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Unable to load Overview metrics</h3>
              <p className="text-sm text-muted-foreground">
                Backend admin metrics are unavailable, so the dashboard is not showing fallback zeroes.
              </p>
              {error?.message && (
                <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const metrics = overview.stats;
  const usersCount = metrics.total_users;
  const todayUsersCount = metrics.today_users;
  const matchesCount = metrics.total_matches;
  const messagesCount = metrics.total_messages;
  const eventsCount = metrics.events.total;
  const verifiedCount = metrics.verified_users;
  const matchesPerUser = Number(metrics.matches_per_user).toFixed(2);

  const stats = [
    {
      label: 'Total Users',
      value: formatAdminCount(usersCount),
      icon: Users,
      color: 'from-primary to-accent',
      change: `+${todayUsersCount} today`,
    },
    {
      label: 'Total Matches',
      value: formatAdminCount(matchesCount),
      icon: Heart,
      color: 'from-pink-500 to-rose-600',
      change: 'All time',
    },
    {
      label: 'Messages Sent',
      value: formatAdminCount(messagesCount),
      icon: MessageSquare,
      color: 'from-cyan-500 to-blue-600',
      change: 'All time',
    },
    {
      label: 'Total Events',
      value: formatAdminCount(eventsCount),
      icon: Calendar,
      color: 'from-orange-500 to-amber-600',
      change: 'All rows',
      description: 'All event rows, including draft/cancelled/archived/ended.',
    },
    {
      label: 'Verified Users',
      value: formatAdminCount(verifiedCount),
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
