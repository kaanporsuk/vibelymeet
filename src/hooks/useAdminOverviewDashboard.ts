import { useQuery } from "@tanstack/react-query";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

export const ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY = ["admin-overview-dashboard"] as const;

export type AdminOverviewQuickActionEvent = {
  id: string;
  title: string;
  event_date: string;
  status: string | null;
  current_attendees: number | null;
  max_attendees: number | null;
};

export type AdminOverviewChartPoint = {
  date: string;
  day?: string;
  users?: number;
  matches?: number;
};

export type AdminOverviewEventFillRow = {
  id: string;
  title: string;
  name: string;
  attendees: number;
  capacity: number;
  fillRate: number;
  status: string | null;
  archived: boolean;
  ended: boolean;
  lifecycle_status?: string | null;
  scheduled_end_at?: string | null;
  auto_finalize_at?: string | null;
  is_finalized?: boolean;
  is_in_finalization_grace?: boolean;
  needs_finalization_repair?: boolean;
};

export type AdminOverviewGenderRow = {
  name: string;
  raw_gender: string;
  value: number;
};

export type AdminOverviewDailyDropLastRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "started" | "succeeded" | "skipped" | "failed" | "partial";
  source: "cron" | "admin" | "unknown";
  force: boolean;
  pairs_created: number;
  users_notified: number;
  unpaired_users: number | null;
  reason: string | null;
  error: string | null;
};

export type AdminOverviewDashboardPayload = AdminRpcPayload & {
  generated_at: string;
  reporting_timezone: "UTC";
  window_start_today: string;
  stats: {
    total_users: number;
    today_users: number;
    total_matches: number;
    total_messages: number;
    verified_users: number;
    matches_per_user: number;
    events: {
      total: number;
      live: number;
      upcoming: number;
      draft: number;
      cancelled: number;
      archived: number;
      ended: number;
      wrap_up_grace?: number;
      needs_finalization_repair?: number;
    };
  };
  quick_actions: {
    pending_reports_count: number;
    new_users_today_count: number;
    actionable_upcoming_events: {
      count: number;
      rows: AdminOverviewQuickActionEvent[];
    };
  };
  daily_drop: {
    today_pairs: number;
    today_date_utc: string;
    last_generated_at: string | null;
    last_run: AdminOverviewDailyDropLastRun | null;
  };
  charts: {
    user_growth_30d: AdminOverviewChartPoint[];
    match_trends_30d: AdminOverviewChartPoint[];
    latest_event_fill_rows: AdminOverviewEventFillRow[];
    gender_distribution: AdminOverviewGenderRow[];
  };
  data_hygiene: {
    possible_test_event_rows: number;
  };
};

export function useAdminOverviewDashboard() {
  return useQuery<AdminOverviewDashboardPayload, Error>({
    queryKey: ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY,
    queryFn: () =>
      callAdminRpc<AdminOverviewDashboardPayload>("admin_get_overview_dashboard", {}),
    refetchInterval: 30000,
  });
}

export function formatAdminUtcDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date) + " UTC";
}

export function formatAdminCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString();
}
