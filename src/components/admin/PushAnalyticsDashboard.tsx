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
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Send,
  CheckCircle,
  Eye,
  MousePointer,
  TrendingUp,
  TrendingDown,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
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

// Generate mock analytics data for the last 30 days
const generateAnalyticsData = () => {
  const data = [];
  const now = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    const sent = Math.floor(Math.random() * 500) + 800;
    const delivered = Math.floor(sent * (0.92 + Math.random() * 0.06));
    const opened = Math.floor(delivered * (0.25 + Math.random() * 0.25));
    const clicked = Math.floor(opened * (0.15 + Math.random() * 0.2));
    
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: date.toISOString(),
      sent,
      delivered,
      opened,
      clicked,
      deliveryRate: Math.round((delivered / sent) * 100),
      openRate: Math.round((opened / delivered) * 100),
      clickRate: Math.round((clicked / opened) * 100),
    });
  }
  
  return data;
};

const analyticsData = generateAnalyticsData();

// Campaign performance by type
const campaignTypeData = [
  { name: 'Re-engagement', sent: 12500, opened: 4250, clicked: 850, color: 'hsl(var(--primary))' },
  { name: 'Event Promotion', sent: 8200, opened: 3690, clicked: 1107, color: 'hsl(var(--accent))' },
  { name: 'Daily Drop Reminder', sent: 15800, opened: 6320, clicked: 1264, color: 'hsl(142, 76%, 36%)' },
  { name: 'Milestone', sent: 3200, opened: 1920, clicked: 576, color: 'hsl(43, 74%, 49%)' },
];

