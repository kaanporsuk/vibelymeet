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
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Users, Heart, Calendar, TrendingUp } from "lucide-react";
import { useAdminOverviewDashboard } from "@/hooks/useAdminOverviewDashboard";
import { resolveAdminErrorMessage } from "@/lib/adminErrorResolver";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#22d3ee', '#f472b6', '#a78bfa'];

const eventLifecycleLabel = (status: string | null | undefined) =>
  (status || "unknown").replace(/_/g, " ");

const eventLifecycleBadgeClass = (status: string | null | undefined) => {
  switch (status) {
    case "live":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "wrap_up_grace":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "needs_finalization_repair":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "finalized":
      return "bg-orange-500/15 text-orange-300 border-orange-500/30";
    default:
      return "bg-secondary text-muted-foreground border-white/10";
  }
};

const AdminAnalyticsCharts = () => {
  const {
    data: overview,
    error,
    isError,
    isLoading,
    refetch,
  } = useAdminOverviewDashboard();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="Loading Overview charts">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="glass-card p-6 rounded-2xl animate-pulse">
            <div className="h-5 w-44 rounded bg-secondary mb-4" />
            <div className="h-64 rounded bg-secondary/70" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || !overview?.charts) {
    return (
      <div className="glass-card p-6 rounded-2xl border-destructive/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Unable to load Overview charts</h3>
              <p className="text-sm text-muted-foreground">
                Chart data is hidden until the backend overview read succeeds.
              </p>
              {error && (
                <p className="text-xs text-muted-foreground mt-1">
                  {resolveAdminErrorMessage(error, "Could not load Overview charts")}
                </p>
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

  const userGrowthData = overview.charts.user_growth_30d;
  const matchTrendsData = overview.charts.match_trends_30d;
  const latestEventRows = overview.charts.latest_event_fill_rows;
  const genderData = overview.charts.gender_distribution;
  const possibleTestEventRows = overview.data_hygiene?.possible_test_event_rows ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* New users per day chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6 rounded-2xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">New Users Per Day (30 Days UTC)</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={userGrowthData}>
              <defs>
                <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
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
                dataKey="users"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorUsers)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Match Trends Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-6 rounded-2xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <Heart className="w-5 h-5 text-pink-400" />
          <h3 className="text-lg font-semibold text-foreground">Match Trends (30 Days UTC)</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={matchTrendsData}>
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
                dataKey="matches"
                stroke="#f472b6"
                strokeWidth={2}
                dot={{ fill: '#f472b6', strokeWidth: 0, r: 3 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Latest Event Rows Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card p-6 rounded-2xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-orange-400" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">Latest Event Rows (Capacity Fill)</h3>
            <p className="text-xs text-muted-foreground">
              Latest 10 event rows, including archived/ended rows when present.
            </p>
          </div>
        </div>
        {possibleTestEventRows > 0 && (
          <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {possibleTestEventRows} event row(s) look like test/smoke data. Review explicitly in the Events panel before taking action.
          </p>
        )}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={latestEventRows} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                type="number"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                dataKey="name"
                type="category"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '12px',
                  color: 'hsl(var(--foreground))',
                }}
                formatter={(value: number, name: string) => [
                  name === 'attendees' ? `${value} attending` : `${value} capacity`,
                  name,
                ]}
              />
              <Bar dataKey="attendees" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              <Bar dataKey="capacity" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {latestEventRows.slice(0, 6).map((row) => (
            <Badge
              key={row.id}
              variant="outline"
              className={`max-w-full truncate text-[10px] ${eventLifecycleBadgeClass(row.lifecycle_status)}`}
              title={`${row.title}: ${eventLifecycleLabel(row.lifecycle_status)}`}
            >
              {row.name}: {eventLifecycleLabel(row.lifecycle_status)}
            </Badge>
          ))}
        </div>
      </motion.div>

      {/* Gender Distribution Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass-card p-6 rounded-2xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold text-foreground">Gender Distribution</h3>
        </div>
        <div className="h-64 flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={genderData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={5}
                dataKey="value"
              >
                {genderData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
        <div className="flex flex-wrap justify-center gap-4 mt-2">
          {genderData.map((entry, index) => (
            <div key={entry.name} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: COLORS[index % COLORS.length] }}
              />
              <span className="text-sm text-muted-foreground">
                {entry.name}: {entry.value}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default AdminAnalyticsCharts;
