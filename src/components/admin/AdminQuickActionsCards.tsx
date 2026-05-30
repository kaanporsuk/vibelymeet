import { motion } from "framer-motion";
import {
  AlertTriangle,
  UserPlus,
  CalendarClock,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatAdminUtcDateTime,
  useAdminOverviewDashboard,
} from "@/hooks/useAdminOverviewDashboard";
import { resolveAdminErrorMessage } from "@/lib/adminErrorResolver";

interface AdminQuickActionsCardsProps {
  onNavigateToReports: () => void;
  onNavigateToUsers: () => void;
  onNavigateToEvents: () => void;
}

const AdminQuickActionsCards = ({
  onNavigateToReports,
  onNavigateToUsers,
  onNavigateToEvents,
}: AdminQuickActionsCardsProps) => {
  const {
    data: overview,
    error,
    isError,
    isLoading,
    refetch,
  } = useAdminOverviewDashboard();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Loading Quick Actions">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="glass-card p-6 rounded-2xl animate-pulse">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-secondary" />
                <div className="w-5 h-5 rounded bg-secondary" />
              </div>
              <div className="space-y-2">
                <div className="h-8 w-12 rounded bg-secondary" />
                <div className="h-4 w-36 rounded bg-secondary" />
                <div className="h-3 w-28 rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !overview?.quick_actions) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Quick Actions</h3>
        <div className="glass-card p-6 rounded-2xl border-destructive/40">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground">Unable to load Quick Actions</h4>
                <p className="text-sm text-muted-foreground">
                  Counts are hidden until the backend overview read succeeds.
                </p>
                {error && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {resolveAdminErrorMessage(error, "Could not load Quick Actions")}
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const pendingReportsCount = overview.quick_actions.pending_reports_count;
  const newUsersToday = overview.quick_actions.new_users_today_count;
  const actionableUpcoming = overview.quick_actions.actionable_upcoming_events;
  const upcomingEvents = actionableUpcoming.rows || [];

  const actionCards = [
    {
      id: 'reports',
      title: 'Pending Reports',
      value: pendingReportsCount,
      subtitle: pendingReportsCount > 0 ? 'Requires attention' : 'All clear',
      icon: AlertTriangle,
      gradient: 'from-red-500 to-orange-600',
      urgent: pendingReportsCount > 0,
      onClick: onNavigateToReports,
    },
    {
      id: 'users',
      title: 'New Users Today',
      value: newUsersToday,
      subtitle: 'Joined recently',
      icon: UserPlus,
      gradient: 'from-green-500 to-emerald-600',
      urgent: false,
      onClick: onNavigateToUsers,
    },
    {
      id: 'events',
      title: 'Actionable Upcoming Events',
      value: actionableUpcoming.count,
      subtitle: upcomingEvents.length > 0
        ? `Next: ${upcomingEvents[0]?.title?.substring(0, 20)}...` 
        : 'No actionable upcoming events',
      icon: CalendarClock,
      gradient: 'from-violet-500 to-purple-600',
      urgent: false,
      onClick: onNavigateToEvents,
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Quick Actions</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {actionCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.button
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={card.onClick}
              className={`glass-card p-6 rounded-2xl text-left relative overflow-hidden group ${
                card.urgent ? 'ring-2 ring-red-500/50' : ''
              }`}
            >
              {card.urgent && (
                <motion.div
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute top-3 right-3 w-3 h-3 rounded-full bg-red-500"
                />
              )}
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{card.value}</p>
                <p className="text-sm font-medium text-foreground">{card.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Upcoming Events List */}
      {upcomingEvents.length > 0 && (
        <div className="glass-card p-4 rounded-2xl">
          <h4 className="text-sm font-medium text-foreground mb-3">Next actionable events</h4>
          <div className="space-y-2">
            {upcomingEvents.map((event) => (
              <motion.div
                key={event.id}
                whileHover={{ x: 4 }}
                className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors cursor-pointer"
                onClick={onNavigateToEvents}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <CalendarClock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground truncate max-w-[150px]">
                      {event.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatAdminUtcDateTime(event.event_date)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-foreground">
                    {event.current_attendees || 0}/{event.max_attendees || 50}
                  </p>
                  <p className="text-xs text-muted-foreground">Registered spots</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminQuickActionsCards;