// Device breakdown
const deviceData = [
  { name: 'iOS', value: 58, color: 'hsl(var(--primary))' },
  { name: 'Android', value: 35, color: 'hsl(var(--accent))' },
  { name: 'Web', value: 7, color: 'hsl(var(--muted-foreground))' },
];

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
  const [dateRange, setDateRange] = useState<'7d' | '14d' | '30d'>('30d');
  
  const filteredData = dateRange === '7d' 
    ? analyticsData.slice(-7) 
    : dateRange === '14d' 
    ? analyticsData.slice(-14) 
    : analyticsData;
  
  // Calculate totals and trends
  const totals = filteredData.reduce(
    (acc, day) => ({
      sent: acc.sent + day.sent,
      delivered: acc.delivered + day.delivered,
      opened: acc.opened + day.opened,
      clicked: acc.clicked + day.clicked,
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0 }
  );
  
  const avgDeliveryRate = Math.round((totals.delivered / totals.sent) * 100);
  const avgOpenRate = Math.round((totals.opened / totals.delivered) * 100);
  const avgClickRate = Math.round((totals.clicked / totals.opened) * 100);
  
  // Compare to previous period
  const prevPeriodData = dateRange === '7d' 
    ? analyticsData.slice(-14, -7) 
    : dateRange === '14d' 
    ? analyticsData.slice(-28, -14) 
    : [];
  
  const prevTotals = prevPeriodData.reduce(
    (acc, day) => ({
      sent: acc.sent + day.sent,
      delivered: acc.delivered + day.delivered,
      opened: acc.opened + day.opened,
      clicked: acc.clicked + day.clicked,
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0 }
  );
  
  const getTrend = (current: number, previous: number) => {
    if (previous === 0) return { value: 0, positive: true };
    const diff = ((current - previous) / previous) * 100;
    return { value: Math.abs(Math.round(diff)), positive: diff >= 0 };
  };
  
  const sentTrend = getTrend(totals.sent, prevTotals.sent);
  const openedTrend = getTrend(totals.opened, prevTotals.opened);
  const clickedTrend = getTrend(totals.clicked, prevTotals.clicked);

  return (
    <div className="space-y-6">
      {/* Header with Date Filter */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Push Notification Analytics</h3>
          <p className="text-sm text-muted-foreground">Track delivery, engagement, and conversion rates</p>
        </div>
        <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
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
              {prevTotals.sent > 0 && (
                <Badge 
                  variant="outline" 
                  className={`text-xs ${sentTrend.positive ? 'text-green-400 border-green-400/30' : 'text-red-400 border-red-400/30'}`}
                >
                  {sentTrend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {sentTrend.value}%
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-foreground">{totals.sent.toLocaleString()}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <CheckCircle className="w-4 h-4" />
              <span className="text-xs">Delivery Rate</span>
            </div>
            <p className="text-2xl font-bold text-green-400">{avgDeliveryRate}%</p>
            <p className="text-xs text-muted-foreground">{totals.delivered.toLocaleString()} delivered</p>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Eye className="w-4 h-4" />
                <span className="text-xs">Open Rate</span>
              </div>
              {prevTotals.opened > 0 && (
                <Badge 
                  variant="outline" 
                  className={`text-xs ${openedTrend.positive ? 'text-green-400 border-green-400/30' : 'text-red-400 border-red-400/30'}`}
                >
                  {openedTrend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {openedTrend.value}%
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-cyan-400">{avgOpenRate}%</p>
            <p className="text-xs text-muted-foreground">{totals.opened.toLocaleString()} opened</p>
          </CardContent>
        </Card>
        
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MousePointer className="w-4 h-4" />
                <span className="text-xs">Click Rate</span>
              </div>
              {prevTotals.clicked > 0 && (
                <Badge 
                  variant="outline" 
                  className={`text-xs ${clickedTrend.positive ? 'text-green-400 border-green-400/30' : 'text-red-400 border-red-400/30'}`}
                >
                  {clickedTrend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {clickedTrend.value}%
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-primary">{avgClickRate}%</p>
            <p className="text-xs text-muted-foreground">{totals.clicked.toLocaleString()} clicks</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delivery & Opens Over Time */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Delivery & Opens Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px]">
              <AreaChart data={filteredData}>
                <defs>
                  <linearGradient id="deliveredGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
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
            </ChartContainer>
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
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[250px]">
              <LineChart data={filteredData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="deliveryRate"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="openRate"
                  stroke="hsl(var(--accent))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="clickRate"
                  stroke="hsl(142, 76%, 36%)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Type Performance & Device Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign Type Performance */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Performance by Campaign Type</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[220px]">
              <BarChart data={campaignTypeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis 
                  type="number" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="sent" fill="hsl(var(--muted-foreground))" radius={[0, 4, 4, 0]} />
                <Bar dataKey="opened" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                <Bar dataKey="clicked" fill="hsl(142, 76%, 36%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Device Breakdown */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Device Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {deviceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-2">
              {deviceData.map((device) => (
                <div key={device.name} className="flex items-center gap-1.5 text-xs">
                  <div 
                    className="w-2.5 h-2.5 rounded-full" 
                    style={{ backgroundColor: device.color }}
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
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { time: '6:00 PM', day: 'Tuesday', openRate: 42, reason: 'Daily Drop reminder' },
              { time: '9:00 AM', day: 'Saturday', openRate: 38, reason: 'Weekend events' },
              { time: '7:00 PM', day: 'Thursday', openRate: 35, reason: 'Re-engagement' },
              { time: '12:00 PM', day: 'Sunday', openRate: 31, reason: 'Match reminders' },
            ].map((slot, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-3 rounded-xl bg-secondary/30 border border-border/50"
              >
                <div className="text-lg font-bold text-foreground">{slot.time}</div>
                <div className="text-sm text-primary">{slot.day}</div>
                <div className="text-xs text-muted-foreground mt-1">{slot.reason}</div>
                <div className="mt-2 flex items-center gap-1">
                  <Eye className="w-3 h-3 text-cyan-400" />
                  <span className="text-sm font-medium text-cyan-400">{slot.openRate}% open rate</span>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PushAnalyticsDashboard;
