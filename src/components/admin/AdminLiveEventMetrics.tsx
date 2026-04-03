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

interface LifecycleSourceStatus {
  source: string;
  status: "ok" | "unavailable";
  detail: string;
}

interface LifecycleFeedItem {
  timestamp: string;
  source: string;
  category: string;
  result: string;
  event_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  admission_status?: string | null;
  queue_id?: string | null;
  error_reason?: string | null;
}

interface EventPaymentExceptionItem {
  id: string;
  profile_id: string;
  support_ticket_id: string | null;
  checkout_session_id: string | null;
  exception_type: string;
  exception_status: string;
  created_at: string;
  updated_at: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

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
        (r) => r.queue_status && !["idle", "offline", "completed"].includes(r.queue_status)
      ).length;
      const browsing = registrations.filter(
        (r) => r.queue_status === "browsing"
      ).length;
      const inReadyGate = registrations.filter(
        (r) => r.queue_status === "in_ready_gate"
      ).length;
      const inDates = registrations.filter(
        (r) => ["in_handshake", "in_date"].includes(r.queue_status || "")
      ).length;
      const inSurvey = registrations.filter(
        (r) => r.queue_status === "in_survey"
      ).length;
      const inQueue = registrations.filter(
        (r) => r.queue_status === "searching"
      ).length;

      // Gender ratio
      const genderCount: Record<string, number> = { man: 0, woman: 0, "non-binary": 0 };
      registrations.forEach((r) => {
        const profile = r.profiles as { gender?: string } | null;
        const g = profile?.gender;
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
        browsing,
        inReadyGate,
        inDates,
        inSurvey,
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

  const { data: lifecycleFeed } = useQuery({
    queryKey: ["admin-event-lifecycle-feed", eventId],
    queryFn: async () => {
      if (!eventId) return null;

      const sources: LifecycleSourceStatus[] = [];
      const items: LifecycleFeedItem[] = [];

      const markSource = (
        source: string,
        status: "ok" | "unavailable",
        detail: string,
      ) => {
        sources.push({ source, status, detail });
      };

      const { data: reminderQueue, error: reminderQueueError } = await supabase
        .from("event_reminder_queue")
        .select("id, profile_id, event_id, reminder_type, sent_at, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (reminderQueueError) {
        markSource("reminder_queue", "unavailable", reminderQueueError.message);
      } else {
        const rows = reminderQueue || [];
        const sentCount = rows.filter((r) => !!r.sent_at).length;
        const pendingCount = rows.length - sentCount;
        markSource("reminder_queue", "ok", `${sentCount} sent / ${pendingCount} pending`);
        rows.forEach((r) => {
          items.push({
            timestamp: r.created_at,
            source: "reminder_queue",
            category: r.reminder_type,
            result: r.sent_at ? "sent" : "pending",
            event_id: r.event_id,
            user_id: r.profile_id,
            queue_id: r.id,
          });
        });
      }

      const { data: reminderSendLog, error: reminderSendLogError } = await supabase
        .from("notification_log")
        .select("id, user_id, category, delivered, suppressed_reason, created_at, data")
        .eq("data->>event_id", eventId)
        .in("category", [
          "event_reminder",
          "event_reminder_30m",
          "event_reminder_5m",
          "event_waitlist_promoted",
          "event_cancelled",
          "event_live",
        ])
        .order("created_at", { ascending: false })
        .limit(40);

      if (reminderSendLogError) {
        markSource("notification_log", "unavailable", reminderSendLogError.message);
      } else {
        const rows = reminderSendLog || [];
        markSource("notification_log", "ok", `${rows.length} recent records`);
        rows.forEach((r) => {
          const dataObj = asRecord(r.data);
          items.push({
            timestamp: r.created_at || new Date(0).toISOString(),
            source: "notification_log",
            category: r.category,
            result: r.delivered ? "delivered" : "suppressed",
            event_id: asString(dataObj?.event_id) ?? eventId,
            session_id: asString(dataObj?.session_id) ?? asString(dataObj?.video_session_id),
            user_id: r.user_id,
            admission_status: asString(dataObj?.admission_status),
            queue_id: asString(dataObj?.queue_id),
            error_reason: r.delivered ? null : r.suppressed_reason,
          });
        });
      }

      const { data: waitlistQueue, error: waitlistQueueError } = await supabase
        .from("waitlist_promotion_notify_queue")
        .select("id, user_id, event_id, processed_at, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (waitlistQueueError) {
        markSource("waitlist_promotion_queue", "unavailable", waitlistQueueError.message);
      } else {
        const rows = waitlistQueue || [];
        const doneCount = rows.filter((r) => !!r.processed_at).length;
        markSource("waitlist_promotion_queue", "ok", `${doneCount}/${rows.length} processed`);
        rows.forEach((r) => {
          items.push({
            timestamp: r.created_at,
            source: "waitlist_promotion_queue",
            category: "event_waitlist_promoted",
            result: r.processed_at ? "processed" : "pending",
            event_id: r.event_id,
            user_id: r.user_id,
            admission_status: "promoted",
            queue_id: r.id,
          });
        });
      }

      const { data: settlements, error: settlementsError } = await supabase
        .from("stripe_event_ticket_settlements")
        .select("checkout_session_id, profile_id, event_id, outcome, result, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (settlementsError) {
        markSource("ticket_settlements", "unavailable", settlementsError.message);
      } else {
        const rows = settlements || [];
        markSource("ticket_settlements", "ok", `${rows.length} recent settlements`);
        rows.forEach((r) => {
          const resultObj = asRecord(r.result);
          items.push({
            timestamp: r.created_at,
            source: "ticket_settlements",
            category: "stripe_event_ticket_settlement",
            result: r.outcome,
            event_id: r.event_id,
            user_id: r.profile_id,
            admission_status: asString(resultObj?.admission_status),
            queue_id: r.checkout_session_id,
          });
        });
      }

      const { data: swipes, error: swipesError } = await supabase
        .from("event_swipes")
        .select("id, event_id, actor_id, target_id, swipe_type, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(40);

      if (swipesError) {
        markSource("event_swipes", "unavailable", swipesError.message);
      } else {
        const rows = swipes || [];
        markSource("event_swipes", "ok", `${rows.length} recent swipes`);
        rows.forEach((r) => {
          items.push({
            timestamp: r.created_at,
            source: "event_swipes",
            category: "swipe_action",
            result: r.swipe_type,
            event_id: r.event_id,
            user_id: r.actor_id,
            queue_id: r.id,
          });
        });
      }

      const { data: sessions, error: sessionsError } = await supabase
        .from("video_sessions")
        .select("id, event_id, participant_1_id, participant_2_id, state, ended_reason, started_at, ended_at, state_updated_at")
        .eq("event_id", eventId)
        .order("state_updated_at", { ascending: false })
        .limit(30);

      if (sessionsError) {
        markSource("video_sessions", "unavailable", sessionsError.message);
      } else {
        const rows = sessions || [];
        markSource("video_sessions", "ok", `${rows.length} recent session records`);
        rows.forEach((r) => {
          const timestamp = r.state_updated_at || r.ended_at || r.started_at;
          items.push({
            timestamp,
            source: "video_sessions",
            category: "video_date_state",
            result: r.ended_reason ? `${r.state}:${r.ended_reason}` : r.state,
            event_id: r.event_id,
            session_id: r.id,
            user_id: r.participant_1_id,
          });
        });
      }

      const { data: adminActions, error: adminActionsError } = await supabase
        .from("admin_activity_logs")
        .select("id, admin_id, action_type, target_type, target_id, created_at")
        .eq("target_type", "event")
        .eq("target_id", eventId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (adminActionsError) {
        markSource("admin_activity_logs", "unavailable", adminActionsError.message);
      } else {
        const rows = adminActions || [];
        markSource("admin_activity_logs", "ok", `${rows.length} recent admin actions`);
        rows.forEach((r) => {
          items.push({
            timestamp: r.created_at,
            source: "admin_activity_logs",
            category: r.target_type,
            result: r.action_type,
            event_id: r.target_id,
            user_id: r.admin_id,
            queue_id: r.id,
          });
        });
      }

      const sortedItems = items
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 40);

      return { sources, items: sortedItems };
    },
    enabled: !!eventId,
    refetchInterval: 15000,
  });

  const { data: paymentExceptions = [] } = useQuery({
    queryKey: ["admin-event-payment-exceptions", eventId],
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from("event_payment_exceptions")
        .select("id, profile_id, support_ticket_id, checkout_session_id, exception_type, exception_status, created_at, updated_at")
        .eq("event_id", eventId)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as EventPaymentExceptionItem[];
    },
    enabled: !!eventId,
    refetchInterval: 15000,
  });

  const paymentExceptionStatusCounts = paymentExceptions.reduce<Record<string, number>>((acc, row) => {
    acc[row.exception_status] = (acc[row.exception_status] ?? 0) + 1;
    return acc;
  }, {});

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
            <MetricCard icon={Search} label="Browsing Deck" value={metrics.browsing} color="bg-cyan-500/20 text-cyan-400" />
            <MetricCard icon={HandMetal} label="In Ready Gate" value={metrics.inReadyGate} color="bg-yellow-500/20 text-yellow-400" />
            <MetricCard icon={Video} label="In Dates" value={metrics.inDates} color="bg-purple-500/20 text-purple-400" />
            <MetricCard icon={MessageSquare} label="In Survey" value={metrics.inSurvey} color="bg-indigo-500/20 text-indigo-400" />
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

          {/* Event Lifecycle Ops Feed */}
          {lifecycleFeed && (
            <div className="glass-card p-6 rounded-2xl space-y-4">
              <div>
                <h3 className="font-semibold text-foreground">Event Lifecycle Ops Feed</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Event-scoped queue/log visibility. Sources marked unavailable are not currently queryable in this admin session.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {lifecycleFeed.sources.map((s) => (
                  <Badge
                    key={s.source}
                    className={s.status === "ok"
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-300 border-amber-500/30"}
                  >
                    {s.source}: {s.detail}
                  </Badge>
                ))}
              </div>

              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {lifecycleFeed.items.length > 0 ? lifecycleFeed.items.map((item, idx) => (
                  <div key={`${item.source}-${item.timestamp}-${idx}`} className="rounded-xl border border-white/10 bg-secondary/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-secondary text-foreground border-white/10">{item.source}</Badge>
                        <Badge className="bg-primary/15 text-primary border-primary/30">{item.category}</Badge>
                        <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30">{item.result}</Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                      <span>event_id: {item.event_id || "-"}</span>
                      <span>session_id: {item.session_id || "-"}</span>
                      <span>user_id: {item.user_id || "-"}</span>
                      <span>admission_status: {item.admission_status || "-"}</span>
                      <span>queue_id: {item.queue_id || "-"}</span>
                      <span>error_reason: {item.error_reason || "-"}</span>
                    </div>
                  </div>
                )) : (
                  <div className="text-sm text-muted-foreground">No recent lifecycle records found for this event.</div>
                )}
              </div>
            </div>
          )}

          <div className="glass-card p-6 rounded-2xl space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">Payment Exception Cases</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Manual support and refund exception state for this event. Refund handling remains external.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge className="bg-secondary text-foreground border-white/10">
                total: {paymentExceptions.length}
              </Badge>
              {Object.entries(paymentExceptionStatusCounts).map(([status, count]) => (
                <Badge key={status} className="bg-primary/15 text-primary border-primary/30">
                  {status}: {count}
                </Badge>
              ))}
            </div>

            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {paymentExceptions.length > 0 ? paymentExceptions.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-secondary/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-secondary text-foreground border-white/10">{item.exception_type}</Badge>
                      <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30">{item.exception_status}</Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{new Date(item.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                    <span>exception_id: {item.id}</span>
                    <span>profile_id: {item.profile_id}</span>
                    <span>support_ticket_id: {item.support_ticket_id || "-"}</span>
                    <span>checkout_session_id: {item.checkout_session_id || "-"}</span>
                  </div>
                </div>
              )) : (
                <div className="text-sm text-muted-foreground">No payment exception cases for this event.</div>
              )}
            </div>
          </div>
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
