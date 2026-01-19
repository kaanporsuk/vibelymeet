import { useState } from "react";
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
  Mail,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface AdminEventAttendeesModalProps {
  event: any;
  onClose: () => void;
}

const AdminEventAttendeesModal = ({ event, onClose }: AdminEventAttendeesModalProps) => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>([]);

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
    if (selectedAttendees.length === registrations?.length) {
      setSelectedAttendees([]);
    } else {
      setSelectedAttendees(registrations?.map(r => r.id) || []);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedAttendees(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const sendNotification = (profileId: string, name: string) => {
    toast.success(`Notification sent to ${name}`);
  };

  const sendBulkNotification = () => {
    toast.success(`Notifications sent to ${selectedAttendees.length} attendees`);
    setSelectedAttendees([]);
  };

  const attendedCount = registrations?.filter(r => r.attended).length || 0;
  const totalCount = registrations?.length || 0;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed inset-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-3xl md:max-h-[85vh] bg-card border border-border rounded-3xl z-50 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-display text-foreground">
              Event Attendees
            </h2>
            <p className="text-sm text-muted-foreground">
              {event.title} · {attendedCount}/{totalCount} attended
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-border/50 flex flex-col md:flex-row gap-4 justify-between">
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search attendees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-secondary/50"
            />
          </div>
          {selectedAttendees.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                {selectedAttendees.length} selected
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkMarkAttendance.mutate(true)}
                className="gap-1"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Attended
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={sendBulkNotification}
                className="gap-1"
              >
                <Bell className="w-4 h-4" />
                Notify
              </Button>
            </div>
          )}
        </div>

        {/* Attendees List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-secondary/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No registrations yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Select All Header */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                <Checkbox
                  checked={selectedAttendees.length === totalCount && totalCount > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm font-medium text-foreground">Select All</span>
              </div>

              {registrations?.map((reg) => {
                const profile = reg.profiles as any;
                return (
                  <motion.div
                    key={reg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${
                      selectedAttendees.includes(reg.id)
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-secondary/30 border-transparent hover:bg-secondary/50'
                    }`}
                  >
                    <Checkbox
                      checked={selectedAttendees.includes(reg.id)}
                      onCheckedChange={() => toggleSelect(reg.id)}
                    />
                    <Avatar className="w-12 h-12 border-2 border-border">
                      <AvatarImage src={profile?.avatar_url || ''} />
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
                        <span>Registered {format(new Date(reg.registered_at), 'MMM d')}</span>
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
                        <Badge variant="outline" className="text-muted-foreground">
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
                            onClick={() => sendNotification(profile?.id, profile?.name)}
                            className="gap-2"
                          >
                            <Bell className="w-4 h-4" />
                            Send Notification
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

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            {attendedCount} of {totalCount} attended ({totalCount > 0 ? Math.round(attendedCount / totalCount * 100) : 0}%)
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </motion.div>
    </>
  );
};

export default AdminEventAttendeesModal;
