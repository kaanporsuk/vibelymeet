import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Edit, Trash2, Calendar, Users, Clock, Eye, MoreHorizontal,
  UserCheck, Upload, Archive, RotateCcw, Globe, MapPin, Flag, RefreshCw, CheckSquare, Square,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { toast } from "sonner";
import AdminEventFormModal from "./AdminEventFormModal";
import AdminEventAttendeesModal from "./AdminEventAttendeesModal";
import AdminEventControls from "./AdminEventControls";
import BatchEventImportModal from "./BatchEventImportModal";

// ── Helpers ───────────────────────────────────────────────────────────────────

const getComputedStatus = (event: any): string => {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.status === 'ended' || event.ended_at) return 'ended';
  if (event.status === 'draft') return 'draft';
  const now = new Date();
  const start = new Date(event.event_date);
  const end = new Date(start.getTime() + (event.duration_minutes || 60) * 60000);
  if (now >= start && now < end) return 'live';
  if (now >= end) return 'ended';
  return 'upcoming';
};

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  upcoming:  'bg-green-500/10 text-green-400 border-green-500/30',
  live:      'bg-pink-500/10 text-pink-400 border-pink-500/30 animate-pulse',
  ended:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
  completed: 'bg-muted/50 text-muted-foreground border-border',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/30',
};

const SCOPE_BADGE: Record<string, string> = {
  global:   '🌍 Global',
  regional: '🏳️ Regional',
  local:    '📍 Local',
};

const getRecurrenceSummary = (event: any): string => {
  switch (event.recurrence_type) {
    case 'weekly':    return `Every week`;
    case 'biweekly':  return `Every 2 weeks`;
    case 'monthly_day': return `Monthly on ${new Date(event.event_date).getDate()}`;
    case 'monthly_weekday': {
      const d = new Date(event.event_date);
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return `Monthly ${days[d.getDay()]}`;
    }
    case 'yearly': return `Yearly`;
    default: return '';
  }
};

// ── Component ─────────────────────────────────────────────────────────────────

