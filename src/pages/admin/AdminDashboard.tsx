import { lazy, Suspense, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Menu,
  LogOut,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";

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
const AdminFeedbackPanel = lazy(() => import("@/components/admin/AdminFeedbackPanel"));
const SupportInbox = lazy(() => import("@/components/admin/SupportInbox"));
const AdminDailyDropCard = lazy(() => import("@/components/admin/AdminDailyDropCard"));
const AdminTierConfigPanel = lazy(() => import("@/components/admin/AdminTierConfigPanel"));
const AdminGhostBootstrapPanel = lazy(() =>
  import("@/components/admin/AdminGhostBootstrapPanel").then((mod) => ({
    default: mod.AdminGhostBootstrapPanel,
  }))
);
const AdminMediaLifecyclePanel = lazy(() => import("@/components/admin/AdminMediaLifecyclePanel"));

type ActivePanel = 'overview' | 'users' | 'events' | 'reports' | 'export' | 'event-analytics' | 'video-date-timeline' | 'activity-log' | 'engagement' | 'campaigns' | 'photo-verification' | 'deletions' | 'feedback' | 'support' | 'tier-config' | 'ghost-bootstrap' | 'media-lifecycle';

const AdminPanelFallback = () => (
  <div className="min-h-[320px] rounded-xl border border-border/50 bg-card/30 animate-pulse" />
);

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<ActivePanel>('overview');
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Enable real-time updates
  useAdminRealtime({ enabled: true });

  // Fetch unread notifications count
  const { data: unreadCountData } = useQuery({
    queryKey: ['admin-unread-notifications'],
    queryFn: async () => {
      const { count } = await supabase
        .from('admin_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('read', false);
      return count || 0;
    },
    refetchInterval: 30000,
  });
  const unreadCount = unreadCountData ?? 0;

  // Fetch new feedback count
  const { data: feedbackCount = 0 } = useQuery({
    queryKey: ['admin-new-feedback-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new');
      return count || 0;
    },
    refetchInterval: 60000,
  });

  const { data: supportCount = 0 } = useQuery({
    queryKey: ['admin-support-open-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('support_tickets')
        .select('*', { count: 'exact', head: true })
        .in('status', ['submitted', 'in_review']);

      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
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
        feedbackCount={feedbackCount}
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
                {activePanel === 'deletions' && 'Account Deletions'}
                {activePanel === 'feedback' && 'Legacy feedback'}
                {activePanel === 'support' && 'Support inbox'}
                {activePanel === 'tier-config' && 'Tier configuration'}
                {activePanel === 'ghost-bootstrap' && 'Ghost Bootstrap Accounts'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {activePanel === 'overview' && 'Real-time platform analytics'}
                {activePanel === 'users' && 'Manage all user profiles and activity'}
                {activePanel === 'events' && 'Create and manage events'}
                {activePanel === 'reports' && 'Review and act on user reports'}
                {activePanel === 'export' && 'Download platform data as CSV/PDF'}
                {activePanel === 'event-analytics' && 'Registration trends, attendance rates, and revenue'}
                {activePanel === 'video-date-timeline' && 'Inspect a session timeline by video session UUID'}
                {activePanel === 'activity-log' && 'Track all admin moderation actions'}
                {activePanel === 'engagement' && 'Notification delivery, daily drops, and user activity'}
                {activePanel === 'campaigns' && 'Send targeted notifications to user segments'}
                {activePanel === 'photo-verification' && 'Review and approve user photo verifications'}
                {activePanel === 'media-lifecycle' && 'Retention policy controls, worker readiness, and guarded cron rollout planning'}
                {activePanel === 'deletions' && 'Manage account deletion requests and recoveries'}
                {activePanel === 'feedback' && 'Legacy Help & Feedback submissions'}
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

        {/* Content */}
        <main className="p-6">
          <Suspense fallback={<AdminPanelFallback />}>
            {activePanel === 'overview' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Quick Actions Widgets */}
                <AdminQuickActionsCards
                  onNavigateToReports={() => setActivePanel('reports')}
                  onNavigateToUsers={() => setActivePanel('users')}
                  onNavigateToEvents={() => setActivePanel('events')}
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AdminDailyDropCard />
                </div>
                <AdminStatsCards />
                <AdminAnalyticsCharts />
              </motion.div>
            )}

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
            {activePanel === 'deletions' && <AdminDeletionsPanel />}
            {activePanel === 'feedback' && <AdminFeedbackPanel />}
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
