import { useState } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import {
  Send,
  CheckCircle,
  Eye,
  MousePointer,
  TrendingUp,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { usePushAnalytics, PushAnalyticsRange } from "@/hooks/usePushAnalytics";

const DEVICE_COLORS: Record<string, string> = {
  iOS: "hsl(var(--primary))",
  Android: "hsl(var(--accent))",
  Web: "hsl(var(--muted-foreground))",
  PWA: "hsl(142, 76%, 36%)",
  Unknown: "hsl(var(--muted))",
};

const chartConfig = {
  sent: { label: "Sent", color: "hsl(var(--muted-foreground))" },
  delivered: { label: "Delivered", color: "hsl(var(--primary))" },
  opened: { label: "Opened", color: "hsl(var(--accent))" },
  clicked: { label: "Clicked", color: "hsl(142, 76%, 36%)" },
  deliveryRate: { label: "Delivery Rate", color: "hsl(var(--primary))" },
  openRate: { label: "Open Rate", color: "hsl(var(--accent))" },
  clickRate: { label: "Click Rate", color: "hsl(142, 76%, 36%)" },
};

const PushAnalyticsDashboard = () => {
  const [dateRange, setDateRange] = useState<PushAnalyticsRange>("30d");

  const { data, isLoading, error } = usePushAnalytics(dateRange);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Failed to load analytics. Please try again.
      </div>
    );
  }

  const { byDay, kpis, performance, deviceDistribution, bestTimes } = data;

  // Compare to previous period (simple: just show trend arrow based on last day vs first)
  const getTrend = (metricKey: "sent" | "delivered" | "opened" | "clicked") => {
    if (byDay.length < 2) return { value: 0, positive: true };
    const first = byDay[0][metricKey];
    const last = byDay[byDay.length - 1][metricKey];
    if (first === 0) return { value: 0, positive: true };
    const diff = ((last - first) / first) * 100;
    return { value: Math.abs(Math.round(diff)), positive: diff >= 0 };
  };

  const sentTrend = getTrend("sent");
  const openedTrend = getTrend("opened");
  const clickedTrend = getTrend("clicked");

  return (
    <div className="space-y-6">
      {/* Header with Date Filter */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Push Notification Analytics</h3>
          <p className="text-sm text-muted-foreground">Track delivery, engagement, and conversion rates</p>
        </div>
        <Select value={dateRange} onValueChange={(v: PushAnalyticsRange) => setDateRange(v)}>
          <SelectTrigger className="w-32 bg-secondary/50">
            <Calendar className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="14d">Last 14 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Send className="w-4 h-4" />
                <span className="text-xs">Total Sent</span>
              </div>
              {sentTrend.value > 0 && (
                <Badge
                  variant="outline"
                  className={`text-xs ${sentTrend.positive ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}`}
                >
                  {sentTrend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {sentTrend.value}%
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-foreground">{kpis.sent.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <CheckCircle className="w-4 h-4" />
              <span className="text-xs">Delivery Rate</span>
            </div>
            <p className="text-2xl font-bold text-green-400">{kpis.avgDeliveryRate}%</p>
            <p className="text-xs text-muted-foreground">{kpis.delivered.toLocaleString()} delivered</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Eye className="w-4 h-4" />
                <span className="text-xs">Open Rate</span>
              </div>
              {openedTrend.value > 0 && (
                <Badge
                  variant="outline"
                  className={`text-xs ${openedTrend.positive ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}`}
                >
                  {openedTrend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {openedTrend.value}%
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-cyan-400">{kpis.avgOpenRate}%</p>
            <p className="text-xs text-muted-foreground">{kpis.opened.toLocaleString()} opened</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MousePointer className="w-4 h-4" />
                <span className="text-xs">Click Rate</span>
              </div>
              {clickedTrend.value > 0 && (
                <Badge
                  variant="outline"
                  className={`text-xs ${clickedTrend.positive ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}`}
                >
                  {clickedTrend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {clickedTrend.value}%
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-primary">{kpis.avgClickRate}%</p>
            <p className="text-xs text-muted-foreground">{kpis.clicked.toLocaleString()} clicks</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Charts - Fixed height to prevent overlap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delivery & Opens Over Time */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Delivery & Opens Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-[280px] w-full">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={byDay} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="deliveredGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="delivered"
                      stroke="hsl(var(--primary))"
                      fill="url(#deliveredGradient)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="opened"
                      stroke="hsl(var(--accent))"
                      fill="url(#openedGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        {/* Rate Trends */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent" />
              Engagement Rates (%)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-[280px] w-full">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={byDay} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 100]}
                      width={40}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="deliveryRate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="openRate" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="clickRate" stroke="hsl(142, 76%, 36%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Type Performance & Device Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign Type Performance */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Performance by Campaign</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-[240px] w-full">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performance} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={100}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="sent" fill="hsl(var(--muted-foreground))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="opened" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="clicked" fill="hsl(142, 76%, 36%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        {/* Device Breakdown */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Device Distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {deviceDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={DEVICE_COLORS[entry.name] || "hsl(var(--muted))"} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              {deviceDistribution.map((device) => (
                <div key={device.name} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: DEVICE_COLORS[device.name] || "hsl(var(--muted))" }}
                  />
                  <span className="text-muted-foreground">{device.name}</span>
                  <span className="text-foreground font-medium">{device.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Best Performing Times */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Best Performing Send Times</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {bestTimes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No data yet</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {bestTimes.map((slot, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="glass-card p-3 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg font-bold text-foreground">{slot.time}</span>
                    <Badge variant="secondary" className="text-xs">
                      {slot.openRate}% open
                    </Badge>
                  </div>
                  <p className="text-sm text-primary font-medium">{slot.day}</p>
                  <p className="text-xs text-muted-foreground">{slot.reason}</p>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PushAnalyticsDashboard;
