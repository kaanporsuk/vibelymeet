import { lazy, Suspense, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Menu,
  LogOut,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminStaleBundleNotice from "@/components/admin/AdminStaleBundleNotice";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";
import { ADMIN_DASHBOARD_BADGE_COUNTS_QUERY_KEY } from "@/lib/adminQueryInvalidation";
import {
  formatAdminUtcDateTime,
  useAdminOverviewDashboard,
} from "@/hooks/useAdminOverviewDashboard";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
import { adminToast } from "@/lib/adminToast";

const AdminUsersPanel = lazy(() => import("@/components/admin/AdminUsersPanel"));
const AdminEventsPanel = lazy(() => import("@/components/admin/AdminEventsPanel"));
const AdminStatsCards = lazy(() => import("@/components/admin/AdminStatsCards"));
const AdminAnalyticsCharts = lazy(() => import("@/components/admin/AdminAnalyticsCharts"));
const AdminNotificationsPanel = lazy(() => import("@/components/admin/AdminNotificationsPanel"));
const AdminReportsPanel = lazy(() => import("@/components/admin/AdminReportsPanel"));
const AdminExportPanel = lazy(() => import("@/components/admin/AdminExportPanel"));
const AdminQuickActionsCards = lazy(() => import("@/components/admin/AdminQuickActionsCards"));
const AdminLiveEventMetrics = lazy(() => import("@/components/admin/AdminLiveEventMetrics"));
const AdminVideoDateTimelinePanel = lazy(() => import("@/components/admin/AdminVideoDateTimelinePanel"));
const AdminActivityLog = lazy(() => import("@/components/admin/AdminActivityLog"));
const AdminEngagementAnalytics = lazy(() => import("@/components/admin/AdminEngagementAnalytics"));
const AdminPushCampaignsPanel = lazy(() => import("@/components/admin/AdminPushCampaignsPanel"));
const AdminPhotoVerificationPanel = lazy(() => import("@/components/admin/AdminPhotoVerificationPanel"));
const AdminDeletionsPanel = lazy(() => import("@/components/admin/AdminDeletionsPanel"));
const SupportInbox = lazy(() => import("@/components/admin/SupportInbox"));
const AdminDailyDropCard = lazy(() => import("@/components/admin/AdminDailyDropCard"));
const AdminTierConfigPanel = lazy(() => import("@/components/admin/AdminTierConfigPanel"));
const AdminOperationsCenter = lazy(() => import("@/components/admin/AdminOperationsCenter"));
const AdminP4IntelligencePanel = lazy(() => import("@/components/admin/AdminP4IntelligencePanel"));
const AdminGhostBootstrapPanel = lazy(() =>
  import("@/components/admin/AdminGhostBootstrapPanel").then((mod) => ({
    default: mod.AdminGhostBootstrapPanel,
  }))
);
const AdminMediaLifecyclePanel = lazy(() => import("@/components/admin/AdminMediaLifecyclePanel"));
const AdminClientFeatureFlagsPanel = lazy(() => import("@/components/admin/AdminClientFeatureFlagsPanel"));

type ActivePanel = 'overview' | 'operations' | 'intelligence' | 'users' | 'events' | 'reports' | 'export' | 'event-analytics' | 'video-date-timeline' | 'activity-log' | 'engagement' | 'campaigns' | 'photo-verification' | 'deletions' | 'support' | 'tier-config' | 'ghost-bootstrap' | 'media-lifecycle' | 'feature-flags';

const ADMIN_PANEL_IDS = [
  'overview',
  'operations',
  'intelligence',
  'users',
  'events',
  'reports',
  'export',
  'event-analytics',
  'video-date-timeline',
  'activity-log',
  'engagement',
  'campaigns',
  'photo-verification',
  'deletions',
  'support',
  'tier-config',
  'ghost-bootstrap',
  'media-lifecycle',
  'feature-flags',
] as const satisfies readonly ActivePanel[];

const isAdminPanel = (value: string | null): value is ActivePanel =>
  typeof value === "string" && (ADMIN_PANEL_IDS as readonly string[]).includes(value);

const panelFromSearchParams = (searchParams: URLSearchParams): ActivePanel => {
  const panel = searchParams.get("panel");
  return isAdminPanel(panel) ? panel : "overview";
};

type AdminDashboardBadgeCountsPayload = AdminRpcPayload & {
  unread_notifications?: number;
  open_support_tickets?: number;
};

const AdminPanelFallback = () => (
  <div className="min-h-[320px] rounded-xl border border-border/50 bg-card/30 animate-pulse" />
);

const AdminOverviewMetadata = () => {
  const { data: overview, isError, isLoading } = useAdminOverviewDashboard();

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>Reporting timezone: UTC</span>
      <span>
        {isLoading
          ? "Refreshing Overview data..."
          : isError || !overview?.generated_at
            ? "Overview timestamp unavailable"
            : `Last updated ${formatAdminUtcDateTime(overview.generated_at)}`}
      </span>
    </div>
  );
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activePanel, setActivePanelState] = useState<ActivePanel>(() => panelFromSearchParams(searchParams));
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Enable scoped real-time updates for the visible admin surface.
  useAdminRealtime({ enabled: true, activePanel });

  const { data: badgeCounts } = useQuery({
    queryKey: ADMIN_DASHBOARD_BADGE_COUNTS_QUERY_KEY,
    queryFn: async () =>
      callAdminRpc<AdminDashboardBadgeCountsPayload>("admin_get_dashboard_badge_counts", {}),
    refetchInterval: 30000,
  });
  const unreadCount = Number(badgeCounts?.unread_notifications ?? 0);
  const supportCount = Number(badgeCounts?.open_support_tickets ?? 0);

  useEffect(() => {
    const nextPanel = panelFromSearchParams(searchParams);
    setActivePanelState((currentPanel) => (currentPanel === nextPanel ? currentPanel : nextPanel));
  }, [searchParams]);

  const setActivePanel = (panel: ActivePanel) => {
    setActivePanelState(panel);
    setSearchParams((currentSearchParams) => {
      const nextSearchParams = new URLSearchParams(currentSearchParams);
      if (panel === "overview") {
        nextSearchParams.delete("panel");
      } else {
        nextSearchParams.set("panel", panel);
      }
      if (panel !== "video-date-timeline") {
        nextSearchParams.delete("session_id");
      }
      return nextSearchParams;
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    adminToast.success({
      id: "admin-logout-success",
      title: "Logged out successfully",
    });
    navigate('/kaan');
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <AdminSidebar 
        activePanel={activePanel} 
        setActivePanel={setActivePanel}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        supportCount={supportCount}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <header className="sticky top-0 z-40 glass-card border-b border-border/50 rounded-none">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-md hover:bg-secondary"
              >
                <Menu className="w-5 h-5 text-foreground" />
              </button>
              <div>
                <h1 className="text-2xl font-bold font-display text-foreground">
                  {activePanel === 'overview' && 'Dashboard Overview'}
                  {activePanel === 'operations' && 'Operations Center'}
                  {activePanel === 'intelligence' && 'Growth-Scale Intelligence'}
                  {activePanel === 'users' && 'User Management'}
                  {activePanel === 'events' && 'Event Management'}
                  {activePanel === 'reports' && 'User Reports'}
                  {activePanel === 'export' && 'Data Export'}
                  {activePanel === 'event-analytics' && 'Event Analytics'}
                  {activePanel === 'video-date-timeline' && 'Video Date Timeline'}
                  {activePanel === 'activity-log' && 'Activity Log'}
                  {activePanel === 'engagement' && 'Engagement Analytics'}
                  {activePanel === 'campaigns' && 'Push Campaigns'}
                  {activePanel === 'photo-verification' && 'Photo Verification'}
                  {activePanel === 'media-lifecycle' && 'Media Lifecycle'}
                  {activePanel === 'feature-flags' && 'Feature Flags'}
                  {activePanel === 'deletions' && 'Account Deletions'}
                  {activePanel === 'support' && 'Support inbox'}
                  {activePanel === 'tier-config' && 'Tier configuration'}
                  {activePanel === 'ghost-bootstrap' && 'Ghost Bootstrap Accounts'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {activePanel === 'overview' && 'Real-time platform analytics'}
                  {activePanel === 'operations' && 'Production health, provider reconciliation, incidents, audit, and rebuild state'}
                  {activePanel === 'intelligence' && 'Product, marketplace, trust, revenue, cost, and native/store decision signals'}
                  {activePanel === 'users' && 'Manage all user profiles and activity'}
                  {activePanel === 'events' && 'Create and manage events'}
                  {activePanel === 'reports' && 'Review and act on user reports'}
                  {activePanel === 'export' && 'Queue governed audited exports'}
                  {activePanel === 'event-analytics' && 'Registration trends, attendance rates, and revenue'}
                  {activePanel === 'video-date-timeline' && 'Inspect a session timeline by video session UUID'}
                  {activePanel === 'activity-log' && 'Track all admin moderation actions'}
                  {activePanel === 'engagement' && 'Notification delivery, daily drops, and user activity'}
                  {activePanel === 'campaigns' && 'Draft campaign copy and supported targeting until backend delivery is available'}
                  {activePanel === 'photo-verification' && 'Review and approve user photo verifications'}
                  {activePanel === 'media-lifecycle' && 'Retention policy controls, worker readiness, and guarded cron rollout planning'}
                  {activePanel === 'feature-flags' && 'Ramp media-v2 safely with hard kills and audited overrides'}
                  {activePanel === 'deletions' && 'Manage account deletion requests and recoveries'}
                  {activePanel === 'support' && 'Support tickets, safety reports, and user replies'}
                  {activePanel === 'tier-config' && 'Live overrides for subscription tier capabilities (merged with code defaults)'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowNotifications(true)}
                className="relative"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <Badge className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center bg-primary text-primary-foreground text-xs">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </header>
        <AdminStaleBundleNotice />

        {/* Content */}
        <main className="p-6">
          <Suspense fallback={<AdminPanelFallback />}>
            {activePanel === 'overview' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <AdminOverviewMetadata />

                {/* Quick Actions Widgets */}
                <AdminQuickActionsCards
                  onNavigateToReports={() => setActivePanel('reports')}
                  onNavigateToUsers={() => setActivePanel('users')}
                  onNavigateToEvents={() => setActivePanel('events')}
                />
                
                <AdminDailyDropCard />
                <AdminStatsCards />
                <AdminAnalyticsCharts />
              </motion.div>
            )}

            {activePanel === 'operations' && <AdminOperationsCenter />}
            {activePanel === 'intelligence' && <AdminP4IntelligencePanel />}
            {activePanel === 'users' && <AdminUsersPanel />}
            {activePanel === 'events' && <AdminEventsPanel />}
            {activePanel === 'reports' && <AdminReportsPanel />}
            {activePanel === 'export' && <AdminExportPanel />}
            {activePanel === 'event-analytics' && <AdminLiveEventMetrics />}
            {activePanel === 'video-date-timeline' && <AdminVideoDateTimelinePanel />}
            {activePanel === 'activity-log' && <AdminActivityLog />}
            {activePanel === 'engagement' && <AdminEngagementAnalytics />}
            {activePanel === 'campaigns' && <AdminPushCampaignsPanel />}
            {activePanel === 'photo-verification' && <AdminPhotoVerificationPanel />}
            {activePanel === 'media-lifecycle' && <AdminMediaLifecyclePanel />}
            {activePanel === 'feature-flags' && <AdminClientFeatureFlagsPanel />}
            {activePanel === 'deletions' && <AdminDeletionsPanel />}
            {activePanel === 'support' && <SupportInbox />}
            {activePanel === 'tier-config' && <AdminTierConfigPanel />}
            {activePanel === 'ghost-bootstrap' && <AdminGhostBootstrapPanel />}
          </Suspense>
        </main>
      </div>

      {/* Notifications Panel */}
      <AnimatePresence>
        {showNotifications && (
          <Suspense fallback={null}>
            <AdminNotificationsPanel
              isOpen={showNotifications}
              onClose={() => setShowNotifications(false)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminDashboard;
