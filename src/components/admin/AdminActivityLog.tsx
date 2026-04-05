import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Shield,
  UserX,
  AlertTriangle,
  FileCheck,
  Calendar,
  Edit,
  Trash2,
  UserCheck,
  Clock,
  Filter,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";

type AdminLogDetails = Record<string, unknown> & {
  reason?: string;
  message?: string;
  title?: string;
};

const actionIcons: Record<string, LucideIcon> = {
  suspend_user: UserX,
  warn_user: AlertTriangle,
  ban_user: Shield,
  review_report: FileCheck,
  create_event: Calendar,
  edit_event: Edit,
  delete_event: Trash2,
  lift_suspension: UserCheck,
};

const actionLabels: Record<string, string> = {
  suspend_user: 'Suspended User',
  warn_user: 'Warned User',
  ban_user: 'Banned User',
  review_report: 'Reviewed Report',
  create_event: 'Created Event',
  edit_event: 'Edited Event',
  delete_event: 'Deleted Event',
  lift_suspension: 'Lifted Suspension',
};

const actionColors: Record<string, string> = {
  suspend_user: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  warn_user: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ban_user: 'bg-red-500/20 text-red-400 border-red-500/30',
  review_report: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  create_event: 'bg-green-500/20 text-green-400 border-green-500/30',
  edit_event: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  delete_event: 'bg-red-500/20 text-red-400 border-red-500/30',
  lift_suspension: 'bg-green-500/20 text-green-400 border-green-500/30',
};

const AdminActivityLog = () => {
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterTarget, setFilterTarget] = useState<string>('all');

  // Fetch activity logs
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['admin-activity-logs', filterAction, filterTarget],
    queryFn: async () => {
      let query = supabase
        .from('admin_activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filterAction !== 'all') {
        query = query.eq('action_type', filterAction);
      }
      if (filterTarget !== 'all') {
        query = query.eq('target_type', filterTarget);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch admin profiles
  const adminIds = [...new Set(logs.map(log => log.admin_id))];
  const { data: adminProfiles = {} } = useQuery({
    queryKey: ['admin-profiles', adminIds],
    queryFn: async () => {
      if (!adminIds.length) return {};
      const { data } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', adminIds);
      
      const map: Record<string, { name: string; avatar_url: string | null }> = {};
      data?.forEach(p => { map[p.id] = p; });
      return map;
    },
    enabled: adminIds.length > 0,
  });

  // Fetch target user profiles (for user-related actions)
  const userTargetIds = logs.filter(l => l.target_type === 'user').map(l => l.target_id).filter(Boolean);
  const { data: targetProfiles = {} } = useQuery({
    queryKey: ['target-profiles', userTargetIds],
    queryFn: async () => {
      if (!userTargetIds.length) return {};
      const { data } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', userTargetIds as string[]);
      
      const map: Record<string, { name: string; avatar_url: string | null }> = {};
      data?.forEach(p => { map[p.id] = p; });
      return map;
    },
    enabled: userTargetIds.length > 0,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Activity Log</h2>
          <p className="text-sm text-muted-foreground">Track all admin moderation actions</p>
        </div>
        <div className="flex gap-2">
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-[160px] bg-secondary/50">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="suspend_user">Suspensions</SelectItem>
              <SelectItem value="warn_user">Warnings</SelectItem>
              <SelectItem value="ban_user">Bans</SelectItem>
              <SelectItem value="review_report">Reports</SelectItem>
              <SelectItem value="create_event">Create Event</SelectItem>
              <SelectItem value="edit_event">Edit Event</SelectItem>
              <SelectItem value="delete_event">Delete Event</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterTarget} onValueChange={setFilterTarget}>
            <SelectTrigger className="w-[140px] bg-secondary/50">
              <SelectValue placeholder="All Targets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Targets</SelectItem>
              <SelectItem value="user">Users</SelectItem>
              <SelectItem value="report">Reports</SelectItem>
              <SelectItem value="event">Events</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <ScrollArea className="h-[600px]">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />
              ))
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No activity logs yet
              </div>
            ) : (
              logs.map((log, index) => {
                const Icon = actionIcons[log.action_type] || Shield;
                const admin = adminProfiles[log.admin_id];
                const target = log.target_type === 'user' && log.target_id 
                  ? targetProfiles[log.target_id] 
                  : null;
                const details =
                  typeof log.details === "object" && log.details !== null
                    ? (log.details as AdminLogDetails)
                    : null;

                return (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="flex gap-4 p-4 bg-secondary/30 rounded-xl hover:bg-secondary/50 transition-colors"
                  >
                    <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${actionColors[log.action_type] || 'bg-primary/20'}`}>
                      <Icon className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={actionColors[log.action_type]}>
                          {actionLabels[log.action_type] || log.action_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={resolvePhotoUrl(admin?.avatar_url) || undefined} />
                          <AvatarFallback className="text-[10px]">
                            {admin?.name?.[0] || 'A'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">{admin?.name || 'Admin'}</span>
                        
                        {target && (
                          <>
                            <span className="text-muted-foreground">→</span>
                            <Avatar className="w-5 h-5">
                              <AvatarImage src={resolvePhotoUrl(target.avatar_url) || undefined} />
                              <AvatarFallback className="text-[10px]">
                                {target.name?.[0] || 'U'}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-foreground">{target.name}</span>
                          </>
                        )}
                      </div>

                      {details && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {details.reason || details.message || details.title || JSON.stringify(details).substring(0, 100)}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-xs text-muted-foreground">
                      {format(new Date(log.created_at), 'MMM d, HH:mm')}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </motion.div>
  );
};

export default AdminActivityLog;
