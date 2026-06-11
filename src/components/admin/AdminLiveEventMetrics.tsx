import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  Video,
  Search,
  Activity,
  TrendingUp,
  Heart,
  HandMetal,
  MessageSquare,
  AlertTriangle,
  Clock,
  GitBranch,
  PieChart,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
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
import { useNavigate } from "react-router-dom";
import { resolveEventLifecycle } from "@/lib/eventLifecycle";
import { formatAdminUtcDateTime, formatAdminUtcTime } from "@/lib/adminTime";
import { resolveAdminErrorMessage, resolveAdminFunctionErrorMessage } from "@/lib/adminErrorResolver";

const COLORS = ["#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#22c55e"];

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  description?: string;
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
  admission_status?: string | null;
  queue_id?: string | null;
  error_reason?: string | null;
}

interface EventPaymentExceptionItem {
  id: string;
  profile_ref: boolean;
  support_ticket_ref: boolean;
  checkout_session_ref: boolean;
  exception_type: string;
  exception_status: string;
  created_at: string;
  updated_at: string;
}

interface AdminEventAnalyticsOptionsPayload extends AdminRpcPayload {
  events?: AdminEventSelectorItem[];
  total_count?: number;
}

interface AdminEventLifecycleFeedPayload extends AdminRpcPayload {
  event_id?: string;
  sources?: LifecycleSourceStatus[];
  items?: LifecycleFeedItem[];
  payment_exceptions?: EventPaymentExceptionItem[];
  payment_exception_status_counts?: Record<string, number>;
}

interface AdminEventLiveAnalyticsPayload extends AdminRpcPayload {
  event_id?: string;
  active_users?: number;
  browsing?: number;
  in_ready_gate?: number;
  in_dates?: number;
  in_survey?: number;
  in_queue?: number;
  match_rate?: number;
  extension_rate?: number;
  avg_duration_seconds?: number;
  gender_count?: Record<string, number>;
  video_sessions?: number;
  completed_video_sessions?: number;
  registrations?: number;
  confirmed_registrations?: number;
  waitlisted_registrations?: number;
  confirmed_attendance?: number;
  attendance_marked_count?: number;
  no_show_count?: number;
  persistent_matches?: number;
  participant_reports_near_event_window?: number;
  report_scope?: string;
}

interface AdminEventLiveMetrics {
  activeUsers: number;
  browsing: number;
  inReadyGate: number;
  inDates: number;
  inSurvey: number;
  inQueue: number;
  matchRate: number;
  extensionRate: number;
  avgDuration: number;
  genderCount: Record<string, number>;
  persistentMatches: number;
  reportsCount: number;
  reportScope: string;
  totalDates: number;
  completedDates: number;
  totalRegistrations: number;
  confirmedRegistrations: number;
  waitlistedRegistrations: number;
  confirmedAttendance: number;
  attendanceMarkedCount: number;
  noShowCount: number;
}

interface AdminEventPostMetrics {
  tagCounts: {
    chemistry: number;
    fun: number;
    smart: number;
    respectful: number;
  };
  flowCounts: {
    natural: number;
    effort: number;
    one_sided: number;
  };
  totalFlow: number;
  photoAccuracyRate: number;
}

interface AdminEventPostAnalyticsPayload extends AdminRpcPayload {
  event_id?: string;
  post_metrics_status?: "ok" | "empty" | "unavailable";
  post_metrics?: {
    tag_counts?: Partial<AdminEventPostMetrics["tagCounts"]>;
    flow_counts?: Partial<AdminEventPostMetrics["flowCounts"]>;
    total_flow?: number;
    photo_accuracy_rate?: number;
  } | null;
}

type VideoDateOpsStatus = "healthy" | "warning" | "critical" | "unknown" | "external_only";

type VideoDateOpsLatencySummary = {
  sample_count: number;
  raw_sample_count?: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
};

type VideoDateOpsSegmentSummary = VideoDateOpsLatencySummary & {
  key: string;
  label: string;
};

type VideoDateOpsCohortSummary = VideoDateOpsSegmentSummary & {
  dimensions: Record<string, string>;
};

interface AdminVideoDateOpsResponse {
  ok: boolean;
  error?: string;
  generated_at?: string;
  event_id?: string | null;
  windows?: VideoDateOpsWindow[];
}

