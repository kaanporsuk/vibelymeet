import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY } from "@/hooks/useAdminEngagementAnalytics";
import { ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY } from "@/hooks/useAdminOverviewDashboard";

export const ADMIN_DASHBOARD_BADGE_COUNTS_QUERY_KEY = ["admin-dashboard-badge-counts"] as const;

export type AdminInvalidationArea =
  | "overview"
  | "engagement"
  | "badges"
  | "users"
  | "deletions"
  | "events"
  | "reports"
  | "notifications"
  | "support"
  | "photoVerification";

const ADMIN_INVALIDATION_QUERY_KEYS: Record<AdminInvalidationArea, readonly QueryKey[]> = {
  overview: [ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY],
  engagement: [ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY],
  badges: [ADMIN_DASHBOARD_BADGE_COUNTS_QUERY_KEY],
  users: [["admin-users"], ["admin-user-detail"]],
  deletions: [["admin-account-deletions"]],
  events: [["admin-events"]],
  reports: [["admin-reports"], ["admin-reports-summary"]],
  notifications: [["admin-notifications"], ADMIN_DASHBOARD_BADGE_COUNTS_QUERY_KEY],
  support: [["admin-support-tickets"], ["admin-support-thread"], ADMIN_DASHBOARD_BADGE_COUNTS_QUERY_KEY],
  photoVerification: [["admin-photo-verifications"], ["admin-verification-stats"]],
};

export function invalidateAdminQueries(
  queryClient: QueryClient,
  areas: readonly AdminInvalidationArea[],
): Promise<void> {
  const seen = new Set<string>();
  const invalidations: Array<Promise<unknown>> = [];

  for (const area of areas) {
    for (const queryKey of ADMIN_INVALIDATION_QUERY_KEYS[area]) {
      const key = JSON.stringify(queryKey);
      if (seen.has(key)) continue;
      seen.add(key);
      invalidations.push(queryClient.invalidateQueries({ queryKey }));
    }
  }

  return Promise.all(invalidations).then(() => undefined);
}
