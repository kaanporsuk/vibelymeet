import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Droplet,
  Eye,
  Heart,
  RefreshCw,
  Send,
  Target,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminEngagementAnalytics } from "@/hooks/useAdminEngagementAnalytics";
import { sanitizeAdminRpcErrorMessage } from "@/lib/adminRpc";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#22d3ee", "#f472b6", "#a78bfa", "#34d399"];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "12px",
  color: "hsl(var(--foreground))",
};

function formatCount(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString();
}

type MetricCardProps = {
  delay?: number;
  icon: ReactNode;
  title: string;
  value: string;
  badges: ReactNode;
  gradient: string;
};

const MetricCard = ({ delay = 0, icon, title, value, badges, gradient }: MetricCardProps) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl ${gradient} flex items-center justify-center text-white`}>
            {icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>
      </CardContent>
    </Card>
  </motion.div>
);

const LoadingPanel = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    {Array.from({ length: 4 }).map((_, index) => (
      <div key={index} className="glass-card p-6 rounded-2xl animate-pulse">
        <div className="h-5 w-52 rounded bg-secondary mb-4" />
        <div className="h-64 rounded bg-secondary/70" />
      </div>
    ))}
  </div>
);

const ChartEmptyState = ({ title, detail }: { title: string; detail: string }) => (
  <div className="h-full rounded-xl border border-border/50 bg-secondary/20 flex items-center justify-center px-6 text-center">
    <div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{detail}</p>
    </div>
  </div>
);

const AdminEngagementAnalytics = () => {
  const { data, error, isError, isLoading, refetch } = useAdminEngagementAnalytics(30);

  if (isLoading) {
    return (
      <div className="space-y-6" aria-label="Loading Engagement Analytics">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="glass-card animate-pulse">
              <CardContent className="p-4">
                <div className="h-12 w-12 rounded-xl bg-secondary mb-3" />
                <div className="h-7 w-20 rounded bg-secondary mb-2" />
                <div className="h-4 w-36 rounded bg-secondary" />
              </CardContent>
            </Card>
          ))}
        </div>
        <LoadingPanel />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="glass-card p-6 rounded-2xl border-destructive/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Unable to load Engagement Analytics</h3>
              <p className="text-sm text-muted-foreground">
                Metrics are hidden until the backend engagement read model succeeds.
              </p>
              {error?.message && (
                <p className="text-xs text-muted-foreground mt-1">{sanitizeAdminRpcErrorMessage(error)}</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const provider = data.notifications.provider_totals;
  const notificationDays = data.notifications.by_day;
  const appCategories = data.notifications.app_by_category;
  const appLogTotals = data.notifications.app_log_totals;
  const dailyDrop = data.daily_drop.totals;
  const dailyDropDays = data.daily_drop.by_day;
  const statusDistribution = data.daily_drop.status_distribution.filter((item) => item.value > 0);
  const activityTotals = data.user_activity.totals;
  const activityDays = data.user_activity.by_day;

  const hasProviderTelemetry = provider.queued_rows > 0;
  const hasDailyDropRows = dailyDrop.total > 0;
  const hasActivityRows = activityTotals.total_activities > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={<Send className="w-6 h-6" />}
          title="Push Delivery Rate"
          value={`${provider.delivery_rate}%`}
          gradient="bg-gradient-to-br from-primary to-accent"
          badges={
            <>
              <Badge variant="outline" className="text-xs">
                {formatCount(provider.delivered_rows)} delivered
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {formatCount(provider.sent_rows)} sent
              </Badge>
            </>
          }
        />

        <MetricCard
          delay={0.1}
          icon={<Eye className="w-6 h-6" />}
          title="Push Open Rate"
          value={`${provider.open_rate}%`}
          gradient="bg-gradient-to-br from-cyan-500 to-blue-500"
          badges={
            <>
              <Badge variant="outline" className="text-xs text-cyan-400 border-cyan-400/30">
                {formatCount(provider.opened_rows)} opened
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {formatCount(provider.clicked_rows)} clicked
              </Badge>
            </>
          }
        />

        <MetricCard
          delay={0.2}
          icon={<Droplet className="w-6 h-6" />}
          title="Drop Engagement Rate"
          value={`${dailyDrop.engagement_rate}%`}
          gradient="bg-gradient-to-br from-pink-500 to-rose-500"
          badges={
            <>
              <Badge variant="outline" className="text-xs text-pink-400 border-pink-400/30">
                {formatCount(dailyDrop.engaged_rows)} engaged
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {dailyDrop.opener_rate}% opener rate
              </Badge>
            </>
          }
        />

        <MetricCard
          delay={0.3}
          icon={<BarChart3 className="w-6 h-6" />}
          title="30-Day Activities"
          value={formatCount(activityTotals.total_activities)}
          gradient="bg-gradient-to-br from-amber-500 to-orange-500"
          badges={
            <>
              <Badge variant="outline" className="text-xs">
                {formatCount(activityTotals.total_messages)} msgs
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {formatCount(activityTotals.total_matches)} matches
              </Badge>
              <Badge variant="outline" className="text-xs">
                {formatCount(activityTotals.total_registrations)} regs
              </Badge>
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card p-6 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Push Delivery & Opens (30 Days UTC)</h3>
          </div>
          <div className="h-64">
            {!hasProviderTelemetry ? (
              <ChartEmptyState
                title="No provider telemetry in this UTC window"
                detail="This does not prove no user notifications were sent outside tracked provider rows."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={notificationDays}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="sent" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Sent" />
                  <Line type="monotone" dataKey="delivered" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} name="Delivered" />
                  <Line type="monotone" dataKey="opened" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} name="Opened" />
                  <Line type="monotone" dataKey="clicked" stroke="#f472b6" strokeWidth={2} dot={{ r: 3 }} name="Clicked" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

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
            {!hasDailyDropRows ? (
              <ChartEmptyState
                title="No Daily Drop rows in this UTC window"
                detail="Outcome distribution is unavailable until drops exist for the selected range."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                    {statusDistribution.map((entry, index) => (
                      <Cell key={entry.status} fill={entry.color || COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {statusDistribution.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              {statusDistribution.map((entry, index) => (
                <div key={entry.status} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color || COLORS[index % COLORS.length] }} />
                  <span className="text-sm text-muted-foreground">
                    {entry.name}: {formatCount(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="glass-card p-6 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-pink-400" />
            <h3 className="text-lg font-semibold text-foreground">Daily Drop Engagement (30 Days UTC)</h3>
          </div>
          <div className="h-64">
            {!hasDailyDropRows ? (
              <ChartEmptyState
                title="No Daily Drop trend data"
                detail="The backend returned zero Daily Drop rows for this UTC window."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyDropDays}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="total" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} name="Total Drops" />
                  <Line type="monotone" dataKey="engaged" stroke="#f472b6" strokeWidth={2} dot={{ r: 3 }} name="Engaged" />
                  <Line type="monotone" dataKey="opener_sent" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} name="Opener Sent" />
                  <Line type="monotone" dataKey="matched" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} name="Matched" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

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
            {!hasActivityRows ? (
              <ChartEmptyState
                title="No activity rows in this UTC window"
                detail="Messages, matches, and event registrations all returned zero."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activityDays}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="messages" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Messages" />
                  <Line type="monotone" dataKey="matches" stroke="#f472b6" strokeWidth={2} dot={{ r: 3 }} name="Matches" />
                  <Line type="monotone" dataKey="registrations" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} name="Event Registrations" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="glass-card p-6 rounded-2xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <Heart className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Notification Performance by Category</h3>
        </div>
        <div className="h-64">
          {appCategories.length === 0 ? (
            <ChartEmptyState
              title="No app notification log categories"
              detail={`${formatCount(appLogTotals.log_rows)} notification_log rows were found in this UTC window.`}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={appCategories} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis dataKey="label" type="category" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={130} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="total" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} name="Logged" />
                <Bar dataKey="delivered" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Delivered" />
                <Bar dataKey="suppressed" fill="#ef4444" radius={[0, 4, 4, 0]} name="Suppressed" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default AdminEngagementAnalytics;