interface VideoDateOpsWindow {
  id: "24h" | "7d";
  label: string;
  hours: number;
  since: string;
  ready_tap_to_first_remote_frame_latency: {
    sample_count: number;
    raw_sample_count?: number;
    p50_ms: number | null;
    p95_ms: number | null;
    max_ms: number | null;
    segment_breakdown?: VideoDateOpsSegmentSummary[];
    cohort_breakdown?: VideoDateOpsCohortSummary[];
    slowest_sessions?: Array<{
      session_id: string | null;
      actor_id: string | null;
      event_id: string | null;
      occurred_at: string | null;
      latency_ms: number | null;
      platform: string;
      daily_prewarm: string;
      timeline_error?: string;
      timeline_rows?: Array<{
        timeline_seq: number;
        occurred_at: string;
        source: string;
        operation: string;
        outcome: string;
        reason_code: string | null;
      }>;
    }>;
    status: VideoDateOpsStatus;
    source_error?: string;
    truncated?: boolean;
  };
  ready_gate_open_to_date_join_latency: {
    sample_count: number;
    p50_ms: number | null;
    p95_ms: number | null;
    max_ms: number | null;
    status: VideoDateOpsStatus;
    source_error?: string;
    truncated?: boolean;
  };
  simultaneous_swipe_recovery: {
    total_swipe_rows: number;
    collision_rows: number;
    recovered_rows: number;
    unrecovered_rows: number;
    collision_rate: number | null;
    recovery_rate: number | null;
    collision_status: VideoDateOpsStatus;
    recovery_status: VideoDateOpsStatus;
    source_error?: string;
    truncated?: boolean;
  };
  daily_performance_decision: {
    first_frame_sample_count: number;
    first_frame_p95_ms: number | null;
    first_frame_p99_ms: number | null;
    room_sample_count: number;
    room_p95_ms: number | null;
    room_p99_ms: number | null;
    token_sample_count: number;
    token_p95_ms: number | null;
    token_p99_ms: number | null;
    join_sample_count: number;
    join_p95_ms: number | null;
    join_p99_ms: number | null;
    reconnect_sample_count: number;
    reconnect_p95_ms: number | null;
    extension_refresh_sample_count: number;
    extension_refresh_p95_ms: number | null;
    room_pool_recommended: boolean;
    decision_reason: string;
    decision_status: VideoDateOpsStatus;
    source_error?: string;
    truncated?: boolean;
  };
  daily_performance_emission_health?: {
    missing_for_rollout_gate_count: number;
    segments: Array<{
      segment_key: string | null;
      segment_label: string | null;
      sample_count: number | null;
      minimum_samples: number | null;
      emission_status: string | null;
      last_sample_at: string | null;
      missing_for_rollout_gate: boolean | null;
    }>;
    status: VideoDateOpsStatus;
    source_error?: string;
    truncated?: boolean;
  };
  timer_drift_recovered_by_server_truth: {
    status: VideoDateOpsStatus;
    source: "posthog";
    event_name: string;
    count: null;
    rate: null;
    note: string;
  };
}

type AdminEventSelectorItem = {
  id: string;
  title: string;
  event_date: string | null;
  duration_minutes: number | null;
  status: string | null;
  ended_at?: string | null;
  archived_at?: string | null;
};

const computeEventPhase = (event: AdminEventSelectorItem | null | undefined) => {
  if (!event) return { label: "unknown", tone: "unknown" as const, endIso: null as string | null };

  const status = (event.status || "unknown").toLowerCase();
  const lifecycle = resolveEventLifecycle({
    status: event.status,
    event_date: event.event_date,
    duration_minutes: event.duration_minutes,
    ended_at: event.ended_at,
    archived_at: event.archived_at,
  });
  const endIso = lifecycle.scheduledEndAt?.toISOString() ?? null;

  if (event.archived_at || status === "archived") return { label: "archived", tone: "ended" as const, endIso };
  if (status === "cancelled") return { label: "cancelled", tone: "ended" as const, endIso };
  if (lifecycle.isFinalized) return { label: "finalized", tone: "ended" as const, endIso };
  if (lifecycle.needsFinalizationRepair) return { label: "needs repair", tone: "warning" as const, endIso };
  if (lifecycle.isInFinalizationGrace) return { label: "wrap-up grace", tone: "warning" as const, endIso };
  if (status === "draft") return { label: "draft", tone: "unknown" as const, endIso };
  if (!lifecycle.startsAt || !lifecycle.scheduledEndAt) {
    return { label: status, tone: "unknown" as const, endIso };
  }
  if (lifecycle.lifecycle === "upcoming") return { label: "upcoming", tone: "upcoming" as const, endIso };
  if (lifecycle.lifecycle === "live") return { label: "live by time", tone: "live" as const, endIso };
  return { label: "ended by time", tone: "ended" as const, endIso };
};

