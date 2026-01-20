import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Calendar,
  LogOut,
  Shield,
  Sparkles,
  AlertTriangle,
  Download,
  BarChart3,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type ActivePanel = 'overview' | 'users' | 'events' | 'reports' | 'export' | 'event-analytics' | 'activity-log';

interface AdminSidebarProps {
  activePanel: ActivePanel;
  setActivePanel: (panel: ActivePanel) => void;
  onLogout: () => void;
}

const AdminSidebar = ({ activePanel, setActivePanel, onLogout }: AdminSidebarProps) => {
  const menuItems = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'users' as const, label: 'Users', icon: Users },
    { id: 'events' as const, label: 'Events', icon: Calendar },
    { id: 'event-analytics' as const, label: 'Event Analytics', icon: BarChart3 },
    { id: 'reports' as const, label: 'Reports', icon: AlertTriangle },
    { id: 'activity-log' as const, label: 'Activity Log', icon: Activity },
    { id: 'export' as const, label: 'Export', icon: Download },
  ];

  return (
    <aside className="w-64 min-h-screen glass-card border-r border-border/50 rounded-none flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold font-display text-foreground">Vibely</h1>
            <p className="text-xs text-muted-foreground">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePanel === item.id;
          
          return (
            <motion.button
              key={item.id}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActivePanel(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-primary/20 to-accent/20 text-foreground border border-primary/30'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
              <span className="font-medium">{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="ml-auto w-2 h-2 rounded-full bg-primary"
                />
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border/50">
        <Button
          variant="ghost"
          onClick={onLogout}
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
};

export default AdminSidebar;