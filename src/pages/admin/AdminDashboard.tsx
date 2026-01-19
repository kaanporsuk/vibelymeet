import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Calendar,
  TrendingUp,
  Activity,
  Heart,
  MessageSquare,
  UserCheck,
  LogOut,
  ChevronRight,
  Sparkles,
  Bell,
  AlertTriangle,
  Download,
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
import { useAdminRealtime } from "@/hooks/useAdminRealtime";

type ActivePanel = 'overview' | 'users' | 'events' | 'reports' | 'export';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<ActivePanel>('overview');
  const [showNotifications, setShowNotifications] = useState(false);

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
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <header className="sticky top-0 z-40 glass-card border-b border-border/50 rounded-none">
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold font-display text-foreground">
                {activePanel === 'overview' && 'Dashboard Overview'}
                {activePanel === 'users' && 'User Management'}
                {activePanel === 'events' && 'Event Management'}
                {activePanel === 'reports' && 'User Reports'}
                {activePanel === 'export' && 'Data Export'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {activePanel === 'overview' && 'Real-time platform analytics'}
                {activePanel === 'users' && 'Manage all user profiles and activity'}
                {activePanel === 'events' && 'Create and manage events'}
                {activePanel === 'reports' && 'Review and act on user reports'}
                {activePanel === 'export' && 'Download platform data as CSV'}
              </p>
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