const formatRate = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : "n/a";

const formatMs = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
};

const statusBadgeClass = (status: VideoDateOpsStatus): string => {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "warning":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "critical":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "external_only":
      return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
    default:
      return "bg-secondary text-muted-foreground border-white/10";
  }
};

const VideoDateOpsTile = ({
  label,
  value,
  detail,
  status,
}: {
  label: string;
  value: string;
  detail: string;
  status: VideoDateOpsStatus;
}) => (
  <div className="rounded-xl border border-white/10 bg-secondary/20 p-3">
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge className={statusBadgeClass(status)}>{status.replace("_", " ")}</Badge>
    </div>
    <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{detail}</div>
  </div>
);

const MetricCard = ({ icon: Icon, label, value, color, description, warning }: MetricCardProps) => (
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
    {description && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{description}</p>}
  </div>
);

const AdminLiveEventMetrics = () => {
  const navigate = useNavigate();
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const openVideoDateTimeline = (sessionId: string) => {
    navigate(`/kaan/dashboard?panel=video-date-timeline&session_id=${encodeURIComponent(sessionId)}`);
  };

  // Fetch selector options through the backend read model.
  const {
    data: events = [],
    error: eventsError,
    isLoading: eventsLoading,
  } = useQuery({
    queryKey: ["admin-events-list"],
    queryFn: async () => {
      const payload = await callAdminRpc<AdminEventAnalyticsOptionsPayload>("admin_list_event_analytics_options", {
        p_limit: 50,
        p_include_archived: true,
      });
      return Array.isArray(payload.events) ? payload.events : [];
    },
  });

  const selectedEvent =
    (selectedEventId ? events.find((event) => event.id === selectedEventId) : undefined) ??
    events[0] ??
    null;
  const eventId = selectedEvent?.id ?? "";
  const selectedEventPhase = computeEventPhase(selectedEvent);

  // Live metrics — poll every 10s
  const {
    data: metrics,
    error: metricsError,
    isLoading: metricsLoading,
  } = useQuery({
    queryKey: ["admin-live-metrics", eventId],
    queryFn: async () => {
      if (!eventId) return null;

      const payload = await callAdminRpc<AdminEventLiveAnalyticsPayload>("admin_get_event_live_analytics", {
        p_event_id: eventId,
      });

      const genderCount = {
        man: Number(payload.gender_count?.man ?? 0),
        woman: Number(payload.gender_count?.woman ?? 0),
        "non-binary": Number(payload.gender_count?.["non-binary"] ?? 0),
      };

      return {
        activeUsers: Number(payload.active_users ?? 0),
        browsing: Number(payload.browsing ?? 0),
        inReadyGate: Number(payload.in_ready_gate ?? 0),
        inDates: Number(payload.in_dates ?? 0),
        inSurvey: Number(payload.in_survey ?? 0),
        inQueue: Number(payload.in_queue ?? 0),
        matchRate: Number(payload.match_rate ?? 0),
        extensionRate: Number(payload.extension_rate ?? 0),
        avgDuration: Number(payload.avg_duration_seconds ?? 0),
        genderCount,
        persistentMatches: Number(payload.persistent_matches ?? 0),
        reportsCount: Number(payload.participant_reports_near_event_window ?? 0),
        reportScope: payload.report_scope ?? "participant_reports_near_event_window",
        totalDates: Number(payload.video_sessions ?? 0),
        completedDates: Number(payload.completed_video_sessions ?? 0),
        totalRegistrations: Number(payload.registrations ?? 0),
        confirmedRegistrations: Number(payload.confirmed_registrations ?? 0),
        waitlistedRegistrations: Number(payload.waitlisted_registrations ?? 0),
        confirmedAttendance: Number(payload.confirmed_attendance ?? 0),
        attendanceMarkedCount: Number(payload.attendance_marked_count ?? 0),
        noShowCount: Number(payload.no_show_count ?? 0),
      } satisfies AdminEventLiveMetrics;
    },
    enabled: !!eventId,
    refetchInterval: 10000,
  });

  // Post-event metrics
  const { data: postMetrics, error: postMetricsError } = useQuery({
    queryKey: ["admin-post-event-metrics", eventId],
    queryFn: async () => {
      if (!eventId) return null;

      const payload = await callAdminRpc<AdminEventPostAnalyticsPayload>("admin_get_event_post_analytics", {
        p_event_id: eventId,
      });

      if (!payload.post_metrics) return null;

      const tagCounts = {
        chemistry: Number(payload.post_metrics.tag_counts?.chemistry ?? 0),
        fun: Number(payload.post_metrics.tag_counts?.fun ?? 0),
        smart: Number(payload.post_metrics.tag_counts?.smart ?? 0),
        respectful: Number(payload.post_metrics.tag_counts?.respectful ?? 0),
      };

      const flowCounts = {
        natural: Number(payload.post_metrics.flow_counts?.natural ?? 0),
        effort: Number(payload.post_metrics.flow_counts?.effort ?? 0),
        one_sided: Number(payload.post_metrics.flow_counts?.one_sided ?? 0),
      };

      return {
        tagCounts,
        flowCounts,
        totalFlow: Number(payload.post_metrics.total_flow ?? 0),
        photoAccuracyRate: Number(payload.post_metrics.photo_accuracy_rate ?? 0),
      } satisfies AdminEventPostMetrics;
    },
    enabled: !!eventId,
  });

  const {
    data: videoDateOps,
    isLoading: videoDateOpsLoading,
    error: videoDateOpsError,
  } = useQuery({
    queryKey: ["admin-video-date-ops", eventId],
    queryFn: async () => {
      if (!eventId) return null;
      const { data, error } = await supabase.functions.invoke<AdminVideoDateOpsResponse>(
        "admin-video-date-ops",
        { body: { event_id: eventId } },
      );
      if (error || !data?.ok) {
        throw new Error(await resolveAdminFunctionErrorMessage(error, data, "Could not load Video Date Ops metrics"));
      }
      return data;
    },
    enabled: !!eventId,
    refetchInterval: 60_000,
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

  const { data: lifecycleFeed, error: lifecycleFeedError } = useQuery({
    queryKey: ["admin-event-lifecycle-feed", eventId],
    queryFn: async () => {
      if (!eventId) return null;

      const payload = await callAdminRpc<AdminEventLifecycleFeedPayload>("admin_get_event_lifecycle_feed", {
        p_event_id: eventId,
      });

      return {
        sources: Array.isArray(payload.sources) ? payload.sources : [],
        items: Array.isArray(payload.items) ? payload.items : [],
        paymentExceptions: Array.isArray(payload.payment_exceptions) ? payload.payment_exceptions : [],
        paymentExceptionStatusCounts:
          payload.payment_exception_status_counts && typeof payload.payment_exception_status_counts === "object"
            ? payload.payment_exception_status_counts
            : {},
      };
    },
    enabled: !!eventId,
    refetchInterval: 15000,
  });

  const paymentExceptions = lifecycleFeed?.paymentExceptions ?? [];
  const paymentExceptionStatusCounts = lifecycleFeed?.paymentExceptionStatusCounts ?? {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Event Selector */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex flex-wrap items-center gap-4">
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
          {selectedEvent && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge className="bg-secondary text-muted-foreground border-white/10">
                DB status: {selectedEvent.status || "unknown"}
              </Badge>
              <Badge
                className={
                  selectedEventPhase.tone === "live"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : selectedEventPhase.tone === "upcoming"
                      ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                      : selectedEventPhase.tone === "ended" || selectedEventPhase.tone === "warning"
                        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        : "bg-secondary text-muted-foreground border-white/10"
                }
              >
                computed: {selectedEventPhase.label}
              </Badge>
              {selectedEventPhase.endIso && (
                <span>window end {formatAdminUtcDateTime(selectedEventPhase.endIso)}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {eventsError && (
        <div className="glass-card p-6 rounded-2xl">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
            Unable to load the Event Analytics event selector.
            <span className="mt-1 block text-xs">
              {resolveAdminErrorMessage(eventsError, "Could not load event metrics")}
            </span>
          </div>
        </div>
      )}

      {eventsLoading && !events.length && (
        <div className="glass-card p-6 rounded-2xl text-sm text-muted-foreground">
          Loading events...
        </div>
      )}

      {metricsError && (
        <div className="glass-card p-6 rounded-2xl">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
            Unable to load Event Analytics metrics for the selected event.
            <span className="mt-1 block text-xs">
              {resolveAdminErrorMessage(metricsError, "Could not load live event metrics")}
            </span>
          </div>
        </div>
      )}

      {metricsLoading && eventId && !metrics && !metricsError && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="h-28 rounded-2xl bg-secondary/50 animate-pulse" />
          ))}
        </div>
      )}

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
            <MetricCard
              icon={Users}
              label="Registrations"
              value={metrics.totalRegistrations}
              color="bg-teal-500/20 text-teal-400"
              description={`${metrics.confirmedRegistrations} confirmed, ${metrics.waitlistedRegistrations} waitlisted; ${metrics.confirmedAttendance} attended, ${metrics.attendanceMarkedCount} reviewed, ${metrics.noShowCount} no-show.`}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Participant Reports"
              value={metrics.reportsCount}
              color="bg-red-500/20 text-red-400"
              description="Participant reports near this event window; not direct event-report provenance."
              warning={metrics.reportsCount > 0}
            />
          </div>

          {/* Video Date Ops */}
          <div className="glass-card p-6 rounded-2xl space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Video Date Ops
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Service-role aggregate health for first-frame latency, Daily performance, room-pool decisioning, Ready Gate, swipe recovery, fairness, and timer drift.
                </p>
              </div>
              {videoDateOps?.generated_at && (
                <Badge className="bg-secondary text-muted-foreground border-white/10">
                  updated {formatAdminUtcTime(videoDateOps.generated_at)}
                </Badge>
              )}
            </div>

            {videoDateOpsLoading && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {["24h", "7d"].map((window) => (
                  <div key={window} className="rounded-xl border border-white/10 bg-secondary/20 p-4 space-y-3">
                    <div className="h-4 w-24 rounded bg-secondary/60 animate-pulse" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="h-24 rounded-xl bg-secondary/50 animate-pulse" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {videoDateOpsError && !videoDateOpsLoading && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
                Video Date Ops metrics are unavailable:{" "}
                {resolveAdminErrorMessage(videoDateOpsError, "Could not load Video Date Ops metrics")}
              </div>
            )}

            {videoDateOps?.windows && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {videoDateOps.windows.map((window) => {
                  const readyTapToFrame = window.ready_tap_to_first_remote_frame_latency;
                  const latency = window.ready_gate_open_to_date_join_latency;
                  const swipe = window.simultaneous_swipe_recovery;
                  const dailyDecision = window.daily_performance_decision;
                  const dailyEmission = window.daily_performance_emission_health;
                  const timer = window.timer_drift_recovered_by_server_truth;
                  const truncated = [
                    readyTapToFrame.truncated,
                    latency.truncated,
                    swipe.truncated,
                    dailyDecision?.truncated,
                    dailyEmission?.truncated,
                  ].some(Boolean);
                  const rawFirstFrameCount = readyTapToFrame.raw_sample_count ?? readyTapToFrame.sample_count;
                  const firstFrameSampleText =
                    rawFirstFrameCount > readyTapToFrame.sample_count
                      ? `${readyTapToFrame.sample_count} deduped first-frame samples (${rawFirstFrameCount} raw)`
                      : `${readyTapToFrame.sample_count} first-frame samples`;
                  const dailyPoolDetail = dailyDecision?.source_error
                    || `${dailyDecision?.decision_reason ?? "unknown"}; frame ${formatMs(dailyDecision?.first_frame_p95_ms)} p95 / ${formatMs(dailyDecision?.first_frame_p99_ms)} p99 (${dailyDecision?.first_frame_sample_count ?? 0} samples), room ${formatMs(dailyDecision?.room_p95_ms)} p95 / ${formatMs(dailyDecision?.room_p99_ms)} p99`;
                  const dailyEmissionDetail = dailyEmission?.source_error || (
                    dailyEmission?.segments?.length
                      ? dailyEmission.segments.map((segment) => (
                          `${segment.segment_label ?? segment.segment_key ?? "segment"}: ${segment.emission_status ?? "unknown"} (${segment.sample_count ?? 0}/${segment.minimum_samples ?? 0})`
                        )).join("; ")
                      : "No Daily join / first-frame emission rows returned"
                  );

                  return (
                    <div key={window.id} className="rounded-xl border border-white/10 bg-secondary/10 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">{window.label} window</h4>
                          <p className="text-[11px] text-muted-foreground">
                            since {formatAdminUtcDateTime(window.since)}
                          </p>
                        </div>
                        {truncated && (
                          <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                            capped sample
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <VideoDateOpsTile
                          label="Ready tap -> frame"
                          value={`${formatMs(readyTapToFrame.p95_ms)} p95`}
                          detail={
                            readyTapToFrame.source_error ||
                            `${firstFrameSampleText}, ${formatMs(readyTapToFrame.p50_ms)} p50`
                          }
                          status={readyTapToFrame.status}
                        />
                        <VideoDateOpsTile
                          label="Ready Gate -> join"
                          value={`${formatMs(latency.p95_ms)} p95`}
                          detail={
                            latency.source_error ||
                            `${latency.sample_count} joined sessions, ${formatMs(latency.p50_ms)} p50`
                          }
                          status={latency.status}
                        />
                        <VideoDateOpsTile
                          label="Swipe recovery"
                          value={formatRate(swipe.recovery_rate)}
                          detail={
                            swipe.source_error ||
                            `${swipe.recovered_rows}/${swipe.collision_rows} collisions recovered, ${formatRate(swipe.collision_rate)} collision rate`
                          }
                          status={swipe.recovery_status}
                        />
                        <VideoDateOpsTile
                          label="Daily pool decision"
                          value={dailyDecision?.room_pool_recommended ? "Evaluate pool" : "No pool"}
                          detail={dailyPoolDetail}
                          status={dailyDecision?.decision_status ?? "unknown"}
                        />
                        <VideoDateOpsTile
                          label="Daily emitters"
                          value={`${dailyEmission?.missing_for_rollout_gate_count ?? 0} dark`}
                          detail={dailyEmissionDetail}
                          status={dailyEmission?.status ?? "unknown"}
                        />
                        <VideoDateOpsTile
                          label="Timer drift recovered"
                          value="PostHog"
                          detail={`${timer.event_name}. ${timer.note}`}
                          status={timer.status}
                        />
                      </div>

                      {readyTapToFrame.segment_breakdown?.length ? (
                        <div className="rounded-xl border border-white/10 bg-secondary/10 p-3">
                          <div className="mb-2 text-xs font-medium text-foreground">Launch segments</div>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                            {readyTapToFrame.segment_breakdown.map((segment) => (
                              <div key={segment.key} className="rounded-lg bg-background/50 p-2">
                                <div>{segment.label}</div>
                                <div className="font-medium text-foreground">
                                  {formatMs(segment.p50_ms)} p50 / {formatMs(segment.p95_ms)} p95
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {readyTapToFrame.cohort_breakdown?.length ? (
                        <div className="rounded-xl border border-white/10 bg-secondary/10 p-3">
                          <div className="mb-2 text-xs font-medium text-foreground">Slow cohorts</div>
                          <div className="space-y-2 text-[11px] text-muted-foreground">
                            {readyTapToFrame.cohort_breakdown.slice(0, 4).map((cohort) => (
                              <div key={cohort.key} className="rounded-lg bg-background/50 p-2">
                                <div className="font-medium text-foreground">
                                  {formatMs(cohort.p95_ms)} p95, {cohort.sample_count} samples
                                </div>
                                <div>
                                  {Object.entries(cohort.dimensions)
                                    .map(([key, value]) => `${key}: ${value}`)
                                    .join(" / ")}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {readyTapToFrame.slowest_sessions?.length ? (
                        <div className="rounded-xl border border-white/10 bg-secondary/10 p-3">
                          <div className="mb-2 text-xs font-medium text-foreground">Slowest sessions</div>
                          <div className="space-y-2 text-[11px] text-muted-foreground">
                            {readyTapToFrame.slowest_sessions.slice(0, 5).map((session, index) => {
                              const sessionId = session.session_id;
                              return (
                                <div
                                  key={`${sessionId}:${session.actor_id}:${session.occurred_at}:${index}`}
                                  className="rounded-lg bg-background/50 p-2"
                                >
                                  <div className="font-medium text-foreground">
                                    {formatMs(session.latency_ms)} / {session.platform} / prewarm {session.daily_prewarm}
                                  </div>
                                  <div>session: {sessionId ? "linked" : "-"}</div>
                                  <div>
                                    {(session.timeline_rows ?? []).slice(-4).map((row) => row.reason_code ?? row.operation).join(" -> ") ||
                                      session.timeline_error ||
                                      "timeline unavailable"}
                                  </div>
                                  {sessionId && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="mt-2 h-7 gap-1.5 px-2 text-[11px]"
                                      onClick={() => openVideoDateTimeline(sessionId)}
                                    >
                                      <GitBranch className="h-3.5 w-3.5" />
                                      Open timeline
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Gender Ratio */}
          {genderData.length > 0 && (
            <div className="glass-card p-6 rounded-2xl">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-primary" />
                Gender Ratio
              </h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={genderData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={82}
                      dataKey="value"
                      nameKey="name"
                      isAnimationActive={false}
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
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                {genderData.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span>{entry.name}</span>
                    <span className="font-medium text-foreground">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event Lifecycle Ops Feed */}
          {lifecycleFeedError && (
            <div className="glass-card p-6 rounded-2xl space-y-2">
              <h3 className="font-semibold text-foreground">Event Lifecycle Ops Feed</h3>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
                Backend lifecycle read model unavailable.
                <span className="mt-1 block text-xs">
                  {resolveAdminErrorMessage(lifecycleFeedError, "Could not load lifecycle feed")}
                </span>
              </div>
            </div>
          )}

          {lifecycleFeed && (
            <div className="glass-card p-6 rounded-2xl space-y-4">
              <div>
                <h3 className="font-semibold text-foreground">Event Lifecycle Ops Feed</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Backend event-scoped queue/log visibility. Sources marked unavailable could not be read by the admin read model.
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
                      <span className="text-[11px] text-muted-foreground">{formatAdminUtcDateTime(item.timestamp)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                      <span>session: {item.session_id ? "linked" : "-"}</span>
                      <span>admission_status: {item.admission_status || "-"}</span>
                      <span>queue_ref: {item.queue_id ? "present" : "-"}</span>
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
                    <span className="text-[11px] text-muted-foreground">{formatAdminUtcDateTime(item.updated_at)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                    <span>exception_ref: {item.id ? "present" : "-"}</span>
                    <span>profile_ref: {item.profile_ref ? "present" : "-"}</span>
                    <span>support_ticket: {item.support_ticket_ref ? "linked" : "-"}</span>
                    <span>checkout_session: {item.checkout_session_ref ? "linked" : "-"}</span>
                  </div>
                </div>
              )) : (
                <div className="text-sm text-muted-foreground">No payment exception cases for this event.</div>
              )}
            </div>
          </div>
        </>
      )}

      {postMetricsError && (
        <div className="glass-card p-6 rounded-2xl">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
            Post-event feedback metrics are unavailable.
            <span className="mt-1 block text-xs">
              {resolveAdminErrorMessage(postMetricsError, "Could not load post-event metrics")}
            </span>
          </div>
        </div>
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

      {!metrics && !metricsLoading && !eventsError && !events.length && (
        <div className="glass-card p-12 rounded-2xl text-center text-muted-foreground">
          No events found
        </div>
      )}
    </motion.div>
  );
};

export default AdminLiveEventMetrics;
