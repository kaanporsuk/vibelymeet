import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Users,
  CheckCircle,
  XCircle,
  Search,
  Bell,
  UserCheck,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { sendNotification } from "@/lib/notifications";
import { toast } from "sonner";
import { format } from "date-fns";

interface AdminEventAttendeesModalProps {
  event: any;
  onClose: () => void;
}

const NOTIFY_ALL_COOLDOWN_MS = 5 * 60 * 1000;

const AdminEventAttendeesModal = ({ event, onClose }: AdminEventAttendeesModalProps) => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>([]);
  const [showPending, setShowPending] = useState(true);
  const [showAttended, setShowAttended] = useState(true);
  const [showNoShow, setShowNoShow] = useState(true);
  const [notifyAllBody, setNotifyAllBody] = useState("");
  const [isSendingNotifyAll, setIsSendingNotifyAll] = useState(false);
  const [lastNotifyAllAt, setLastNotifyAllAt] = useState<number | null>(null);
  const [cooldownBump, setCooldownBump] = useState(0);

  useEffect(() => {
    if (lastNotifyAllAt == null) return;
    const elapsed = Date.now() - lastNotifyAllAt;
    if (elapsed >= NOTIFY_ALL_COOLDOWN_MS) return;
    const t = setTimeout(() => setCooldownBump((x) => x + 1), NOTIFY_ALL_COOLDOWN_MS - elapsed);
    return () => clearTimeout(t);
  }, [lastNotifyAllAt, cooldownBump]);

  // Fetch event registrations with profile data
  const { data: registrations, isLoading } = useQuery({
    queryKey: ['admin-event-attendees', event.id, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('event_registrations')
        .select(`
          id,
          registered_at,
          attended,
          attendance_marked,
          profile_id,
          profiles:profile_id (
            id,
            name,
            age,
            gender,
            avatar_url,
            email_verified,
            photo_verified
          )
        `)
        .eq('event_id', event.id)
        .order('registered_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      
      // Filter by search if needed
      let filtered = data || [];
      if (searchQuery) {
        const lowerSearch = searchQuery.toLowerCase();
        filtered = filtered.filter(reg => 
          (reg.profiles as any)?.name?.toLowerCase().includes(lowerSearch)
        );
      }
      
      return filtered;
    },
  });

  // Mark attendance mutation
  const markAttendance = useMutation({
    mutationFn: async ({ registrationId, attended }: { registrationId: string; attended: boolean }) => {
      const { error } = await supabase
        .from('event_registrations')
        .update({
          attended,
          attendance_marked: true,
          attendance_marked_at: new Date().toISOString(),
        })
        .eq('id', registrationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-event-attendees', event.id] });
      toast.success('Attendance marked');
    },
    onError: () => {
      toast.error('Failed to mark attendance');
    },
  });

  // Bulk mark attendance
  const bulkMarkAttendance = useMutation({
    mutationFn: async (attended: boolean) => {
      const { error } = await supabase
        .from('event_registrations')
        .update({
          attended,
          attendance_marked: true,
          attendance_marked_at: new Date().toISOString(),
        })
        .in('id', selectedAttendees);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-event-attendees', event.id] });
      setSelectedAttendees([]);
      toast.success(`Marked ${selectedAttendees.length} attendees`);
    },
    onError: () => {
      toast.error('Failed to mark attendance');
    },
  });

  const toggleSelectAll = () => {
    if (selectedAttendees.length === filteredRegistrations?.length) {
      setSelectedAttendees([]);
    } else {
      setSelectedAttendees(filteredRegistrations?.map(r => r.id) || []);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedAttendees(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const notifyCooldownActive =
    lastNotifyAllAt != null && Date.now() - lastNotifyAllAt < NOTIFY_ALL_COOLDOWN_MS;

  const sendNotifyAllRegistrants = useCallback(async () => {
    const body = notifyAllBody.trim();
    if (!body) {
      toast.error("Enter a notification message");
      return;
    }
    if (notifyCooldownActive) {
      toast.message("Please wait 5 minutes between broadcasts to all attendees.");
      return;
    }
    setIsSendingNotifyAll(true);
    try {
      const { data: allRegs, error } = await supabase
        .from("event_registrations")
        .select("profile_id")
        .eq("event_id", event.id);
      if (error) throw error;
      const ids = [...new Set((allRegs ?? []).map((r) => r.profile_id).filter(Boolean))] as string[];
      const eventTitle = (event.title as string) || "Your event";
      for (const user_id of ids) {
        await sendNotification({
          user_id,
          category: "event_reminder",
          title: eventTitle,
          body,
          data: { url: `/event/${event.id}/lobby`, event_id: event.id },
        });
      }
      setLastNotifyAllAt(Date.now());
      toast.success(`Notification sent to ${ids.length} attendees`);
    } catch {
      toast.error("Failed to send notifications");
    } finally {
      setIsSendingNotifyAll(false);
    }
  }, [notifyAllBody, notifyCooldownActive, event.id, event.title]);

  const exportAttendees = () => {
    if (!registrations?.length) return;
    
    const csvContent = [
      ['Name', 'Age', 'Gender', 'Registered', 'Status'].join(','),
      ...registrations.map(reg => {
        const profile = reg.profiles as any;
        const status = reg.attendance_marked 
          ? (reg.attended ? 'Attended' : 'No Show') 
          : 'Pending';
        return [
          profile?.name || 'Unknown',
          profile?.age || '',
          profile?.gender || '',
          format(new Date(reg.registered_at), 'yyyy-MM-dd HH:mm'),
          status
        ].join(',');
      })
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.title}-attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Attendee list exported');
  };

  // Filter registrations based on status toggles
  const filteredRegistrations = registrations?.filter(reg => {
    if (!reg.attendance_marked && showPending) return true;
    if (reg.attendance_marked && reg.attended && showAttended) return true;
    if (reg.attendance_marked && !reg.attended && showNoShow) return true;
    return false;
  });

  const attendedCount = registrations?.filter(r => r.attended).length || 0;
  const totalCount = registrations?.length || 0;
  const pendingCount = registrations?.filter(r => !r.attendance_marked).length || 0;
  const noShowCount = registrations?.filter(r => r.attendance_marked && !r.attended).length || 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-50 flex flex-col"
    >
      {/* Header - Fixed */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-display text-foreground">
              Event Attendees
            </h2>
            <p className="text-sm text-muted-foreground">
              {event.title} · {format(new Date(event.event_date), 'MMM d, yyyy')}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="shrink-0 border-b border-border/50 bg-secondary/20">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{totalCount}</p>
              <p className="text-xs text-muted-foreground">Registered</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-400">{attendedCount}</p>
              <p className="text-xs text-muted-foreground">Attended</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-400">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-400">{noShowCount}</p>
              <p className="text-xs text-muted-foreground">No Show</p>
            </div>
          </div>
        </div>
      </div>

      {/* Broadcast push to all registrants */}
      <div className="shrink-0 border-b border-border/50 bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 space-y-2">
          <label htmlFor="admin-notify-all-body" className="text-xs font-medium text-muted-foreground">
            Message to all registered attendees (push)
          </label>
          <Input
            id="admin-notify-all-body"
            placeholder="Your event starts in 15 minutes!"
            value={notifyAllBody}
            onChange={(e) => setNotifyAllBody(e.target.value)}
            className="bg-secondary/50"
          />
          <p className="text-[11px] text-muted-foreground">
            Sends via the same system as event reminders. 5-minute cooldown between sends.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 border-b border-border/50 bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col md:flex-row gap-4 justify-between">
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search attendees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-secondary/50"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Filters */}
            <div className="flex items-center gap-1 mr-2">
              <Button
                size="sm"
                variant={showPending ? "default" : "outline"}
                onClick={() => setShowPending(!showPending)}
                className="h-8 text-xs"
              >
                Pending
              </Button>
              <Button
                size="sm"
                variant={showAttended ? "default" : "outline"}
                onClick={() => setShowAttended(!showAttended)}
                className="h-8 text-xs"
              >
                Attended
              </Button>
              <Button
                size="sm"
                variant={showNoShow ? "default" : "outline"}
                onClick={() => setShowNoShow(!showNoShow)}
                className="h-8 text-xs"
              >
                No Show
              </Button>
            </div>
            
            <Button
              size="sm"
              variant="outline"
              onClick={exportAttendees}
              className="gap-1"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        </div>
        
        {/* Bulk Actions */}
        {selectedAttendees.length > 0 && (
          <div className="max-w-5xl mx-auto px-4 pb-3">
            <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg">
              <Badge variant="secondary" className="gap-1">
                {selectedAttendees.length} selected
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkMarkAttendance.mutate(true)}
                className="gap-1 bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Attended
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkMarkAttendance.mutate(false)}
                className="gap-1 bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
              >
                <XCircle className="w-4 h-4" />
                Mark No Show
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void sendNotifyAllRegistrants()}
                disabled={isSendingNotifyAll || notifyCooldownActive}
                className="gap-1"
              >
                <Bell className="w-4 h-4" />
                {isSendingNotifyAll ? "Sending…" : "Notify"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedAttendees([])}
                className="ml-auto"
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Attendees List - Scrollable */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-4 pb-24">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="text-center py-16">
              <Users className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium text-foreground mb-2">No registrations yet</p>
              <p className="text-sm text-muted-foreground">
                Attendees will appear here once they register for this event.
              </p>
            </div>
          ) : filteredRegistrations?.length === 0 ? (
            <div className="text-center py-16">
              <Search className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium text-foreground mb-2">No matches found</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search or filters.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Select All Header */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 sticky top-0 z-10">
                <Checkbox
                  checked={selectedAttendees.length === filteredRegistrations?.length && (filteredRegistrations?.length || 0) > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm font-medium text-foreground">
                  Select All ({filteredRegistrations?.length || 0})
                </span>
              </div>

              {filteredRegistrations?.map((reg, index) => {
                const profile = reg.profiles as any;
                return (
                  <motion.div
                    key={reg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${
                      selectedAttendees.includes(reg.id)
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-card border-border hover:bg-secondary/50'
                    }`}
                  >
                    <Checkbox
                      checked={selectedAttendees.includes(reg.id)}
                      onCheckedChange={() => toggleSelect(reg.id)}
                    />
                    <Avatar className="w-12 h-12 border-2 border-border">
                      <AvatarImage src={resolvePhotoUrl(profile?.avatar_url) || ''} />
                      <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white">
                        {profile?.name?.charAt(0) || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">
                          {profile?.name || 'Unknown'}
                        </p>
                        {profile?.photo_verified && (
                          <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                            Verified
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{profile?.age} · {profile?.gender}</span>
                        <span>·</span>
                        <span>Registered {format(new Date(reg.registered_at), 'MMM d, h:mm a')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {reg.attendance_marked ? (
                        reg.attended ? (
                          <Badge className="bg-green-500/10 text-green-400 border-green-500/30">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Attended
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/10 text-red-400 border-red-500/30">
                            <XCircle className="w-3 h-3 mr-1" />
                            No Show
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
                          Pending
                        </Badge>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-card border-border">
                          <DropdownMenuItem
                            onClick={() => markAttendance.mutate({ registrationId: reg.id, attended: true })}
                            className="gap-2"
                          >
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            Mark Attended
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => markAttendance.mutate({ registrationId: reg.id, attended: false })}
                            className="gap-2"
                          >
                            <XCircle className="w-4 h-4 text-red-500" />
                            Mark No Show
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void sendNotifyAllRegistrants()}
                            disabled={isSendingNotifyAll || notifyCooldownActive}
                            className="gap-2"
                          >
                            <Bell className="w-4 h-4" />
                            Notify all attendees
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer - Fixed */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            <span className="text-green-400 font-medium">{attendedCount}</span> of{' '}
            <span className="font-medium text-foreground">{totalCount}</span> attended
            {totalCount > 0 && (
              <span className="ml-1">
                ({Math.round(attendedCount / totalCount * 100)}%)
              </span>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminEventAttendeesModal;
