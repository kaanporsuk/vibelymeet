import { useState, useEffect, useMemo } from "react";
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
  UserMinus,
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
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { toast } from "sonner";
import { format } from "date-fns";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminTargetIdempotencyKey, type AdminRpcPayload } from "@/lib/adminRpc";

type AdminAttendeesEvent = {
  id: string;
  title: string;
  event_date: string;
};

type AttendeeProfile = {
  id: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  avatar_url: string | null;
  email_verified: boolean | null;
  photo_verified: boolean | null;
};

type EventRegistrationWithProfile = {
  id: string;
  registered_at: string;
  admission_status: string | null;
  attended: boolean | null;
  attendance_marked: boolean | null;
  profile_id: string | null;
  profiles: AttendeeProfile | null;
};

type AdminEventAttendeesPayload = AdminRpcPayload & {
  registrations?: EventRegistrationWithProfile[];
  total_count?: number;
};

interface AdminEventAttendeesModalProps {
  event: AdminAttendeesEvent;
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
  const [isRequestingReminder, setIsRequestingReminder] = useState(false);
  const [lastReminderRequestAt, setLastReminderRequestAt] = useState<number | null>(null);
  const [reminderCooldownBump, setReminderCooldownBump] = useState(0);
  const [confirmReminderOpen, setConfirmReminderOpen] = useState(false);
  const [registrationToRemove, setRegistrationToRemove] = useState<{ profileId: string; name: string } | null>(null);

  useEffect(() => {
    if (lastReminderRequestAt == null) return;
    const elapsed = Date.now() - lastReminderRequestAt;
    if (elapsed >= NOTIFY_ALL_COOLDOWN_MS) return;
    const t = setTimeout(() => setReminderCooldownBump((x) => x + 1), NOTIFY_ALL_COOLDOWN_MS - elapsed);
    return () => clearTimeout(t);
  }, [lastReminderRequestAt, reminderCooldownBump]);

  // Fetch event registrations with profile data
  const { data: registrations, isLoading } = useQuery({
    queryKey: ['admin-event-attendees', event.id, searchQuery],
    queryFn: async () => {
      const payload = await callAdminRpc<AdminEventAttendeesPayload>("admin_list_event_attendees", {
        p_event_id: event.id,
        p_search: searchQuery.trim() || null,
      });

      return payload.registrations ?? [];
    },
  });