const AdminEventsPanel = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [viewingAttendeesEvent, setViewingAttendeesEvent] = useState<any>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [groupBySeries, setGroupBySeries] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // Fetch events
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['admin-events', searchQuery, showArchived],
    queryFn: async () => {
      let query = supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: false });

      if (!showArchived) query = query.is('archived_at', null);
      if (searchQuery) query = query.ilike('title', `%${searchQuery}%`);

      const { data, error } = await query;
      if (error) throw error;

      // Auto-update stale statuses
      const staleIds = (data || [])
        .filter(e => {
          const end = new Date(new Date(e.event_date).getTime() + (e.duration_minutes || 60) * 60000);
          return new Date() > end && !['ended', 'completed', 'cancelled'].includes(e.status || '');
        })
        .map(e => e.id);

      if (staleIds.length > 0) {
        await supabase.from('events').update({ status: 'ended', ended_at: new Date().toISOString() }).in('id', staleIds);
      }

      // Auto-live events that have started but are still 'upcoming'
      const liveIds = (data || [])
        .filter(e => {
          const now2 = new Date();
          const start = new Date(e.event_date);
          const end = new Date(start.getTime() + (e.duration_minutes || 60) * 60000);
          return now2 >= start && now2 < end && e.status === 'upcoming';
        })
        .map(e => e.id);

      if (liveIds.length > 0) {
        await supabase.from('events').update({ status: 'live' }).in('id', liveIds);
      }

      return data || [];
    },
  });

  // Unique cities for filter
  const uniqueCities = useMemo(() =>
    [...new Set(events.filter(e => e.city).map(e => e.city as string))].sort(),
    [events]
  );

  // Filtered events
  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      const computed = getComputedStatus(event);
      if (statusFilter !== 'all' && computed !== statusFilter) return false;
      if (scopeFilter !== 'all' && (event.scope || 'global') !== scopeFilter) return false;
      if (cityFilter !== 'all' && event.city !== cityFilter) return false;
      if (dateFrom && new Date(event.event_date) < new Date(dateFrom)) return false;
      if (dateTo && new Date(event.event_date) > new Date(dateTo + 'T23:59')) return false;
      return true;
    });
  }, [events, statusFilter, scopeFilter, cityFilter, dateFrom, dateTo]);

  // Grouped by series
  const groupedEvents = useMemo(() => {
    if (!groupBySeries) return filteredEvents;

    const parents = filteredEvents.filter(e => e.is_recurring);
    const children = filteredEvents.filter(e => e.parent_event_id && !e.is_recurring);
    const singles = filteredEvents.filter(e => !e.is_recurring && !e.parent_event_id);
    const orphans = children.filter(c => !parents.find(p => p.id === c.parent_event_id));

    return [...parents, ...singles, ...orphans];
  }, [filteredEvents, groupBySeries]);

  const getChildrenOf = (parentId: string) =>
    filteredEvents.filter(e => e.parent_event_id === parentId);

  // Archive mutation
  const archiveEvent = useMutation({
    mutationFn: async ({ id, unarchive }: { id: string; unarchive?: boolean }) => {
      const { error } = await supabase.from('events').update({
        archived_at: unarchive ? null : new Date().toISOString(),
        archived_by: unarchive ? null : user?.id,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { unarchive }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success(unarchive ? 'Event unarchived' : 'Event archived');
    },
    onError: () => toast.error('Failed to update archive status'),
  });

  // Permanent delete
  const deleteEvent = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.from('events').delete().eq('id', eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success('Event permanently deleted');
    },
    onError: () => toast.error('Failed to delete event'),
  });

  // Archive entire series
  const archiveSeries = useMutation({
    mutationFn: async (parentId: string) => {
      const childIds = getChildrenOf(parentId).map(c => c.id);
      const allIds = [parentId, ...childIds];
      const { error } = await supabase.from('events').update({
        archived_at: new Date().toISOString(),
        archived_by: user?.id,
      }).in('id', allIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success('Entire series archived');
    },
  });

  // Bulk archive
  const bulkArchive = async () => {
    if (selectedIds.size === 0) return;
    const { error } = await supabase.from('events').update({
      archived_at: new Date().toISOString(),
      archived_by: user?.id,
    }).in('id', [...selectedIds]);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      setSelectedIds(new Set());
      toast.success(`${selectedIds.size} events archived`);
    }
  };

  // Generate more
  const generateMore = async (parentId: string, count: number) => {
    const { data, error } = await supabase.rpc('generate_recurring_events', { p_parent_id: parentId, p_count: count });
    if (error) { toast.error('Failed to generate occurrences'); return; }
    queryClient.invalidateQueries({ queryKey: ['admin-events'] });
    toast.success(`Generated ${data} new occurrences ✨`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEvents.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredEvents.map(e => e.id)));
  };

  const renderEventRow = (event: any, isChild = false) => {
    const computed = getComputedStatus(event);
    const isParent = event.is_recurring;
    const children = isParent ? getChildrenOf(event.id) : [];
    const isExpanded = expandedParents.has(event.id);

    return (
      <>
        <TableRow key={event.id} className={`border-border/50 hover:bg-secondary/30 ${event.archived_at ? 'opacity-60' : ''} ${isChild ? 'bg-secondary/10' : ''}`}>
          {/* Checkbox */}
          <TableCell className="w-10">
            <button type="button" onClick={() => toggleSelect(event.id)}>
              {selectedIds.has(event.id)
                ? <CheckSquare className="w-4 h-4 text-primary" />
                : <Square className="w-4 h-4 text-muted-foreground" />}
            </button>
          </TableCell>

          {/* Event */}
          <TableCell>
            <div className="flex items-center gap-3">
              <div className={`w-14 h-14 rounded-xl overflow-hidden bg-secondary/50 shrink-0 ${isChild ? 'ml-4' : ''}`}>
                <img src={event.cover_image} alt={event.title} className="w-full h-full object-cover" />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-medium text-foreground text-sm truncate max-w-[180px]">{event.title}</p>
                  {isParent && <Badge variant="secondary" className="text-[10px] shrink-0">🔁 Recurring</Badge>}
                  {event.parent_event_id && <span className="text-[10px] text-muted-foreground">#{event.occurrence_number}</span>}
                  {event.archived_at && <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-400">Archived</Badge>}
                </div>
                {isParent && (
                  <p className="text-xs text-muted-foreground">{getRecurrenceSummary(event)}</p>
                )}
                {groupBySeries && isParent && children.length > 0 && (
                  <button type="button" onClick={() => setExpandedParents(prev => {
                    const n = new Set(prev); n.has(event.id) ? n.delete(event.id) : n.add(event.id); return n;
                  })} className="text-xs text-primary hover:underline">
                    {isExpanded ? 'Hide' : `Show ${children.length} occurrences`}
                  </button>
                )}
                <AdminEventControls
                  eventId={event.id} eventTitle={event.title}
                  eventStatus={event.status} durationMinutes={event.duration_minutes}
                />
              </div>
            </div>
          </TableCell>

          {/* Date */}
          <TableCell>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm text-foreground">{format(new Date(event.event_date), 'MMM d, yyyy')}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(event.event_date), 'h:mm a')}</p>
              </div>
            </div>
          </TableCell>

          {/* Duration */}
          <TableCell>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />{event.duration_minutes || 60}m
            </div>
          </TableCell>

          {/* Attendees */}
          <TableCell>
            <div className="flex items-center gap-1 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground">{event.current_attendees || 0}</span>
              <span className="text-muted-foreground">/ {event.max_attendees || 50}</span>
            </div>
          </TableCell>

          {/* City */}
          <TableCell>
            <span className="text-sm text-muted-foreground">
              {event.city || (event.scope === 'regional' ? `🏳️ ${event.country || '—'}` : '🌍 Global')}
            </span>
          </TableCell>

          {/* Scope */}
          <TableCell>
            <Badge variant="outline" className="text-xs border-border whitespace-nowrap">
              {SCOPE_BADGE[event.scope || 'global']}
              {event.scope === 'local' && event.radius_km ? ` ${event.radius_km}km` : ''}
            </Badge>
          </TableCell>

          {/* Status */}
          <TableCell>
            <Badge variant="outline" className={`text-xs ${STATUS_STYLES[computed] || STATUS_STYLES.upcoming}`}>
              {computed}
            </Badge>
          </TableCell>

          {/* Actions */}
          <TableCell className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border">
                <DropdownMenuItem onClick={() => setEditingEvent(event)} className="gap-2">
                  <Edit className="w-4 h-4" />Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setViewingAttendeesEvent(event)} className="gap-2">
                  <UserCheck className="w-4 h-4" />Attendees
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/events/${event.id}`, '_blank')} className="gap-2">
                  <Eye className="w-4 h-4" />View
                </DropdownMenuItem>

                {isParent && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => generateMore(event.id, 4)} className="gap-2">
                      <RefreshCw className="w-4 h-4" />Generate 4 more
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />

                {event.archived_at ? (
                  <>
                    <DropdownMenuItem onClick={() => archiveEvent.mutate({ id: event.id, unarchive: true })} className="gap-2">
                      <RotateCcw className="w-4 h-4" />Unarchive
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (confirm('PERMANENTLY DELETE this event and ALL its data? This cannot be undone.')) {
                          if (confirm('Are you absolutely sure? All registrations, sessions, and matches will be lost.')) {
                            deleteEvent.mutate(event.id);
                          }
                        }
                      }}
                      className="gap-2 text-destructive focus:text-destructive">
                      <Trash2 className="w-4 h-4" />Delete Permanently
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    {isParent && (
                      <DropdownMenuItem onClick={() => {
                        if (confirm('Archive the entire series? Parent + all future occurrences will be hidden from users.')) {
                          archiveSeries.mutate(event.id);
                        }
                      }} className="gap-2 text-orange-400 focus:text-orange-400">
                        <Archive className="w-4 h-4" />Archive Series
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => {
                      if (confirm('Archive this event? It will be hidden from users but all data will be preserved.')) {
                        archiveEvent.mutate({ id: event.id });
                      }
                    }} className="gap-2 text-muted-foreground">
                      <Archive className="w-4 h-4" />Archive
                    </DropdownMenuItem>

                    {/* Delete — only for draft or cancelled events */}
                    {(['draft', 'cancelled'].includes(computed)) && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (confirm(`Permanently delete "${event.title}"? This cannot be undone. All registrations and related data will be removed.`)) {
                            deleteEvent.mutate(event.id);
                          }
                        }}
                        className="gap-2 text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />Delete
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>

        {/* Expanded children */}
        {groupBySeries && isParent && isExpanded && children.map(child => renderEventRow(child, true))}
      </>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="flex-1 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input placeholder="Search events..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-11 bg-secondary/50" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowBatchImport(true)} className="gap-2">
            <Upload className="w-5 h-5" />Batch Import
          </Button>
          <Button onClick={() => setShowCreateModal(true)} className="bg-gradient-to-r from-primary to-accent gap-2">
            <Plus className="w-5 h-5" />Create Event
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center p-3 rounded-xl bg-secondary/20 border border-border">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-8 text-xs bg-secondary/50"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {['all','live','upcoming','ended','cancelled','draft'].map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-32 h-8 text-xs bg-secondary/50"><SelectValue placeholder="Scope" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scopes</SelectItem>
            <SelectItem value="global">🌍 Global</SelectItem>
            <SelectItem value="regional">🏳️ Regional</SelectItem>
            <SelectItem value="local">📍 Local</SelectItem>
          </SelectContent>
        </Select>

        {uniqueCities.length > 0 && (
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-secondary/50"><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cities</SelectItem>
              {uniqueCities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-1">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="h-8 text-xs w-36 bg-secondary/50" placeholder="From" />
          <span className="text-muted-foreground text-xs">–</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="h-8 text-xs w-36 bg-secondary/50" placeholder="To" />
        </div>

        <div className="flex items-center gap-2">
          <Switch id="showArchived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="showArchived" className="text-xs text-muted-foreground">Show archived</Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="groupSeries" checked={groupBySeries} onCheckedChange={setGroupBySeries} />
          <Label htmlFor="groupSeries" className="text-xs text-muted-foreground">Group by series</Label>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={bulkArchive} className="gap-1 h-7 text-xs">
            <Archive className="w-3 h-3" />Archive All
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="h-7 text-xs text-muted-foreground">
            Clear
          </Button>
        </motion.div>
      )}

      {/* Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-10">
                  <button type="button" onClick={toggleSelectAll}>
                    {selectedIds.size === filteredEvents.length && filteredEvents.length > 0
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </TableHead>
                <TableHead className="w-[260px]">Event</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Attendees</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell colSpan={9}>
                      <div className="h-16 bg-secondary/50 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : groupedEvents.length === 0 ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No events found
                  </TableCell>
                </TableRow>
              ) : (
                groupedEvents.map(event => renderEventRow(event))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {(showCreateModal || editingEvent) && (
          <AdminEventFormModal event={editingEvent} onClose={() => { setShowCreateModal(false); setEditingEvent(null); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {viewingAttendeesEvent && (
          <AdminEventAttendeesModal event={viewingAttendeesEvent} onClose={() => setViewingAttendeesEvent(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showBatchImport && <BatchEventImportModal onClose={() => setShowBatchImport(false)} />}
      </AnimatePresence>
    </motion.div>
  );
};

export default AdminEventsPanel;
