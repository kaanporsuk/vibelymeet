import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  Heart,
  MessageSquare,
  Calendar,
  TrendingUp,
  Activity,
  UserCheck,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const AdminStatsCards = () => {
  // Fetch total users
  const { data: usersCount } = useQuery({
    queryKey: ['admin-users-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
      return count || 0;
    },
  });

  // Fetch total matches
  const { data: matchesCount } = useQuery({
    queryKey: ['admin-matches-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true });
      return count || 0;
    },
  });

  // Fetch total messages
  const { data: messagesCount } = useQuery({
    queryKey: ['admin-messages-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true });
      return count || 0;
    },
  });

  // Fetch total events
  const { data: eventsCount } = useQuery({
    queryKey: ['admin-events-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true });
      return count || 0;
    },
  });

  // Fetch verified users
  const { data: verifiedCount } = useQuery({
    queryKey: ['admin-verified-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('photo_verified', true);
      return count || 0;
    },
  });

  // Fetch today's new users
  const { data: todayUsersCount } = useQuery({
    queryKey: ['admin-today-users'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());
      return count || 0;
    },
  });

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
      label: 'Active Events',
      value: eventsCount?.toLocaleString() || '0',
      icon: Calendar,
      color: 'from-orange-500 to-amber-600',
      change: 'Scheduled',
    },
    {
      label: 'Verified Users',
      value: verifiedCount?.toLocaleString() || '0',
      icon: UserCheck,
      color: 'from-green-500 to-emerald-600',
      change: `${usersCount ? Math.round((verifiedCount || 0) / usersCount * 100) : 0}% of total`,
    },
    {
      label: 'Match Rate',
      value: usersCount && matchesCount ? `${Math.round(matchesCount / usersCount * 100)}%` : '0%',
      icon: TrendingUp,
      color: 'from-violet-500 to-purple-600',
      change: 'Per user avg',
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
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default AdminStatsCards;