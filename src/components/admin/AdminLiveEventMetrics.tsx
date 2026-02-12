import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  Video,
  Search,
  Activity,
  TrendingUp,
  Heart,
  X,
  Sparkles,
  HandMetal,
  MessageSquare,
  AlertTriangle,
  Clock,
  PieChart,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import {
  PieChart as RechartsPie,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = ["#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#22c55e"];

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  warning?: boolean;
}

const MetricCard = ({ icon: Icon, label, value, color, warning }: MetricCardProps) => (
  <div className="glass-card p-4 rounded-2xl relative">
    {warning && (
      <div className="absolute top-2 right-2">
        <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[10px]">!</Badge>
      </div>
    )}
    <div className="flex items-center gap-3 mb-2">
      <div className={`p-2 rounded-xl ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
  </div>
);

const AdminLiveEventMetrics = () => {
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // Fetch all events for selector
  const { data: events = [] } = useQuery({
    queryKey: ["admin-events-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, duration_minutes, status")
        .order("event_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const eventId = selectedEventId || events[0]?.id || "";

  // Live metrics — poll every 10s
  const { data: metrics } = useQuery({
    queryKey: ["admin-live-metrics", eventId],
    queryFn: async () => {
      if (!eventId) return null;

      // Registrations with queue status
      const { data: regs } = await supabase
        .from("event_registrations")
        .select("profile_id, queue_status, profiles(gender)")
        .eq("event_id", eventId);

      const registrations = regs || [];
      const activeUsers = registrations.filter(
        (r) => r.queue_status !== "idle"
      ).length;
      const inDates = registrations.filter(
        (r) => r.queue_status === "matched" || r.queue_status === "in_date"
      ).length;
      const inQueue = registrations.filter(
        (r) => r.queue_status === "searching"
      ).length;

      // Gender ratio
      const genderCount: Record<string, number> = { man: 0, woman: 0, "non-binary": 0 };
      registrations.forEach((r) => {
        const g = (r.profiles as any)?.gender;
        if (g && genderCount[g] !== undefined) genderCount[g]++;
      });

      // Video sessions
      const { data: sessions } = await supabase
        .from("video_sessions")
        .select("id, duration_seconds, participant_1_liked, participant_2_liked, ended_at")
        .eq("event_id", eventId);

      const allSessions = sessions || [];
      const completedSessions = allSessions.filter((s) => s.ended_at);
      const totalDates = allSessions.length;

      // Mutual vibes (both liked)
      const mutualVibes = completedSessions.filter(
        (s) => s.participant_1_liked && s.participant_2_liked
      ).length;
      const matchRate =
        completedSessions.length > 0
          ? Math.round((mutualVibes / completedSessions.length) * 100)
          : 0;

      // Extension rate (dates > 60s)
      const extended = completedSessions.filter(
        (s) => s.duration_seconds && s.duration_seconds > 60
      ).length;
      const extensionRate =
        completedSessions.length > 0
          ? Math.round((extended / completedSessions.length) * 100)
          : 0;

      // Avg duration
      const avgDuration =
        completedSessions.length > 0
          ? Math.round(
              completedSessions.reduce(
                (sum, s) => sum + (s.duration_seconds || 0),
                0
              ) / completedSessions.length
            )
          : 0;

      // Persistent matches from this event
      const { count: persistentMatches } = await supabase
        .from("matches")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId);

      // Reports for this event (from sessions in this event)
      const sessionIds = allSessions.map((s) => s.id);
      let reportsCount = 0;
      if (sessionIds.length > 0) {
        // Reports filed during event timeframe
        const { count } = await supabase
          .from("user_reports")
          .select("*", { count: "exact", head: true });
        reportsCount = count || 0;
      }

      return {
        activeUsers,
        inDates,
        inQueue,
        totalDates,
        matchRate,
        extensionRate,
        avgDuration,
        genderCount,
        persistentMatches: persistentMatches || 0,
        reportsCount,
        totalAttendees: registrations.length,
      };
    },
    enabled: !!eventId,
    refetchInterval: 10000,
  });

  // Post-event metrics
  const { data: postMetrics } = useQuery({
    queryKey: ["admin-post-event-metrics", eventId],
    queryFn: async () => {
      if (!eventId) return null;

      // Date feedback
      const { data: sessions } = await supabase
        .from("video_sessions")
        .select("id")
        .eq("event_id", eventId);

      if (!sessions?.length) return null;

      const sessionIds = sessions.map((s) => s.id);

      const { data: feedback } = await supabase
        .from("date_feedback")
        .select("tag_chemistry, tag_fun, tag_smart, tag_respectful, conversation_flow, photo_accurate")
        .in("session_id", sessionIds);

      if (!feedback?.length) return null;

      const tagCounts = {
        chemistry: feedback.filter((f) => f.tag_chemistry).length,
        fun: feedback.filter((f) => f.tag_fun).length,
        smart: feedback.filter((f) => f.tag_smart).length,
        respectful: feedback.filter((f) => f.tag_respectful).length,
      };

      const flowCounts = {
        natural: feedback.filter((f) => f.conversation_flow === "natural").length,
        effort: feedback.filter((f) => f.conversation_flow === "effort").length,
        one_sided: feedback.filter((f) => f.conversation_flow === "one_sided").length,
      };
      const totalFlow = flowCounts.natural + flowCounts.effort + flowCounts.one_sided;

      const photoYes = feedback.filter((f) => f.photo_accurate === "yes").length;
      const photoTotal = feedback.filter((f) => f.photo_accurate).length;
      const photoAccuracyRate = photoTotal > 0 ? Math.round((photoYes / photoTotal) * 100) : 0;

      return { tagCounts, flowCounts, totalFlow, photoAccuracyRate };
    },
    enabled: !!eventId,
  });

  const genderData = metrics
    ? [
        { name: "Men", value: metrics.genderCount.man },
        { name: "Women", value: metrics.genderCount.woman },
        { name: "Non-binary", value: metrics.genderCount["non-binary"] },
      ].filter((d) => d.value > 0)
    : [];

  const tagPieData = postMetrics
    ? [
        { name: "🔥 Chemistry", value: postMetrics.tagCounts.chemistry },
        { name: "🎉 Fun", value: postMetrics.tagCounts.fun },
        { name: "🧠 Smart", value: postMetrics.tagCounts.smart },
        { name: "🤝 Respectful", value: postMetrics.tagCounts.respectful },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Event Selector */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-foreground">Select Event:</span>
          <Select value={eventId} onValueChange={setSelectedEventId}>
            <SelectTrigger className="w-full max-w-sm bg-secondary/50">
              <SelectValue placeholder="Choose an event" />
            </SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {metrics && (
        <>
          {/* Live Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <MetricCard icon={Users} label="Active Users" value={metrics.activeUsers} color="bg-pink-500/20 text-pink-400" />
            <MetricCard icon={Video} label="Currently in Dates" value={metrics.inDates} color="bg-purple-500/20 text-purple-400" />
            <MetricCard icon={Search} label="In Queue / Browsing" value={metrics.inQueue} color="bg-cyan-500/20 text-cyan-400" />
            <MetricCard icon={Activity} label="Total Dates" value={metrics.totalDates} color="bg-orange-500/20 text-orange-400" />
            <MetricCard icon={TrendingUp} label="Match Rate" value={`${metrics.matchRate}%`} color="bg-green-500/20 text-green-400" />
            <MetricCard icon={Clock} label="Extension Rate" value={`${metrics.extensionRate}%`} color="bg-blue-500/20 text-blue-400" />
            <MetricCard icon={Clock} label="Avg Duration" value={`${metrics.avgDuration}s`} color="bg-indigo-500/20 text-indigo-400" />
            <MetricCard icon={Heart} label="Persistent Matches" value={metrics.persistentMatches} color="bg-rose-500/20 text-rose-400" />
            <MetricCard icon={Users} label="Total Attendees" value={metrics.totalAttendees} color="bg-teal-500/20 text-teal-400" />
            <MetricCard
              icon={AlertTriangle}
              label="Reports"
              value={metrics.reportsCount}
              color="bg-red-500/20 text-red-400"
              warning={metrics.reportsCount > 0}
            />
          </div>

          {/* Gender Ratio */}
          {genderData.length > 0 && (
            <div className="glass-card p-6 rounded-2xl">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-primary" />
                Gender Ratio
              </h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={genderData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {genderData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1f2937",
                        border: "1px solid #374151",
                        borderRadius: "12px",
                        color: "#f9fafb",
                      }}
                    />
                    <Legend />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {/* Post-Event Metrics */}
      {postMetrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tag Distribution */}
          {tagPieData.length > 0 && (
            <div className="glass-card p-6 rounded-2xl">
              <h3 className="font-semibold text-foreground mb-4">Likability Tag Distribution</h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={tagPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {tagPieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1f2937",
                        border: "1px solid #374151",
                        borderRadius: "12px",
                        color: "#f9fafb",
                      }}
                    />
                    <Legend />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Conversation Flow & Photo Accuracy */}
          <div className="glass-card p-6 rounded-2xl space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-3">Conversation Flow</h3>
              {postMetrics.totalFlow > 0 ? (
                <div className="space-y-2">
                  {[
                    { label: "Natural", value: postMetrics.flowCounts.natural, color: "bg-green-500" },
                    { label: "Took Effort", value: postMetrics.flowCounts.effort, color: "bg-yellow-500" },
                    { label: "One-sided", value: postMetrics.flowCounts.one_sided, color: "bg-red-500" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground w-24">{item.label}</span>
                      <div className="flex-1 h-2 bg-secondary/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full`}
                          style={{
                            width: `${Math.round((item.value / postMetrics.totalFlow) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {Math.round((item.value / postMetrics.totalFlow) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">Photo Accuracy Rate</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-3 bg-secondary/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${postMetrics.photoAccuracyRate}%` }}
                  />
                </div>
                <span className="text-lg font-bold text-foreground">
                  {postMetrics.photoAccuracyRate}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!metrics && !events.length && (
        <div className="glass-card p-12 rounded-2xl text-center text-muted-foreground">
          No events found
        </div>
      )}
    </motion.div>
  );
};

export default AdminLiveEventMetrics;
