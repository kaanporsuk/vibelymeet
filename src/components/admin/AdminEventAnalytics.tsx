import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Users,
  DollarSign,
  Calendar,
  CheckCircle,
  BarChart3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = ['#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#22c55e'];

const AdminEventAnalytics = () => {
  // Fetch events with registration data
  const { data: events = [] } = useQuery({
    queryKey: ['admin-event-analytics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch registration trends (last 30 days)
  const { data: registrationTrends = [] } = useQuery({
    queryKey: ['admin-registration-trends'],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30);
      const { data, error } = await supabase
        .from('event_registrations')
        .select('registered_at, event_id')
        .gte('registered_at', thirtyDaysAgo.toISOString());
      
      if (error) throw error;
      
      // Group by day
      const byDay: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const day = format(subDays(new Date(), i), 'MMM dd');
        byDay[day] = 0;
      }
      
      data?.forEach(reg => {
        const day = format(new Date(reg.registered_at), 'MMM dd');
        if (byDay[day] !== undefined) {
          byDay[day]++;
        }
      });
      
      return Object.entries(byDay).map(([date, count]) => ({ date, registrations: count }));
    },
  });

  // Fetch attendance stats per event
  const { data: attendanceStats = [] } = useQuery({
    queryKey: ['admin-attendance-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_registrations')
        .select('event_id, attended, events(title)')
        .not('events', 'is', null);
      
      if (error) throw error;
      
      // Group by event
      const eventMap: Record<string, { title: string; registered: number; attended: number }> = {};
      
      data?.forEach(reg => {
        const eventTitle = (reg.events as any)?.title || 'Unknown';
        if (!eventMap[reg.event_id]) {
          eventMap[reg.event_id] = { title: eventTitle, registered: 0, attended: 0 };
        }
        eventMap[reg.event_id].registered++;
        if (reg.attended) {
          eventMap[reg.event_id].attended++;
        }
      });
      
      return Object.values(eventMap)
        .map(e => ({
          ...e,
          name: e.title.length > 20 ? e.title.substring(0, 17) + '...' : e.title,
          rate: e.registered > 0 ? Math.round((e.attended / e.registered) * 100) : 0,
        }))
        .slice(0, 8);
    },
  });

  // Calculate revenue by event (simplified - assuming all paid registrations)
  const { data: revenueData = [] } = useQuery({
    queryKey: ['admin-revenue-data'],
    queryFn: async () => {
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, title, is_free, price_amount, price_currency, current_attendees')
        .eq('is_free', false);
      
      if (eventsError) throw eventsError;
      
      return (eventsData || [])
        .filter(e => e.price_amount && e.price_amount > 0)
        .map(e => ({
          name: e.title.length > 15 ? e.title.substring(0, 12) + '...' : e.title,
          revenue: (e.price_amount || 0) * (e.current_attendees || 0),
          currency: e.price_currency || 'EUR',
          attendees: e.current_attendees || 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    },
  });

  // Calculate totals
  const totalRegistrations = registrationTrends.reduce((sum, d) => sum + d.registrations, 0);
  const averageAttendanceRate = attendanceStats.length > 0
    ? Math.round(attendanceStats.reduce((sum, e) => sum + e.rate, 0) / attendanceStats.length)
    : 0;
  const totalRevenue = revenueData.reduce((sum, e) => sum + e.revenue, 0);
  const upcomingEvents = events.filter(e => new Date(e.event_date) > new Date()).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-2xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-pink-500/20 rounded-xl">
              <Users className="w-5 h-5 text-pink-400" />
            </div>
            <span className="text-xs text-muted-foreground">Registrations (30d)</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalRegistrations}</p>
        </div>

        <div className="glass-card p-4 rounded-2xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <span className="text-xs text-muted-foreground">Avg Attendance</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{averageAttendanceRate}%</p>
        </div>

        <div className="glass-card p-4 rounded-2xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-cyan-500/20 rounded-xl">
              <DollarSign className="w-5 h-5 text-cyan-400" />
            </div>
            <span className="text-xs text-muted-foreground">Total Revenue</span>
          </div>
          <p className="text-2xl font-bold text-foreground">€{totalRevenue.toLocaleString()}</p>
        </div>

        <div className="glass-card p-4 rounded-2xl">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-500/20 rounded-xl">
              <Calendar className="w-5 h-5 text-orange-400" />
            </div>
            <span className="text-xs text-muted-foreground">Upcoming Events</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{upcomingEvents}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Registration Trends */}
        <div className="glass-card p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Registration Trends (30 Days)
            </h3>
          </div>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={registrationTrends}>
                <defs>
                  <linearGradient id="colorRegistrations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '12px',
                    color: '#f9fafb',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="registrations"
                  stroke="#ec4899"
                  fill="url(#colorRegistrations)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Attendance Rates by Event */}
        <div className="glass-card p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Attendance Rates by Event
            </h3>
          </div>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendanceStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis 
                  type="number" 
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis 
                  type="category"
                  dataKey="name" 
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '12px',
                    color: '#f9fafb',
                  }}
                  formatter={(value: number) => [`${value}%`, 'Attendance Rate']}
                />
                <Bar dataKey="rate" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue by Event */}
        <div className="glass-card p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Revenue by Event
            </h3>
          </div>
          <div className="h-[250px]">
            {revenueData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={revenueData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="revenue"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {revenueData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1f2937',
                      border: '1px solid #374151',
                      borderRadius: '12px',
                      color: '#f9fafb',
                    }}
                    formatter={(value: number) => [`€${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                No paid events yet
              </div>
            )}
          </div>
        </div>

        {/* Top Events Table */}
        <div className="glass-card p-6 rounded-2xl">
          <h3 className="font-semibold text-foreground mb-4">Top Performing Events</h3>
          <div className="space-y-3">
            {events.slice(0, 5).map((event, i) => (
              <div key={event.id} className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                  {i + 1}
                </div>
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-secondary">
                  <img 
                    src={event.cover_image} 
                    alt={event.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.current_attendees || 0} / {event.max_attendees || 50} attendees
                  </p>
                </div>
                <Badge 
                  variant="outline"
                  className={
                    new Date(event.event_date) > new Date()
                      ? 'bg-green-500/10 text-green-400 border-green-500/30'
                      : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                  }
                >
                  {new Date(event.event_date) > new Date() ? 'Upcoming' : 'Past'}
                </Badge>
              </div>
            ))}
            {events.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No events yet</p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminEventAnalytics;