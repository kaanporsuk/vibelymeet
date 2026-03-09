import { useState } from "react";
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
import AdminUsersPanel from "@/components/admin/AdminUsersPanel";
import AdminEventsPanel from "@/components/admin/AdminEventsPanel";
import AdminStatsCards from "@/components/admin/AdminStatsCards";
import AdminAnalyticsCharts from "@/components/admin/AdminAnalyticsCharts";
import AdminNotificationsPanel from "@/components/admin/AdminNotificationsPanel";
import AdminReportsPanel from "@/components/admin/AdminReportsPanel";
import AdminExportPanel from "@/components/admin/AdminExportPanel";
import AdminQuickActionsCards from "@/components/admin/AdminQuickActionsCards";
import AdminLiveEventMetrics from "@/components/admin/AdminLiveEventMetrics";
import AdminActivityLog from "@/components/admin/AdminActivityLog";
import AdminEngagementAnalytics from "@/components/admin/AdminEngagementAnalytics";
import AdminPushCampaignsPanel from "@/components/admin/AdminPushCampaignsPanel";
import AdminPhotoVerificationPanel from "@/components/admin/AdminPhotoVerificationPanel";
import AdminDeletionsPanel from "@/components/admin/AdminDeletionsPanel";
import AdminFeedbackPanel from "@/components/admin/AdminFeedbackPanel";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";

type ActivePanel = 'overview' | 'users' | 'events' | 'reports' | 'export' | 'event-analytics' | 'activity-log' | 'engagement' | 'campaigns' | 'photo-verification' | 'deletions' | 'feedback';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<ActivePanel>('overview');
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Enable real-time updates
  useAdminRealtime({ enabled: true });

  // Fetch unread notifications count
  const { data: unreadCount } = useQuery({
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
                {activePanel === 'activity-log' && 'Activity Log'}
                {activePanel === 'engagement' && 'Engagement Analytics'}
                {activePanel === 'campaigns' && 'Push Campaigns'}
                {activePanel === 'photo-verification' && 'Photo Verification'}
                {activePanel === 'deletions' && 'Account Deletions'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {activePanel === 'overview' && 'Real-time platform analytics'}
                {activePanel === 'users' && 'Manage all user profiles and activity'}
                {activePanel === 'events' && 'Create and manage events'}
                {activePanel === 'reports' && 'Review and act on user reports'}
                {activePanel === 'export' && 'Download platform data as CSV/PDF'}
                {activePanel === 'event-analytics' && 'Registration trends, attendance rates, and revenue'}
                {activePanel === 'activity-log' && 'Track all admin moderation actions'}
                {activePanel === 'engagement' && 'Notification delivery, daily drops, and user activity'}
                {activePanel === 'campaigns' && 'Send targeted notifications to user segments'}
                {activePanel === 'photo-verification' && 'Review and approve user photo verifications'}
                {activePanel === 'deletions' && 'Manage account deletion requests and recoveries'}
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
              
              <AdminStatsCards />
              <AdminAnalyticsCharts />
            </motion.div>
          )}

          {activePanel === 'users' && <AdminUsersPanel />}
          {activePanel === 'events' && <AdminEventsPanel />}
          {activePanel === 'reports' && <AdminReportsPanel />}
          {activePanel === 'export' && <AdminExportPanel />}
          {activePanel === 'event-analytics' && <AdminLiveEventMetrics />}
          {activePanel === 'activity-log' && <AdminActivityLog />}
          {activePanel === 'engagement' && <AdminEngagementAnalytics />}
          {activePanel === 'campaigns' && <AdminPushCampaignsPanel />}
          {activePanel === 'photo-verification' && <AdminPhotoVerificationPanel />}
          {activePanel === 'deletions' && <AdminDeletionsPanel />}
        </main>
      </div>

      {/* Notifications Panel */}
      <AnimatePresence>
        {showNotifications && (
          <AdminNotificationsPanel
            isOpen={showNotifications}
            onClose={() => setShowNotifications(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminDashboard;