import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
} from "recharts";
import { format, subDays, eachDayOfInterval, startOfDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { 
  Bell, 
  Droplet, 
  TrendingUp, 
  Target, 
  CheckCircle2, 
  XCircle,
  Clock,
  Heart,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#22d3ee', '#f472b6', '#a78bfa', '#34d399'];

const AdminEngagementAnalytics = () => {
  // Generate last 30 days
  const last30Days = eachDayOfInterval({
    start: subDays(new Date(), 29),
    end: new Date(),
  });

  // Fetch admin notification analytics
  const { data: notificationStats } = useQuery({
    queryKey: ['admin-notification-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('type, read, created_at');
      
      if (error) throw error;

      const total = data?.length || 0;
      const read = data?.filter(n => n.read).length || 0;
      const unread = total - read;
      const readRate = total > 0 ? Math.round((read / total) * 100) : 0;

      // Group by type
      const byType: Record<string, { total: number; read: number }> = {};
      data?.forEach(n => {
        if (!byType[n.type]) {
          byType[n.type] = { total: 0, read: 0 };
        }
        byType[n.type].total++;
        if (n.read) byType[n.type].read++;
      });

      // Group by day
      const byDay = last30Days.map(day => {
        const dayStart = startOfDay(day);
        const dayNotifs = data?.filter(
          n => startOfDay(new Date(n.created_at!)).getTime() === dayStart.getTime()
        ) || [];
        return {
          date: format(day, 'MMM d'),
          sent: dayNotifs.length,
          read: dayNotifs.filter(n => n.read).length,
        };
      });

      return {
        total,
        read,
        unread,
        readRate,
        byType: Object.entries(byType).map(([type, stats]) => ({
          type,
          ...stats,
          readRate: stats.total > 0 ? Math.round((stats.read / stats.total) * 100) : 0,
        })),
        byDay,
      };
    },
  });

  // Fetch daily drop analytics
  const { data: dailyDropStats } = useQuery({
    queryKey: ['admin-daily-drop-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_drops')
        .select('status, created_at, drop_date, expires_at');
      
      if (error) throw error;

      const total = data?.length || 0;
      const pending = data?.filter(d => d.status === 'pending').length || 0;
      const liked = data?.filter(d => d.status === 'liked').length || 0;
      const passed = data?.filter(d => d.status === 'passed').length || 0;
      const expired = data?.filter(d => d.status === 'expired').length || 0;
      const matched = data?.filter(d => d.status === 'matched').length || 0;

      const engagementRate = total > 0 
        ? Math.round(((liked + passed) / total) * 100) 
        : 0;
      const likeRate = (liked + passed) > 0 
        ? Math.round((liked / (liked + passed)) * 100) 
        : 0;
      const matchRate = liked > 0 
        ? Math.round((matched / liked) * 100) 
        : 0;

      // Group by day
      const byDay = last30Days.map(day => {
        const dayStart = startOfDay(day);
        const dayDrops = data?.filter(
          d => startOfDay(new Date(d.created_at)).getTime() === dayStart.getTime()
        ) || [];
        return {
          date: format(day, 'MMM d'),
          total: dayDrops.length,
          liked: dayDrops.filter(d => d.status === 'liked').length,
          passed: dayDrops.filter(d => d.status === 'passed').length,
          expired: dayDrops.filter(d => d.status === 'expired').length,
          matched: dayDrops.filter(d => d.status === 'matched').length,
        };
      });

      // Status distribution for pie chart
      const statusDistribution = [
        { name: 'Pending', value: pending, color: 'hsl(var(--muted-foreground))' },
        { name: 'Liked', value: liked, color: '#f472b6' },
        { name: 'Passed', value: passed, color: '#a78bfa' },
        { name: 'Expired', value: expired, color: '#64748b' },
        { name: 'Matched', value: matched, color: '#34d399' },
      ].filter(s => s.value > 0);

      return {
        total,
        pending,
        liked,
        passed,
        expired,
        matched,
        engagementRate,
        likeRate,
        matchRate,
        byDay,
        statusDistribution,
      };
    },
  });

  // Fetch user engagement metrics
  const { data: userEngagement } = useQuery({
    queryKey: ['admin-user-engagement'],
    queryFn: async () => {
      // Get message activity
      const { data: messages } = await supabase
        .from('messages')
        .select('created_at')
        .gte('created_at', subDays(new Date(), 30).toISOString());

      // Get match activity
      const { data: matches } = await supabase
        .from('matches')
        .select('matched_at')
        .gte('matched_at', subDays(new Date(), 30).toISOString());

      // Get event registrations
      const { data: registrations } = await supabase
        .from('event_registrations')
        .select('registered_at')
        .gte('registered_at', subDays(new Date(), 30).toISOString());

      const byDay = last30Days.map(day => {
        const dayStart = startOfDay(day);
        return {
          date: format(day, 'MMM d'),
          messages: messages?.filter(
            m => startOfDay(new Date(m.created_at)).getTime() === dayStart.getTime()
          ).length || 0,
          matches: matches?.filter(
            m => startOfDay(new Date(m.matched_at)).getTime() === dayStart.getTime()
          ).length || 0,
          registrations: registrations?.filter(
            r => startOfDay(new Date(r.registered_at)).getTime() === dayStart.getTime()
          ).length || 0,
        };
      });

      return {
        totalMessages: messages?.length || 0,
        totalMatches: matches?.length || 0,
        totalRegistrations: registrations?.length || 0,
        byDay,
      };
    },
  });

  const typeLabels: Record<string, string> = {
    new_user: 'New Users',
    new_match: 'Matches',
    event_full: 'Event Full',
    event_capacity_warning: 'Capacity Alert',
    user_report: 'Reports',
    user_suspended: 'Suspensions',
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Notification Read Rate */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <Bell className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {notificationStats?.readRate || 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">Notification Read Rate</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {notificationStats?.read || 0} read
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {notificationStats?.unread || 0} unread
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Daily Drop Engagement */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                  <Droplet className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {dailyDropStats?.engagementRate || 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">Drop Engagement Rate</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="text-xs text-pink-500 border-pink-500/30">
                  {dailyDropStats?.likeRate || 0}% like rate
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Match Conversion */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
                  <Heart className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {dailyDropStats?.matchRate || 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">Drop → Match Rate</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                  {dailyDropStats?.matched || 0} matches
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Total Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {(userEngagement?.totalMessages || 0) + (userEngagement?.totalMatches || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">30-Day Activities</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {userEngagement?.totalMessages || 0} msgs
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {userEngagement?.totalMatches || 0} matches
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notification Delivery Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card p-6 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Notification Delivery & Opens</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={notificationStats?.byDay || []}>
                <defs>
                  <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRead" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    color: 'hsl(var(--foreground))',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorSent)"
                  name="Sent"
                />
                <Area
                  type="monotone"
                  dataKey="read"
                  stroke="#34d399"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRead)"
                  name="Read"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Daily Drop Status Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="glass-card p-6 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <Droplet className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-semibold text-foreground">Daily Drop Outcomes</h3>
          </div>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dailyDropStats?.statusDistribution || []}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {dailyDropStats?.statusDistribution?.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    color: 'hsl(var(--foreground))',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {dailyDropStats?.statusDistribution?.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: entry.color || COLORS[index % COLORS.length] }}
                />
                <span className="text-sm text-muted-foreground">
                  {entry.name}: {entry.value}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Daily Drop Trends */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="glass-card p-6 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-pink-400" />
            <h3 className="text-lg font-semibold text-foreground">Daily Drop Engagement (30 Days)</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyDropStats?.byDay || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    color: 'hsl(var(--foreground))',
                  }}
                />
                <Bar dataKey="total" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} name="Total Drops" />
                <Line
                  type="monotone"
                  dataKey="liked"
                  stroke="#f472b6"
                  strokeWidth={2}
                  dot={{ fill: '#f472b6', strokeWidth: 0, r: 3 }}
                  name="Liked"
                />
                <Line
                  type="monotone"
                  dataKey="matched"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={{ fill: '#34d399', strokeWidth: 0, r: 3 }}
                  name="Matched"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* User Activity Trends */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="glass-card p-6 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-semibold text-foreground">User Activity Trends</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={userEngagement?.byDay || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    color: 'hsl(var(--foreground))',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="messages"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }}
                  name="Messages"
                />
                <Line
                  type="monotone"
                  dataKey="matches"
                  stroke="#f472b6"
                  strokeWidth={2}
                  dot={{ fill: '#f472b6', strokeWidth: 0, r: 3 }}
                  name="Matches"
                />
                <Line
                  type="monotone"
                  dataKey="registrations"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={{ fill: '#22d3ee', strokeWidth: 0, r: 3 }}
                  name="Event Registrations"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Notification Type Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="glass-card p-6 rounded-2xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Notification Performance by Type</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={notificationStats?.byType?.map(t => ({
                ...t,
                label: typeLabels[t.type] || t.type,
              })) || []}
              layout="vertical"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                dataKey="label"
                type="category"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '12px',
                  color: 'hsl(var(--foreground))',
                }}
                formatter={(value: number, name: string) => [
                  name === 'total' ? `${value} sent` : `${value} read`,
                  name === 'total' ? 'Sent' : 'Read',
                ]}
              />
              <Bar dataKey="total" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} name="total" />
              <Bar dataKey="read" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="read" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminEngagementAnalytics;
