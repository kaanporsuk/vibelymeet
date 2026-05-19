import { useEffect, useState, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { eventCoverThumbUrl } from "@/utils/imageUrl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Edit, Trash2, Calendar, Users, Clock, Eye, MoreHorizontal,
  UserCheck, Upload, Archive, RotateCcw, RefreshCw, CheckSquare, Square,
  Ban, StopCircle, ChevronDown, ChevronUp, Loader2,
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
import { format } from "date-fns";
import { toast } from "sonner";
import AdminEventFormModal from "./AdminEventFormModal";
import AdminEventAttendeesModal from "./AdminEventAttendeesModal";
import AdminEventControls from "./AdminEventControls";
import BatchEventImportModal from "./BatchEventImportModal";
import { resolveEventLifecycle } from "@/lib/eventLifecycle";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminIdempotencyKey } from "@/lib/adminRpc";
import { supabase } from "@/integrations/supabase/client";
import { useEventCategories, type EventCategory } from "@/hooks/useEventCategories";

// ── Helpers ───────────────────────────────────────────────────────────────────

type AdminEventRow = {
  id: string;
  title: string;
  description?: string | null;
  cover_image: string | null;
  cover_media_asset_id?: string | null;
  event_date: string;
  duration_minutes: number | null;
  current_attendees: number | null;
  max_attendees: number | null;
  status: string | null;
  ended_at?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  city?: string | null;
  country?: string | null;
  scope?: "global" | "regional" | "local" | null;
  radius_km?: number | null;
  is_recurring?: boolean | null;
  parent_event_id?: string | null;
  occurrence_number?: number | null;
  recurrence_type?: "weekly" | "biweekly" | "monthly_day" | "monthly_weekday" | "yearly" | null;
  category_keys?: string[] | null;
  tags?: string[] | null;
  vibes?: string[] | null;
};

type AdminEventsPayload = {
  events?: AdminEventRow[];
  total_count?: number;
};

type PendingEventPanelAction =
  | { kind: "generate-more"; event: AdminEventRow; count: number }
  | { kind: "archive"; event: AdminEventRow }
  | { kind: "unarchive"; event: AdminEventRow }
  | { kind: "archive-series"; event: AdminEventRow; childCount: number }
  | { kind: "finalize-repair"; event: AdminEventRow }
  | { kind: "bulk-archive"; count: number }
  | null;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const getLifecycleSnapshot = (event: AdminEventRow, nowMs = Date.now()) => {
  return resolveEventLifecycle({
    status: event.status,
    event_date: event.event_date,
    duration_minutes: event.duration_minutes,
    ended_at: event.ended_at,
    archived_at: event.archived_at,
    nowMs,
  });
};

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  upcoming:  'bg-green-500/10 text-green-400 border-green-500/30',
  live:      'bg-pink-500/10 text-pink-400 border-pink-500/30 animate-pulse',
  ended:     'bg-orange-500/10 text-orange-400 border-orange-500/30',
  completed: 'bg-muted/50 text-muted-foreground border-border',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/30',
  archived: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  wrap_up_grace: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  needs_finalization_repair: 'bg-red-500/10 text-red-300 border-red-500/30',
};

const getAdminStatusDisplay = (event: AdminEventRow, nowMs = Date.now()): string => {
  const lifecycle = getLifecycleSnapshot(event, nowMs);
  if (lifecycle.isArchived) return "archived";
  if (lifecycle.needsFinalizationRepair) return "needs_finalization_repair";
  if (lifecycle.isInFinalizationGrace) return "wrap_up_grace";
  return lifecycle.lifecycle;
};

const formatStatusFilterLabel = (status: string): string => {
  if (status === "all") return "All Statuses";
  if (status === "wrap_up_grace") return "Wrap-up";
  if (status === "needs_finalization_repair") return "Needs repair";
  if (status === "archived") return "Archived";
  return status;
};

const SCOPE_BADGE: Record<string, string> = {
  global:   '🌍 Global',
  regional: '🏳️ Regional',
  local:    '📍 Local',
};