  const removeRegistration = useMutation({
    mutationFn: async (profileId: string) => {
      const registration = registrations?.find((row) => row.profile_id === profileId) ?? null;
      await callAdminRpc("admin_remove_event_registration", {
        p_event_id: event.id,
        p_profile_id: profileId,
        p_reason: "Removed registration from /kaan attendees modal",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_remove_event_registration", {
          event_id: event.id,
          profile_id: profileId,
        }, {
          action: "remove",
          registration_id: registration?.id ?? null,
          admission_status: registration?.admission_status ?? null,
          registered_at: registration?.registered_at ?? null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-event-attendees", event.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      toast.success("Registration removed");
    },
    onError: () => {
      toast.error("Failed to remove registration");
    },
  });

  // Mark attendance mutation
  const markAttendance = useMutation({
    mutationFn: async ({ registrationId, attended }: { registrationId: string; attended: boolean }) => {
      const registration = registrations?.find((row) => row.id === registrationId) ?? null;
      return callAdminRpc<{ affected_count?: number }>("admin_mark_event_attendance", {
        p_event_id: event.id,
        p_registration_ids: [registrationId],
        p_attended: attended,
        p_reason: "Marked attendance from /kaan attendees modal",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_mark_event_attendance", {
          event_id: event.id,
          registration_id: registrationId,
        }, {
          action: attended ? "attended" : "not-attended",
          current_attendance_marked: registration?.attendance_marked ?? null,
          current_attended: registration?.attended ?? null,
        }),
      });
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
      const selectedSnapshot = selectedAttendees.map((registrationId) => {
        const registration = registrations?.find((row) => row.id === registrationId) ?? null;
        return {
          registration_id: registrationId,
          attendance_marked: registration?.attendance_marked ?? null,
          attended: registration?.attended ?? null,
        };
      });

      return callAdminRpc<{ affected_count?: number }>("admin_mark_event_attendance", {
        p_event_id: event.id,
        p_registration_ids: selectedAttendees,
        p_attended: attended,
        p_reason: "Bulk marked attendance from /kaan attendees modal",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_mark_event_attendance", {
          event_id: event.id,
          registration_ids: selectedAttendees,
        }, {
          action: attended ? "bulk-attended" : "bulk-not-attended",
          selected_snapshot: selectedSnapshot,
        }),
      });
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['admin-event-attendees', event.id] });
      const count = Number(payload.affected_count ?? selectedAttendees.length);
      setSelectedAttendees([]);
      toast.success(`Marked ${count} attendees`);
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

  const reminderCooldownActive =
    lastReminderRequestAt != null && Date.now() - lastReminderRequestAt < NOTIFY_ALL_COOLDOWN_MS;

  const requestEventReminder = async () => {
    if (reminderCooldownActive) {
      toast.message("Please wait 5 minutes between event reminder requests.");
      return;
    }
    setIsRequestingReminder(true);
    try {
      const payload = await callAdminRpc("admin_send_event_reminder", {
        p_event_id: event.id,
        p_reason: "Reminder requested from /kaan attendees modal",
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_send_event_reminder", event.id, {
          action: "attendees-reminder",
          reminder_window: Math.floor(Date.now() / NOTIFY_ALL_COOLDOWN_MS),
        }),
      });
      setLastReminderRequestAt(Date.now());
      toast.success("Reminder request recorded", {
        description: payload.notifications_not_queued
          ? "No user notifications were queued because the backend dispatcher is not connected for this reminder."
          : undefined,
      });
    } catch (error) {
      toast.error("Failed to record reminder request");
      throw error;
    } finally {
      setIsRequestingReminder(false);
    }
  };

  const exportAttendees = () => {
    if (!registrations?.length) return;

    const csvContent = [
      ['Name', 'Age', 'Gender', 'Registered', 'Admission', 'Attendance'].join(','),
      ...registrations.map(reg => {
        const profile = reg.profiles;
        const att = reg.attendance_marked
          ? (reg.attended ? 'Attended' : 'No Show')
          : 'Pending';
        return [
          profile?.name || 'Unknown',
          profile?.age || '',
          profile?.gender || '',
          format(new Date(reg.registered_at), 'yyyy-MM-dd HH:mm'),
          String(reg.admission_status ?? ''),
          att
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
  const filteredRegistrations = useMemo(() => registrations?.filter(reg => {
    if (!reg.attendance_marked && showPending) return true;
    if (reg.attendance_marked && reg.attended && showAttended) return true;
    if (reg.attendance_marked && !reg.attended && showNoShow) return true;
    return false;
  }), [registrations, showAttended, showNoShow, showPending]);

  useEffect(() => {
    setSelectedAttendees(prev => {
      if (prev.length === 0) return prev;
      const visible = new Set((filteredRegistrations ?? []).map(reg => reg.id));
      const next = prev.filter(id => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredRegistrations]);

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

      {/* Backend-owned event reminder request */}
      <div className="shrink-0 border-b border-border/50 bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 space-y-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Event reminder request
              </p>
              <p className="text-[11px] text-muted-foreground">
                Uses the backend admin reminder contract. The request is audited; no browser-side notification loop runs from this panel.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmReminderOpen(true)}
              disabled={isRequestingReminder || reminderCooldownActive}
              className="gap-1 self-start md:self-auto"
            >
              <Bell className="w-4 h-4" />
              {isRequestingReminder ? "Recording..." : "Record Reminder Request"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Current backend behavior may return “notifications not queued” until a dispatcher is connected. Use this as an audited operational request, not provider-delivery proof.
            5-minute cooldown between requests.
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
                const profile = reg.profiles;
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
                        {reg.admission_status === "waitlisted" && (
                          <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400">
                            Waitlist
                          </Badge>
                        )}
                        {reg.admission_status === "confirmed" && (
                          <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400">
                            Confirmed
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
                            onClick={() => {
                              if (!reg.profile_id) {
                                toast.error("Missing attendee profile");
                                return;
                              }
                              setRegistrationToRemove({
                                profileId: reg.profile_id,
                                name: profile?.name ?? "this user",
                              });
                            }}
                            disabled={removeRegistration.isPending}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            <UserMinus className="w-4 h-4" />
                            Remove registration
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
      <AdminConfirmDialog
        open={confirmReminderOpen}
        title={`Record reminder request for "${event.title}"?`}
        description="This calls admin_send_event_reminder. The backend validates admin access, records an audit log, and returns whether notification queueing happened. It does not run a browser-side loop and it does not prove provider delivery."
        confirmLabel="Record Request"
        variant="default"
        isPending={isRequestingReminder}
        onOpenChange={setConfirmReminderOpen}
        onConfirm={requestEventReminder}
      />
      <AdminConfirmDialog
        open={!!registrationToRemove}
        title={`Remove ${registrationToRemove?.name ?? "this user"} from this event?`}
        description="This calls admin_remove_event_registration. It removes the registration row, frees a confirmed seat when applicable, and may promote the waitlist according to backend rules."
        confirmLabel="Remove Registration"
        variant="destructive"
        isPending={removeRegistration.isPending}
        onOpenChange={(open) => {
          if (!open) setRegistrationToRemove(null);
        }}
        onConfirm={() => {
          if (registrationToRemove) return removeRegistration.mutateAsync(registrationToRemove.profileId);
        }}
      />
    </motion.div>
  );
};

export default AdminEventAttendeesModal;
