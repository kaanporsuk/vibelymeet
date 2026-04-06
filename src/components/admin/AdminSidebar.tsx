import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Calendar,
  LogOut,
  Shield,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Download,
  BarChart3,
  Activity,
  TrendingUp,
  Bell,
  X,
  UserMinus,
  MessageSquare,
  LifeBuoy,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type ActivePanel = 'overview' | 'users' | 'events' | 'reports' | 'export' | 'event-analytics' | 'activity-log' | 'engagement' | 'campaigns' | 'photo-verification' | 'deletions' | 'feedback' | 'support' | 'tier-config' | 'ghost-bootstrap';

interface AdminSidebarProps {
  activePanel: ActivePanel;
  setActivePanel: (panel: ActivePanel) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  feedbackCount?: number;
  supportCount?: number;
}

const AdminSidebar = ({ activePanel, setActivePanel, onLogout, isOpen, onClose, feedbackCount = 0, supportCount = 0 }: AdminSidebarProps) => {
  const menuItems = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'users' as const, label: 'Users', icon: Users },
    { id: 'events' as const, label: 'Events', icon: Calendar },
    { id: 'tier-config' as const, label: 'Tier Config', icon: Layers },
    { id: 'event-analytics' as const, label: 'Event Analytics', icon: BarChart3 },
    { id: 'engagement' as const, label: 'Engagement', icon: TrendingUp },
    { id: 'campaigns' as const, label: 'Push Campaigns', icon: Bell },
    { id: 'photo-verification' as const, label: 'Photo Verification', icon: ShieldCheck },
    { id: 'reports' as const, label: 'Reports', icon: AlertTriangle },
    { id: 'deletions' as const, label: 'Deletions', icon: UserMinus },
    { id: 'ghost-bootstrap' as const, label: 'Ghost Accounts', icon: Zap },
    { id: 'support' as const, label: 'Support', icon: LifeBuoy, badge: supportCount > 0 ? supportCount : undefined },
    { id: 'feedback' as const, label: 'Feedback', icon: MessageSquare, badge: feedbackCount > 0 ? feedbackCount : undefined },
    { id: 'activity-log' as const, label: 'Activity Log', icon: Activity },
    { id: 'export' as const, label: 'Export', icon: Download },
  ];

  const handleNavClick = (id: ActivePanel) => {
    setActivePanel(id);
    onClose?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 min-h-screen glass-card border-r border-border/50 rounded-none flex flex-col
          transform transition-transform duration-300 ease-in-out
          lg:static lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="p-6 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold font-display text-foreground">Vibely</h1>
              <p className="text-xs text-muted-foreground">Admin Portal</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden p-1 rounded-md hover:bg-secondary">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePanel === item.id;
            
            return (
              <motion.button
                key={item.id}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-primary/20 to-accent/20 text-foreground border border-primary/30'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
                <span className="font-medium">{item.label}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {'badge' in item && item.badge ? (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                  {isActive && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="w-2 h-2 rounded-full bg-primary"
                    />
                  )}
                </div>
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
    </>
  );
};

export default AdminSidebar;