const getRecurrenceSummary = (event: AdminEventRow): string => {
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

type CategoryUpdateInput = {
  categoryKey: string;
  label?: string;
  emoji?: string;
  active?: boolean;
  sortOrder?: number;
};

type CategoryCreateInput = {
  label: string;
  emoji: string;
  active: boolean;
  sortOrder: number;
};

function parseCategorySortOrder(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type AdminEventCategoryRowProps = {
  category: EventCategory;
  isPending: boolean;
  onSave: (input: CategoryUpdateInput) => void;
  onToggleActive: (category: EventCategory) => void;
};

const AdminEventCategoryRow = ({
  category,
  isPending,
  onSave,
  onToggleActive,
}: AdminEventCategoryRowProps) => {
  const [emoji, setEmoji] = useState(category.emoji);
  const [label, setLabel] = useState(category.label);
  const [sortOrder, setSortOrder] = useState(String(category.sort_order ?? ""));

  useEffect(() => {
    setEmoji(category.emoji);
    setLabel(category.label);
    setSortOrder(String(category.sort_order ?? ""));
  }, [category.emoji, category.label, category.sort_order]);

  const normalizedSortOrder = parseCategorySortOrder(sortOrder);
  const isDirty =
    emoji.trim() !== category.emoji ||
    label.trim() !== category.label ||
    normalizedSortOrder !== (category.sort_order ?? undefined);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[72px_minmax(180px,1fr)_96px_120px_92px] gap-2 items-center rounded-lg border border-border/60 bg-secondary/20 p-2">
      <Input
        value={emoji}
        onChange={(event) => setEmoji(event.target.value)}
        className="h-9 bg-background/70 text-center"
        aria-label={`${category.label} emoji`}
        maxLength={8}
      />
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        className="h-9 bg-background/70"
        aria-label={`${category.label} label`}
      />
      <Input
        type="number"
        value={sortOrder}
        onChange={(event) => setSortOrder(event.target.value)}
        className="h-9 bg-background/70"
        aria-label={`${category.label} sort order`}
      />
      <div className="flex items-center gap-2">
        <Switch
          checked={category.active !== false}
          onCheckedChange={() => onToggleActive(category)}
          disabled={isPending}
          aria-label={`${category.active === false ? "Activate" : "Deactivate"} ${category.label}`}
        />
        <span className="text-xs text-muted-foreground">
          {category.active === false ? "Inactive" : "Active"}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!isDirty || isPending || !label.trim() || !emoji.trim()}
        onClick={() => onSave({
          categoryKey: category.key,
          label: label.trim(),
          emoji: emoji.trim(),
          sortOrder: normalizedSortOrder,
        })}
      >
        Save
      </Button>
    </div>
  );
};

type AdminEventCategoryCreateRowProps = {
  defaultSortOrder: number;
  isPending: boolean;
  onCancel: () => void;
  onSave: (input: CategoryCreateInput) => void;
};

const AdminEventCategoryCreateRow = ({
  defaultSortOrder,
  isPending,
  onCancel,
  onSave,
}: AdminEventCategoryCreateRowProps) => {
  const [emoji, setEmoji] = useState("✨");
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState(String(defaultSortOrder));
  const [active, setActive] = useState(true);
  const normalizedSortOrder = parseCategorySortOrder(sortOrder);
  const canSave = !!label.trim() && !!emoji.trim() && normalizedSortOrder !== undefined;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[72px_minmax(180px,1fr)_96px_120px_160px] gap-2 items-center rounded-lg border border-primary/40 bg-primary/10 p-2">
      <Input
        value={emoji}
        onChange={(event) => setEmoji(event.target.value)}
        className="h-9 bg-background/70 text-center"
        aria-label="New category emoji"
        maxLength={8}
      />
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        className="h-9 bg-background/70"
        aria-label="New category label"
        placeholder="Category name"
      />
      <Input
        type="number"
        value={sortOrder}
        onChange={(event) => setSortOrder(event.target.value)}
        className="h-9 bg-background/70"
        aria-label="New category sort order"
      />
      <div className="flex items-center gap-2">
        <Switch
          checked={active}
          onCheckedChange={setActive}
          disabled={isPending}
          aria-label={`${active ? "Deactivate" : "Activate"} new category`}
        />
        <span className="text-xs text-muted-foreground">
          {active ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canSave || isPending}
          onClick={() => {
            if (normalizedSortOrder === undefined) return;
            onSave({
              label: label.trim(),
              emoji: emoji.trim(),
              active,
              sortOrder: normalizedSortOrder,
            });
          }}
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
};

