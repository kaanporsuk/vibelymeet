import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  UserPlus,
  CalendarClock,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, isFuture, parseISO } from "date-fns";

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
  // Fetch pending reports count
  const { data: pendingReportsCount = 0 } = useQuery({
    queryKey: ['admin-pending-reports'],
    queryFn: async () => {
      const { count } = await supabase
        .from('user_reports')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      return count || 0;
    },
  });

  // Fetch new users today
  const { data: newUsersToday = 0 } = useQuery({
    queryKey: ['admin-new-users-today'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());
      return count || 0;
    },
  });

  // Fetch upcoming events (next 3)
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ['admin-upcoming-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, event_date, current_attendees, max_attendees')
        .gte('event_date', new Date().toISOString())
        .order('event_date', { ascending: true })
        .limit(3);
      if (error) throw error;
      return data || [];
    },
  });

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
      title: 'Upcoming Events',
      value: upcomingEvents.length,
      subtitle: upcomingEvents.length > 0 
        ? `Next: ${upcomingEvents[0]?.title?.substring(0, 20)}...` 
        : 'No upcoming events',
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
          <h4 className="text-sm font-medium text-foreground mb-3">Next Events</h4>
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
                      {format(parseISO(event.event_date), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-foreground">
                    {event.current_attendees || 0}/{event.max_attendees || 50}
                  </p>
                  <p className="text-xs text-muted-foreground">Attendees</p>
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
