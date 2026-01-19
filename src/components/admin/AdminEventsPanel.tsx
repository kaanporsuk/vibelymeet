import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Calendar,
  Users,
  Clock,
  Eye,
  MoreHorizontal,
  X,
  UserCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import AdminEventFormModal from "./AdminEventFormModal";
import AdminEventAttendeesModal from "./AdminEventAttendeesModal";

const AdminEventsPanel = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [viewingAttendeesEvent, setViewingAttendeesEvent] = useState<any>(null);
  // Fetch all events
  const { data: events, isLoading } = useQuery({
    queryKey: ['admin-events', searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: false });

      if (searchQuery) {
        query = query.ilike('title', `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Delete event mutation
  const deleteEvent = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success('Event deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete event');
    },
  });

  const getStatusBadge = (status: string | null, eventDate: string) => {
    const isUpcoming = new Date(eventDate) > new Date();
    const actualStatus = status || (isUpcoming ? 'upcoming' : 'completed');
    
    const statusStyles: Record<string, string> = {
      upcoming: 'bg-green-500/10 text-green-400 border-green-500/30',
      live: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
      completed: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
      cancelled: 'bg-red-500/10 text-red-400 border-red-500/30',
    };

    return (
      <Badge variant="outline" className={statusStyles[actualStatus] || statusStyles.upcoming}>
        {actualStatus}
      </Badge>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="flex-1 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-11 bg-secondary/50"
          />
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          className="bg-gradient-to-r from-primary to-accent gap-2"
        >
          <Plus className="w-5 h-5" />
          Create Event
        </Button>
      </div>

      {/* Events Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-[300px]">Event</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Attendees</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell colSpan={7}>
                      <div className="h-16 bg-secondary/50 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : events?.length === 0 ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No events found
                  </TableCell>
                </TableRow>
              ) : (
                events?.map((event) => (
                  <TableRow key={event.id} className="border-border/50 hover:bg-secondary/30">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-secondary/50">
                          <img
                            src={event.cover_image}
                            alt={event.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{event.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2 max-w-[200px]">
                            {event.description}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm text-foreground">
                            {format(new Date(event.event_date), 'MMM d, yyyy')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(event.event_date), 'h:mm a')}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        {event.duration_minutes} min
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-foreground">{event.current_attendees || 0}</span>
                        <span className="text-muted-foreground">/ {event.max_attendees || 50}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[150px]">
                        {event.tags?.slice(0, 2).map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {event.tags?.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{event.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(event.status, event.event_date)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-card border-border">
                          <DropdownMenuItem
                            onClick={() => setEditingEvent(event)}
                            className="gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setViewingAttendeesEvent(event)}
                            className="gap-2"
                          >
                            <UserCheck className="w-4 h-4" />
                            Attendees
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => window.open(`/events/${event.id}`, '_blank')}
                            className="gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this event?')) {
                                deleteEvent.mutate(event.id);
                              }
                            }}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || editingEvent) && (
          <AdminEventFormModal
            event={editingEvent}
            onClose={() => {
              setShowCreateModal(false);
              setEditingEvent(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Attendees Modal */}
      <AnimatePresence>
        {viewingAttendeesEvent && (
          <AdminEventAttendeesModal
            event={viewingAttendeesEvent}
            onClose={() => setViewingAttendeesEvent(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AdminEventsPanel;