const AdminEventCategoryManager = () => {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading } = useEventCategories({ includeInactive: true });
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateRow, setShowCreateRow] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const activeCategoryCount = categories.filter((category) => category.active !== false).length;
  const defaultSortOrder = useMemo(
    () => categories.reduce((max, category) => Math.max(max, category.sort_order ?? 0), 0) + 10,
    [categories],
  );

  const invalidateCategorySurfaces = () => {
    queryClient.invalidateQueries({ queryKey: ["event-categories"] });
    queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    queryClient.invalidateQueries({ queryKey: ["visible-events"] });
    queryClient.invalidateQueries({ queryKey: ["events-discover"] });
  };

  const updateCategory = useMutation({
    mutationFn: async (input: CategoryUpdateInput) => {
      setPendingKey(input.categoryKey);
      return callAdminRpc("admin_update_event_category", {
        p_category_key: input.categoryKey,
        p_label: input.label ?? null,
        p_emoji: input.emoji ?? null,
        p_active: input.active ?? null,
        p_sort_order: input.sortOrder ?? null,
      });
    },
    onSuccess: () => {
      invalidateCategorySurfaces();
      toast.success("Category updated");
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to update category"));
    },
    onSettled: () => setPendingKey(null),
  });

  const createCategory = useMutation({
    mutationFn: async (input: CategoryCreateInput) => {
      return callAdminRpc<{ category: { key: string } }>("admin_create_event_category", {
        p_label: input.label,
        p_emoji: input.emoji,
        p_sort_order: input.sortOrder,
        p_active: input.active,
      });
    },
    onSuccess: () => {
      invalidateCategorySurfaces();
      setShowCreateRow(false);
      toast.success("Category created");
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to create category"));
    },
  });

  return (
    <div className="rounded-2xl border border-border bg-secondary/10 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Event Categories</h3>
          <p className="text-xs text-muted-foreground">
            Active categories appear in user filters and the admin event form. Existing events keep inactive category keys for history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="w-fit border-border">
            {activeCategoryCount} active
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((open) => !open)}
            className="gap-2"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {isOpen ? "Hide categories" : "Show categories"}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-2">
          {isLoading ? (
            <div className="h-20 rounded-lg bg-secondary/40 animate-pulse" />
          ) : (
            <>
              {categories.length === 0 ? (
                <p className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-4 text-sm text-muted-foreground">
                  No categories found. Add one below.
                </p>
              ) : (
                categories.map((category) => (
                  <AdminEventCategoryRow
                    key={category.key}
                    category={category}
                    isPending={updateCategory.isPending && pendingKey === category.key}
                    onSave={(input) => updateCategory.mutate(input)}
                    onToggleActive={(item) => updateCategory.mutate({
                      categoryKey: item.key,
                      active: item.active === false,
                    })}
                  />
                ))
              )}

              {showCreateRow ? (
                <AdminEventCategoryCreateRow
                  defaultSortOrder={defaultSortOrder}
                  isPending={createCategory.isPending}
                  onCancel={() => setShowCreateRow(false)}
                  onSave={(input) => createCategory.mutate(input)}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateRow(true)}
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add category
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

const AdminEventsPanel = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AdminEventRow | null>(null);
  const [viewingAttendeesEvent, setViewingAttendeesEvent] = useState<AdminEventRow | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [groupBySeries, setGroupBySeries] = useState(false);
  const [lifecycleNowMs, setLifecycleNowMs] = useState(() => Date.now());
  const [pendingEventAction, setPendingEventAction] = useState<PendingEventPanelAction>(null);
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);
  const [isGeneratingOccurrences, setIsGeneratingOccurrences] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const intervalId = window.setInterval(() => setLifecycleNowMs(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (searchParams.get("create") !== "event") return;
    setShowCreateModal(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("create");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const broadcastEventEnded = (eventId: string) => {
    const channel = supabase.channel(`event-status-${eventId}`);
    void channel
      .send({
        type: "broadcast",
        event: "event_ended",
        payload: { eventId },
      })
      .catch(() => undefined)
      .finally(() => {
        void supabase.removeChannel(channel);
      });
  };

  // Fetch events
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['admin-events', searchQuery, showArchived],
    queryFn: async () => {
      const payload = await callAdminRpc<AdminEventsPayload>("admin_list_events", {
        p_filters: {
          search: searchQuery.trim() || null,
          show_archived: showArchived,
        },
        p_limit: 1000,
        p_offset: 0,
      });

      return payload.events ?? [];
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
      const statusDisplay = getAdminStatusDisplay(event, lifecycleNowMs);
      if (statusFilter !== 'all' && statusDisplay !== statusFilter) return false;
      if (scopeFilter !== 'all' && (event.scope || 'global') !== scopeFilter) return false;
      if (cityFilter !== 'all' && event.city !== cityFilter) return false;
      if (dateFrom && new Date(event.event_date) < new Date(dateFrom)) return false;
      if (dateTo && new Date(event.event_date) > new Date(dateTo + 'T23:59')) return false;
      return true;
    });
  }, [events, lifecycleNowMs, statusFilter, scopeFilter, cityFilter, dateFrom, dateTo]);

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

  const visibleEventIds = useMemo(() => {
    const ids: string[] = [];
    for (const event of groupedEvents) {
      ids.push(event.id);
      if (groupBySeries && event.is_recurring && expandedParents.has(event.id)) {
        ids.push(...filteredEvents.filter(child => child.parent_event_id === event.id).map(child => child.id));
      }
    }
    return ids;
  }, [expandedParents, filteredEvents, groupBySeries, groupedEvents]);

  const allVisibleSelected =
    visibleEventIds.length > 0 && visibleEventIds.every(id => selectedIds.has(id));

  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleEventIds);
      const next = new Set([...prev].filter(id => visible.has(id)));
      if (next.size === prev.size && [...prev].every(id => next.has(id))) return prev;
      return next;
    });
  }, [visibleEventIds]);

  // Archive mutation
  const archiveEvent = useMutation({
    mutationFn: async ({ id, unarchive }: { id: string; unarchive?: boolean }) => {
      await callAdminRpc(unarchive ? "admin_unarchive_event" : "admin_archive_event", {
        p_event_id: id,
        p_reason: unarchive ? "Unarchived from /kaan dashboard" : "Archived from /kaan dashboard",
        p_idempotency_key: createAdminIdempotencyKey(unarchive ? "admin_unarchive_event" : "admin_archive_event"),
      });
    },
    onSuccess: (_, { unarchive }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success(unarchive ? 'Event unarchived' : 'Event archived');
    },
    onError: () => toast.error('Failed to update archive status'),
  });

  const deleteEvent = useMutation({
    mutationFn: async (eventId: string) => {
      await callAdminRpc('admin_delete_event', {
        p_event_id: eventId,
        p_reason: "Permanently deleted from /kaan dashboard",
        p_idempotency_key: createAdminIdempotencyKey("admin_delete_event"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success('Event permanently deleted');
    },
    onError: (err: unknown) => toast.error(`Failed to delete: ${errorMessage(err, "delete_failed")}`),
  });

  const cancelEvent = useMutation({
    mutationFn: async ({ eventId, title }: { eventId: string; title: string }) => {
      return callAdminRpc('admin_cancel_event', {
        p_event_id: eventId,
        p_reason: `Cancelled from /kaan dashboard: ${title}`,
        p_idempotency_key: createAdminIdempotencyKey("admin_cancel_event"),
      });
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success("Event cancelled", {
        description: payload.notifications_not_queued
          ? "Backend lifecycle update succeeded. User cancellation notifications were not queued by the event lifecycle backend."
          : undefined,
      });
    },
    onError: (err: unknown) => toast.error(errorMessage(err, 'Failed to cancel event')),
  });

  const finalizeRepairEvent = useMutation({
    mutationFn: async (event: AdminEventRow) => {
      await callAdminRpc("admin_end_event", {
        p_event_id: event.id,
        p_reason: "Finalization repair from /kaan dashboard",
        p_idempotency_key: createAdminIdempotencyKey("admin_end_event"),
      });
      return event;
    },
    onSuccess: (event) => {
      broadcastEventEnded(event.id);
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['visible-events'] });
      toast.success(`Finalized "${event.title}"`);
    },
    onError: (err: unknown) => toast.error(errorMessage(err, "Failed to finalize event")),
  });

  // Archive entire series
  const archiveSeries = useMutation({
    mutationFn: async (parentId: string) => {
      await callAdminRpc("admin_archive_event_series", {
        p_parent_event_id: parentId,
        p_reason: "Archived recurring series from /kaan dashboard",
        p_idempotency_key: createAdminIdempotencyKey("admin_archive_event_series"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success('Entire series archived');
    },
    onError: () => toast.error('Failed to archive series'),
  });

  // Bulk archive
  const bulkArchive = async () => {
    const eventIds = [...selectedIds];
    if (eventIds.length === 0) return;
    setIsBulkArchiving(true);
    try {
      await callAdminRpc("admin_bulk_archive_events", {
        p_event_ids: eventIds,
        p_reason: "Bulk archived from /kaan dashboard",
        p_idempotency_key: createAdminIdempotencyKey("admin_bulk_archive_events"),
      });
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      setSelectedIds(new Set());
      toast.success(`${eventIds.length} events archived`);
    } finally {
      setIsBulkArchiving(false);
    }
  };

  // Generate more
  const generateMore = async (parentId: string, count: number) => {
    setIsGeneratingOccurrences(true);
    try {
      const data = await callAdminRpc("admin_generate_recurring_events", {
        p_parent_event_id: parentId,
        p_count: count,
        p_idempotency_key: createAdminIdempotencyKey("admin_generate_recurring_events"),
      });
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success(`Generated ${Number(data.generated_count || 0)} new occurrences`);
    } finally {
      setIsGeneratingOccurrences(false);
    }
  };

  const getPendingActionCopy = () => {
    switch (pendingEventAction?.kind) {
      case "generate-more":
        return {
          title: `Generate ${pendingEventAction.count} more occurrences?`,
          description: `This calls admin_generate_recurring_events for "${pendingEventAction.event.title}". The backend validates admin access, recurrence bounds, duplicate protection, and writes an audit log. It does not notify users.`,
          confirmLabel: "Generate Occurrences",
          variant: "default" as const,
        };
      case "archive":
        return {
          title: `Archive "${pendingEventAction.event.title}"?`,
          description: "This calls admin_archive_event. The backend writes archived_at/archived_by and an admin audit log in one transaction.",
          confirmLabel: "Archive Event",
          variant: "destructive" as const,
        };
      case "unarchive":
        return {
          title: `Unarchive "${pendingEventAction.event.title}"?`,
          description: "This calls admin_unarchive_event. The backend clears archived_at/archived_by, repairs legacy status-only archived rows, and writes an admin audit log.",
          confirmLabel: "Unarchive Event",
          variant: "default" as const,
        };
      case "archive-series":
        return {
          title: `Archive recurring series "${pendingEventAction.event.title}"?`,
          description: `This calls admin_archive_event_series for the parent event and backend-discovered occurrences. ${pendingEventAction.childCount} loaded occurrence${pendingEventAction.childCount === 1 ? "" : "s"} are visible in the current filtered view.`,
          confirmLabel: "Archive Series",
          variant: "destructive" as const,
        };
      case "finalize-repair":
        return {
          title: `Finalize "${pendingEventAction.event.title}" now?`,
          description: "This is a repair action for an event whose scheduled end plus the 10 minute grace has passed but ended_at is still missing. It calls admin_end_event and records the lifecycle finalization.",
          confirmLabel: "Finalize now",
          variant: "destructive" as const,
        };
      case "bulk-archive":
        return {
          title: `Archive ${pendingEventAction.count} selected event${pendingEventAction.count === 1 ? "" : "s"}?`,
          description: "This calls admin_bulk_archive_events for the selected loaded event IDs. The backend writes archive fields and one audit log.",
          confirmLabel: "Archive Selected",
          variant: "destructive" as const,
        };
      default:
        return { title: "", description: "", confirmLabel: "Confirm", variant: "destructive" as const };
    }
  };

  const confirmPendingEventAction = async () => {
    if (!pendingEventAction) return;
    if (pendingEventAction.kind === "generate-more") {
      return generateMore(pendingEventAction.event.id, pendingEventAction.count);
    }
    if (pendingEventAction.kind === "archive") {
      return archiveEvent.mutateAsync({ id: pendingEventAction.event.id });
    }
    if (pendingEventAction.kind === "unarchive") {
      return archiveEvent.mutateAsync({ id: pendingEventAction.event.id, unarchive: true });
    }
    if (pendingEventAction.kind === "archive-series") {
      return archiveSeries.mutateAsync(pendingEventAction.event.id);
    }
    if (pendingEventAction.kind === "finalize-repair") {
      return finalizeRepairEvent.mutateAsync(pendingEventAction.event);
    }
    return bulkArchive();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleEventIds));
  };

  const renderEventRow = (event: AdminEventRow, isChild = false): ReactNode => {
    const lifecycle = getLifecycleSnapshot(event, lifecycleNowMs);
    const computed = lifecycle.lifecycle;
    const statusDisplay = lifecycle.needsFinalizationRepair
      ? "needs_finalization_repair"
      : lifecycle.isInFinalizationGrace
        ? "wrap_up_grace"
        : computed;
    const statusLabel = statusDisplay === "needs_finalization_repair"
      ? "needs repair"
      : statusDisplay === "wrap_up_grace"
        ? "wrap-up"
        : computed;
    const isParent = event.is_recurring;
    const children = isParent ? getChildrenOf(event.id) : [];
    const isExpanded = expandedParents.has(event.id);
    const rawStatus = event.status?.toLowerCase() || '';
    const isArchived = lifecycle.isArchived;
    const canEdit =
      !isArchived &&
      !event.ended_at &&
      !lifecycle.isEnded &&
      !['ended', 'completed'].includes(rawStatus);
    const canCancel =
      !isArchived &&
      !event.ended_at &&
      computed !== 'ended' &&
      !['cancelled', 'draft', 'completed'].includes(rawStatus);

    return (
      <>
        <TableRow key={event.id} className={`border-border/50 hover:bg-secondary/30 ${isArchived ? 'opacity-60' : ''} ${isChild ? 'bg-secondary/10' : ''}`}>
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
                <img src={eventCoverThumbUrl(event.cover_image)} alt={event.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-medium text-foreground text-sm truncate max-w-[180px]">{event.title}</p>
                  {isParent && <Badge variant="secondary" className="text-[10px] shrink-0">🔁 Recurring</Badge>}
                  {event.parent_event_id && <span className="text-[10px] text-muted-foreground">#{event.occurrence_number}</span>}
                  {isArchived && <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-400">Archived</Badge>}
                </div>
                {isParent && (
                  <p className="text-xs text-muted-foreground">{getRecurrenceSummary(event)}</p>
                )}
                {groupBySeries && isParent && children.length > 0 && (
                  <button type="button" onClick={() => setExpandedParents(prev => {
                    const n = new Set(prev);
                    if (n.has(event.id)) n.delete(event.id);
                    else n.add(event.id);
                    return n;
                  })} className="text-xs text-primary hover:underline">
                    {isExpanded ? 'Hide' : `Show ${children.length} occurrences`}
                  </button>
                )}
                <AdminEventControls
                  eventId={event.id} eventTitle={event.title}
                  rawStatus={event.status}
                  computedStatus={computed}
                  endedAt={event.ended_at}
                  archivedAt={event.archived_at}
                  isInFinalizationGrace={lifecycle.isInFinalizationGrace}
                  autoFinalizeAt={lifecycle.autoFinalizeAt}
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
            <Badge variant="outline" className={`text-xs ${STATUS_STYLES[statusDisplay] || STATUS_STYLES.upcoming}`}>
              {statusLabel}
            </Badge>
            {event.ended_at && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Finalized {format(new Date(event.ended_at), 'MMM d, h:mm a')}
              </p>
            )}
            {!event.ended_at && lifecycle.isInFinalizationGrace && lifecycle.autoFinalizeAt && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Auto-finalizes {format(lifecycle.autoFinalizeAt, 'h:mm a')}
              </p>
            )}
            {!event.ended_at && lifecycle.needsFinalizationRepair && (
              <p className="mt-1 text-[10px] text-red-300">
                Missing ended_at
              </p>
            )}
          </TableCell>

          {/* Actions */}
          <TableCell className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border">
                {canEdit && (
                  <DropdownMenuItem onClick={() => setEditingEvent(event)} className="gap-2">
                    <Edit className="w-4 h-4" />Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setViewingAttendeesEvent(event)} className="gap-2">
                  <UserCheck className="w-4 h-4" />Attendees
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/events/${event.id}`, '_blank')} className="gap-2">
                  <Eye className="w-4 h-4" />View
                </DropdownMenuItem>

                {lifecycle.needsFinalizationRepair && !event.ended_at && !isArchived && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setPendingEventAction({ kind: "finalize-repair", event })}
                      disabled={finalizeRepairEvent.isPending}
                      className="gap-2 text-red-300 focus:text-red-300"
                    >
                      <StopCircle className="w-4 h-4" />
                      Finalize now
                    </DropdownMenuItem>
                  </>
                )}

                {canCancel && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        const title = event.title as string;
                        const message = [
                          `Cancel "${title}"?`,
                          '',
                          'The event will be marked cancelled. It will no longer behave as an active, upcoming, or live event for users.',
                          'Existing registrations stay in the database (this is not delete). Use attendee tools or permanent delete if you need accounts or rows removed.',
                          'Cancel is different from Archive (organizational hide), End (normal completion), and Delete (erase event data).',
                          '',
                          'After cancel, the backend reports whether notification queueing happened. In the current P2 contract, cancellation notifications may be recorded as not queued until a dispatcher is connected.',
                        ].join('\n');
                        if (confirm(message)) {
                          cancelEvent.mutate({ eventId: event.id, title });
                        }
                      }}
                      disabled={cancelEvent.isPending}
                      className="gap-2 text-amber-600 focus:text-amber-600"
                    >
                      <Ban className="w-4 h-4" />
                      Cancel event
                    </DropdownMenuItem>
                  </>
                )}

                {isParent && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setPendingEventAction({ kind: "generate-more", event, count: 4 })} className="gap-2">
                      <RefreshCw className="w-4 h-4" />Generate 4 more
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />

                {isArchived ? (
                  <>
                    <DropdownMenuItem onClick={() => setPendingEventAction({ kind: "unarchive", event })} className="gap-2">
                      <RotateCcw className="w-4 h-4" />Unarchive
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (
                          confirm(
                            'PERMANENTLY DELETE this event and ALL its data? The database will remove swipes, video sessions, vibes, registrations, and the event in one transaction. This cannot be undone.'
                          )
                        ) {
                          if (
                            confirm(
                              'Final confirmation: every registration and session row for this event will be erased. Continue?'
                            )
                          ) {
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
                      <DropdownMenuItem
                        onClick={() => setPendingEventAction({ kind: "archive-series", event, childCount: children.length })}
                        className="gap-2 text-orange-400 focus:text-orange-400"
                      >
                        <Archive className="w-4 h-4" />Archive Series
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => setPendingEventAction({ kind: "archive", event })}
                      className="gap-2 text-muted-foreground"
                    >
                      <Archive className="w-4 h-4" />Archive
                    </DropdownMenuItem>

                    {/* Delete — available for all non-archived events */}
                    <DropdownMenuItem
                      onClick={() => {
                        if (
                          confirm(
                            `Permanently delete "${event.title}"? The server removes swipes, sessions, vibes, registrations, and the event in one transaction. This cannot be undone.`
                          )
                        ) {
                          if (
                            confirm(
                              'Final confirmation: all registrations and related rows for this event will be erased. Continue?'
                            )
                          ) {
                            deleteEvent.mutate(event.id);
                          }
                        }
                      }}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />Delete
                    </DropdownMenuItem>
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

  const pendingActionCopy = getPendingActionCopy();
  const isPanelActionPending =
    archiveEvent.isPending || archiveSeries.isPending || finalizeRepairEvent.isPending || isBulkArchiving || isGeneratingOccurrences;

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
            {['all','live','upcoming','wrap_up_grace','needs_finalization_repair','ended','cancelled','draft','archived'].map(s => (
              <SelectItem key={s} value={s}>{formatStatusFilterLabel(s)}</SelectItem>
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPendingEventAction({ kind: "bulk-archive", count: selectedIds.size })}
            className="gap-1 h-7 text-xs"
          >
            <Archive className="w-3 h-3" />Archive Selected
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
                    {allVisibleSelected
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

      <AdminEventCategoryManager />

      {/* Modals */}
      <AdminConfirmDialog
        open={!!pendingEventAction}
        title={pendingActionCopy.title}
        description={pendingActionCopy.description}
        confirmLabel={pendingActionCopy.confirmLabel}
        variant={pendingActionCopy.variant}
        isPending={isPanelActionPending}
        onOpenChange={(open) => {
          if (!open) setPendingEventAction(null);
        }}
        onConfirm={confirmPendingEventAction}
      />
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
