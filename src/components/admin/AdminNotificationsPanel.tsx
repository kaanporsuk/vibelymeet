import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  User,
  Heart,
  Calendar,
  AlertTriangle,
  Shield,
  X,
  RefreshCw,
  Filter,
  Square,
  CheckSquare,
  ChevronDown,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const notificationIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  new_user: User,
  new_match: Heart,
  event_full: Calendar,
  event_capacity_warning: Calendar,
  user_report: AlertTriangle,
  user_suspended: Shield,
};

const notificationColors: Record<string, string> = {
  new_user: 'from-primary to-accent',
  new_match: 'from-pink-500 to-rose-500',
  event_full: 'from-orange-500 to-amber-500',
  event_capacity_warning: 'from-yellow-500 to-amber-500',
  user_report: 'from-yellow-500 to-orange-500',
  user_suspended: 'from-red-500 to-rose-500',
};

const notificationTypeLabels: Record<string, string> = {
  new_user: 'New Users',
  new_match: 'Matches',
  event_full: 'Events Full',
  event_capacity_warning: 'Capacity Alerts',
  user_report: 'Reports',
  user_suspended: 'Suspensions',
};

interface AdminNotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdminNotificationsPanel = ({ isOpen, onClose }: AdminNotificationsPanelProps) => {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // Fetch notifications
  const { data: notifications, isLoading, refetch } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    if (!notifications) return [];
    
    return notifications.filter(n => {
      // Filter by type
      if (activeFilters.size > 0 && !activeFilters.has(n.type)) {
        return false;
      }
      // Filter by read status
      if (showUnreadOnly && n.read) {
        return false;
      }
      return true;
    });
  }, [notifications, activeFilters, showUnreadOnly]);

  // Get unique notification types
  const notificationTypes = useMemo(() => {
    if (!notifications) return [];
    const types = new Set(notifications.map(n => n.type));
    return Array.from(types);
  }, [notifications]);

  // Toggle type filter
  const toggleTypeFilter = (type: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setActiveFilters(new Set());
    setShowUnreadOnly(false);
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredNotifications.map(n => n.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const isAllSelected = filteredNotifications.length > 0 && 
    filteredNotifications.every(n => selectedIds.has(n.id));

  // Mark as read mutation
  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ read: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  // Bulk mark as read
  const bulkMarkAsRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ read: true })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
      setSelectedIds(new Set());
      toast.success('Selected notifications marked as read');
    },
  });

  // Mark all as read
  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ read: true })
        .eq('read', false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
      toast.success('All notifications marked as read');
    },
  });

  // Delete notification
  const deleteNotification = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('admin_notifications')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  // Bulk delete
  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('admin_notifications')
        .delete()
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
      setSelectedIds(new Set());
      toast.success('Selected notifications deleted');
    },
  });

  // Clear all notifications
  const clearAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('admin_notifications')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
      toast.success('All notifications cleared');
    },
  });

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;
  const hasFilters = activeFilters.size > 0 || showUnreadOnly;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
      />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-background border-l border-border z-50 flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Notification Center</h2>
              <p className="text-xs text-muted-foreground">
                {unreadCount} unread • {notifications?.length || 0} total
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="h-8 w-8"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-3 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Type Filter Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="w-3 h-3" />
                  Filter Type
                  {activeFilters.size > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {activeFilters.size}
                    </Badge>
                  )}
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {notificationTypes.map(type => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={activeFilters.has(type)}
                    onCheckedChange={() => toggleTypeFilter(type)}
                  >
                    <div className="flex items-center gap-2">
                      {(() => {
                        const Icon = notificationIcons[type] || Bell;
                        return <Icon className="w-3 h-3" />;
                      })()}
                      {notificationTypeLabels[type] || type}
                    </div>
                  </DropdownMenuCheckboxItem>
                ))}
                {notificationTypes.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setActiveFilters(new Set())}>
                      Clear filters
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Unread Only Toggle */}
            <Button
              variant={showUnreadOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              className="gap-2"
            >
              <Zap className="w-3 h-3" />
              Unread Only
            </Button>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground"
              >
                Clear All
              </Button>
            )}
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 py-2 border-b border-border bg-primary/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={() => isAllSelected ? deselectAll() : selectAll()}
                />
                <span className="text-sm text-foreground font-medium">
                  {selectedIds.size} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkMarkAsRead.mutate(Array.from(selectedIds))}
                  disabled={bulkMarkAsRead.isPending}
                  className="gap-1"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark Read
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkDelete.mutate(Array.from(selectedIds))}
                  disabled={bulkDelete.isPending}
                  className="gap-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Quick Actions */}
        <div className="p-3 border-b border-border flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => isAllSelected ? deselectAll() : selectAll()}
            className="gap-2"
          >
            {isAllSelected ? (
              <Square className="w-3 h-3" />
            ) : (
              <CheckSquare className="w-3 h-3" />
            )}
            {isAllSelected ? 'Deselect All' : 'Select All'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending || unreadCount === 0}
            className="flex-1 gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            Mark All Read
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending || !notifications?.length}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </Button>
        </div>

        {/* Notifications List */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />
              ))
            ) : !filteredNotifications.length ? (
              <div className="text-center py-12">
                <BellOff className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {hasFilters ? 'No notifications match your filters' : 'No notifications yet'}
                </p>
                {hasFilters && (
                  <Button
                    variant="link"
                    onClick={clearFilters}
                    className="mt-2"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <AnimatePresence>
                {filteredNotifications.map((notification, index) => {
                  const Icon = notificationIcons[notification.type] || Bell;
                  const colorClass = notificationColors[notification.type] || 'from-gray-500 to-gray-600';
                  const isSelected = selectedIds.has(notification.id);

                  return (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ delay: index * 0.02 }}
                      className={`p-4 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-primary/10 border-primary/50 ring-1 ring-primary/30'
                          : notification.read
                          ? 'bg-secondary/30 border-border/50'
                          : 'bg-secondary/50 border-primary/30'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Selection Checkbox */}
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(notification.id)}
                          className="mt-1"
                        />
                        
                        {/* Icon */}
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorClass} flex items-center justify-center flex-shrink-0`}>
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-foreground text-sm">
                                  {notification.title}
                                </p>
                                {!notification.read && (
                                  <span className="w-2 h-2 rounded-full bg-primary" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {notification.message}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {!notification.read && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => markAsRead.mutate(notification.id)}
                                  className="h-6 w-6"
                                  title="Mark as read"
                                >
                                  <Check className="w-3 h-3" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteNotification.mutate(notification.id)}
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                title="Delete"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-xs">
                              {notificationTypeLabels[notification.type] || notification.type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(notification.created_at!), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>

        {/* Footer Stats */}
        <div className="p-3 border-t border-border bg-secondary/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {filteredNotifications.length} of {notifications?.length || 0}
            </span>
            <span>
              {unreadCount} unread
            </span>
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default AdminNotificationsPanel;
