import { useState } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminUsersPanel from "@/components/admin/AdminUsersPanel";
import AdminEventsPanel from "@/components/admin/AdminEventsPanel";
import AdminStatsCards from "@/components/admin/AdminStatsCards";

type ActivePanel = 'overview' | 'users' | 'events';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<ActivePanel>('overview');

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
              </h1>
              <p className="text-sm text-muted-foreground">
                {activePanel === 'overview' && 'Real-time platform analytics'}
                {activePanel === 'users' && 'Manage all user profiles and activity'}
                {activePanel === 'events' && 'Create and manage events'}
              </p>
            </div>
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
        </header>

        {/* Content */}
        <main className="p-6">
          {activePanel === 'overview' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <AdminStatsCards />
              
              {/* Quick Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActivePanel('users')}
                  className="glass-card p-6 rounded-2xl text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                        <Users className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">Manage Users</h3>
                        <p className="text-sm text-muted-foreground">View, filter, and manage all users</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActivePanel('events')}
                  className="glass-card p-6 rounded-2xl text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-neon-cyan flex items-center justify-center">
                        <Calendar className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">Manage Events</h3>
                        <p className="text-sm text-muted-foreground">Create, edit, and monitor events</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </motion.button>
              </div>
            </motion.div>
          )}

          {activePanel === 'users' && <AdminUsersPanel />}
          {activePanel === 'events' && <AdminEventsPanel />}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;