import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Save,
  Search,
  Send,
  Smartphone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { STATUS_CONFIG, PRIORITY_CONFIG, type SupportStatus, type SupportPriority } from "@/lib/supportStatus";
import { SUPPORT_CATEGORIES, type PrimaryType } from "@/lib/supportCategories";
import AdminUserDetailDrawer from "./AdminUserDetailDrawer";
import AdminConfirmDialog from "./AdminConfirmDialog";
import {
  callAdminRpc,
  createAdminTargetIdempotencyKey,
  sanitizeAdminRpcErrorMessage,
  type AdminRpcPayload,
} from "@/lib/adminRpc";
import { invalidateAdminQueries } from "@/lib/adminQueryInvalidation";
import { resolveSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionInvokeErrors";
import { formatAdminRelativeTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";

type TicketRow = {
  id: string;
  reference_id: string;
  user_id: string;
  event_id: string | null;
  checkout_session_id: string | null;
  event_payment_exception_id: string | null;
  primary_type: string;
  subcategory: string;
  subject: string | null;
  status: string;
  priority: string;
  message: string;
  user_email: string | null;
  platform: string | null;
  app_version: string | null;
  device_model: string | null;
  os_version: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  assigned_to: string | null;
  admin_notes: string | null;
};

type TicketSummary = TicketRow & {
  profile_name: string | null;
  profile_avatar_url: string | null;
  reply_count: number;
  user_reply_count: number;
  admin_reply_count: number;
  last_reply_at: string | null;
  last_reply_sender_type: string | null;
  needs_attention: boolean;
};

type ReplyRow = {
  id: string;
  ticket_id: string;
  sender_type: string;
  sender_id: string | null;
  message: string;
  is_read?: boolean;
  created_at: string;
};

type SupportProfileSummary = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

type ExceptionType =
  | "refund_requested"
  | "refund_handled_externally"
  | "payment_mismatch"
  | "registration_corrected"
  | "cancelled_after_payment"
  | "support_exception";

type ExceptionStatus = "open" | "in_review" | "awaiting_external" | "resolved" | "closed_no_action";

type EventPaymentExceptionRow = {
  id: string;
  event_id: string;
  profile_id: string;
  support_ticket_id: string | null;
  checkout_session_id: string | null;
  exception_type: ExceptionType;
  exception_status: ExceptionStatus;
  notes: string | null;
  resolution: string | null;
  refund_handled_externally: boolean;
  external_refund_reference: string | null;
  created_at: string;
  updated_at: string;
};

type SupportEventRow = {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  event_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type SupportDeliveryJobRow = {
  id: string;
  ticket_id: string;
  reply_id: string;
  channel: "push" | "email" | string;
  state: string;
  provider_id: string | null;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type SupportInboxPayload = AdminRpcPayload & {
  tickets?: TicketSummary[];
  counts?: {
    total?: number;
    submitted?: number;
    in_review?: number;
    waiting_on_user?: number;
    resolved?: number;
    open?: number;
    safety?: number;
    urgent?: number;
    filtered?: number;
  };
  filtered_count?: number;
};

type SupportThreadPayload = AdminRpcPayload & {
  ticket?: TicketRow | null;
  profile?: SupportProfileSummary | null;
  replies?: ReplyRow[];
  linked_exception?: EventPaymentExceptionRow | null;
  support_events?: SupportEventRow[];
  delivery_jobs?: SupportDeliveryJobRow[];
};

type SendSupportReplyResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  idempotent_replay?: boolean;
  notification_warning?: string | null;
  email_warning?: string | null;
  delivery_jobs?: Array<{ id?: string; channel?: string; state?: string }>;
};

const EXCEPTION_TYPE_OPTIONS: { value: ExceptionType; label: string }[] = [
  { value: "refund_requested", label: "Refund requested" },
  { value: "refund_handled_externally", label: "Refund handled externally" },
  { value: "payment_mismatch", label: "Payment mismatch" },
  { value: "registration_corrected", label: "Registration corrected" },
  { value: "cancelled_after_payment", label: "Cancelled after payment" },
  { value: "support_exception", label: "Support exception" },
];

const EXCEPTION_STATUS_OPTIONS: { value: ExceptionStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "awaiting_external", label: "Awaiting external" },
  { value: "resolved", label: "Resolved" },
  { value: "closed_no_action", label: "Closed no action" },
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUND_EXCEPTION_TYPES = new Set<ExceptionType>(["refund_requested", "refund_handled_externally"]);

function formatRelativeTime(value: string | null | undefined) {
  return value ? formatAdminRelativeTime(value) : "-";
}

function getInitials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function PlatformIcon({ platform }: { platform: string | null }) {
  return platform?.toLowerCase() === "web" ? <Monitor className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />;
}

function deliveryStateVariant(state: string): "default" | "secondary" | "destructive" {
  if (state === "completed") return "default";
  if (state === "queued" || state === "processing" || state === "retryable_failed") return "secondary";
  return "destructive";
}

export default function SupportInbox() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [notesDraft, setNotesDraft] = useState("");
  const [eventIdDraft, setEventIdDraft] = useState("");
  const [checkoutSessionDraft, setCheckoutSessionDraft] = useState("");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [exceptionTypeDraft, setExceptionTypeDraft] = useState<ExceptionType>("refund_requested");
  const [exceptionStatusDraft, setExceptionStatusDraft] = useState<ExceptionStatus>("open");
  const [exceptionNotesDraft, setExceptionNotesDraft] = useState("");
  const [exceptionResolutionDraft, setExceptionResolutionDraft] = useState("");
  const [externalRefundReferenceDraft, setExternalRefundReferenceDraft] = useState("");
  const [pendingExceptionAction, setPendingExceptionAction] = useState<"create" | "transition" | null>(null);
  const profileDrawerTriggerRef = useRef<HTMLElement | null>(null);

  const normalizedSearch = search.trim();
  const hasActiveFilters =
    statusFilter !== "all" || typeFilter !== "all" || priorityFilter !== "all" || normalizedSearch.length > 0;

  const invalidateSupportQueries = () => {
    void invalidateAdminQueries(queryClient, ["support"]);
  };

  const supportInboxQuery = useQuery({
    queryKey: ["admin-support-tickets", statusFilter, typeFilter, priorityFilter, normalizedSearch],
    queryFn: () =>
      callAdminRpc<SupportInboxPayload>("admin_get_support_inbox", {
        p_status: statusFilter,
        p_primary_type: typeFilter,
        p_priority: priorityFilter,
        p_search: normalizedSearch || null,
        p_limit: 200,
      }),
  });

  const tickets = useMemo(() => supportInboxQuery.data?.tickets ?? [], [supportInboxQuery.data?.tickets]);
  const totalTickets = supportInboxQuery.data?.counts?.total ?? 0;

  const selectedSummary = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );

  const supportThreadQuery = useQuery({
    queryKey: ["admin-support-thread", selectedId],
    queryFn: () =>
      callAdminRpc<SupportThreadPayload>("admin_get_support_ticket_thread", {
        p_ticket_id: selectedId,
      }),
    enabled: !!selectedId,
  });

  const selected = supportThreadQuery.data?.ticket ?? selectedSummary;
  const threadReplies = supportThreadQuery.data?.replies ?? [];
  const linkedException = supportThreadQuery.data?.linked_exception ?? null;
  const supportEvents = supportThreadQuery.data?.support_events ?? [];
  const deliveryJobs = supportThreadQuery.data?.delivery_jobs ?? [];
  const profile = supportThreadQuery.data?.profile ?? null;
  const profileName = profile?.name ?? selectedSummary?.profile_name ?? "User";
  const profileAvatarUrl = profile?.avatar_url ?? selectedSummary?.profile_avatar_url ?? null;
  const selectedTicketId = selected?.id ?? null;
  const selectedAdminNotes = selected?.admin_notes ?? null;
  const selectedEventId = selected?.event_id ?? null;
  const selectedCheckoutSessionId = selected?.checkout_session_id ?? null;
  const linkedExceptionId = linkedException?.id ?? null;
  const linkedExceptionType = linkedException?.exception_type ?? null;
  const linkedExceptionStatus = linkedException?.exception_status ?? null;
  const linkedExceptionNotes = linkedException?.notes ?? null;
  const linkedExceptionResolution = linkedException?.resolution ?? null;
  const linkedExceptionExternalRefundReference = linkedException?.external_refund_reference ?? null;

  useEffect(() => {
    if (!selectedTicketId) return;
    setNotesDraft(selectedAdminNotes ?? "");
    setEventIdDraft(selectedEventId ?? "");
    setCheckoutSessionDraft(selectedCheckoutSessionId ?? "");
  }, [selectedAdminNotes, selectedCheckoutSessionId, selectedEventId, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId || !linkedExceptionId) {
      setExceptionTypeDraft("refund_requested");
      setExceptionStatusDraft("open");
      setExceptionNotesDraft("");
      setExceptionResolutionDraft("");
      setExternalRefundReferenceDraft("");
      return;
    }

    setExceptionTypeDraft(linkedExceptionType ?? "refund_requested");
    setExceptionStatusDraft(linkedExceptionStatus ?? "open");
    setExceptionNotesDraft(linkedExceptionNotes ?? "");
    setExceptionResolutionDraft(linkedExceptionResolution ?? "");
    setExternalRefundReferenceDraft(linkedExceptionExternalRefundReference ?? "");
  }, [
    linkedExceptionExternalRefundReference,
    linkedExceptionId,
    linkedExceptionNotes,
    linkedExceptionResolution,
    linkedExceptionStatus,
    linkedExceptionType,
    selectedTicketId,
  ]);

  const updateTicketMutation = useMutation({
    mutationFn: async (payload: {
      status?: SupportStatus;
      priority?: SupportPriority;
      admin_notes?: string | null;
      set_admin_notes?: boolean;
      event_id?: string | null;
      set_event_id?: boolean;
      checkout_session_id?: string | null;
      set_checkout_session_id?: boolean;
      toast_message?: string;
    }) => {
      if (!selected?.id) throw new Error("Select a support ticket first.");

      return callAdminRpc("admin_update_support_ticket", {
        p_ticket_id: selected.id,
        p_status: payload.status ?? null,
        p_priority: payload.priority ?? null,
        p_admin_notes: payload.admin_notes ?? null,
        p_set_admin_notes: payload.set_admin_notes ?? false,
        p_event_id: payload.event_id ?? null,
        p_set_event_id: payload.set_event_id ?? false,
        p_checkout_session_id: payload.checkout_session_id ?? null,
        p_set_checkout_session_id: payload.set_checkout_session_id ?? false,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_update_support_ticket", selected.id, {
          selected_updated_at: selected.updated_at,
          status: payload.status ?? null,
          priority: payload.priority ?? null,
          admin_notes: payload.set_admin_notes ? payload.admin_notes ?? null : null,
          event_id: payload.set_event_id ? payload.event_id ?? null : null,
          checkout_session_id: payload.set_checkout_session_id ? payload.checkout_session_id ?? null : null,
        }),
      });
    },
    onSuccess: (_data, variables) => {
      invalidateSupportQueries();
      adminToast.success({
        id: `admin-support-ticket-update-${variables.toast_message ?? "status"}`,
        title: variables.toast_message ?? "Ticket updated",
      });
    },
    onError: (err) => adminToast.error({ id: "admin-support-ticket-update-error", title: sanitizeAdminRpcErrorMessage(err) }),
  });

  const sendReplyMutation = useMutation({
    mutationFn: async () => {
      if (!selected?.id) throw new Error("Select a support ticket first.");
      const message = replyText.trim();
      if (!message) throw new Error("Write a reply before sending.");

      const { data, error } = await supabase.functions.invoke<SendSupportReplyResponse>("send-support-reply", {
        body: {
          ticket_id: selected.id,
          reply_message: message,
          send_email: sendEmail,
          idempotency_key: createAdminTargetIdempotencyKey("admin_create_support_reply", selected.id, {
            message,
            send_email: sendEmail,
            latest_reply_id: threadReplies[threadReplies.length - 1]?.id ?? null,
            reply_count: threadReplies.length,
          }),
        },
      });

      if (error) {
        throw new Error(await resolveSupabaseFunctionErrorMessage(error, data, "Failed to send reply"));
      }
      if (!data?.success) throw new Error(data?.message || data?.error || "Failed to send reply");
      return { response: data, ticketId: selected.id };
    },
    onSuccess: ({ response: result, ticketId }) => {
      setReplyText("");
      invalidateSupportQueries();
      const warnings = [result.notification_warning, result.email_warning].filter(Boolean).join(" ");
      if (warnings) {
        adminToast.warning({
          id: `admin-support-reply-warning-${ticketId}`,
          title: "Reply saved with warnings",
          description: warnings,
        });
      } else {
        adminToast.success({
          id: `admin-support-reply-${ticketId}`,
          title: result.idempotent_replay ? "Reply already saved" : "Reply saved and delivery queued",
        });
      }
    },
    onError: (err) => adminToast.error({ id: "admin-support-reply-error", title: sanitizeAdminRpcErrorMessage(err) }),
  });

  const createExceptionMutation = useMutation({
    mutationFn: async () => {
      if (!selected?.event_id) throw new Error("Save event context before opening a payment exception case.");
      const data = await callAdminRpc("admin_create_event_payment_exception", {
        p_event_id: selected.event_id,
        p_profile_id: selected.user_id,
        p_exception_type: exceptionTypeDraft,
        p_exception_status: exceptionStatusDraft,
        p_checkout_session_id: selected.checkout_session_id,
        p_support_ticket_id: selected.id,
        p_notes: exceptionNotesDraft.trim() || null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_create_event_payment_exception", selected.id, {
          selected_updated_at: selected.updated_at,
          event_id: selected.event_id,
          profile_id: selected.user_id,
          exception_type: exceptionTypeDraft,
          exception_status: exceptionStatusDraft,
          checkout_session_id: selected.checkout_session_id,
          notes: exceptionNotesDraft.trim() || null,
        }),
      });
      return { data, ticketId: selected.id };
    },
    onSuccess: ({ ticketId }) => {
      invalidateSupportQueries();
      adminToast.success({ id: `admin-support-exception-created-${ticketId}`, title: "Payment exception case created" });
    },
    onError: (err) => adminToast.error({ id: "admin-support-exception-create-error", title: sanitizeAdminRpcErrorMessage(err) }),
  });

  const transitionExceptionMutation = useMutation({
    mutationFn: async () => {
      if (!linkedException?.id) throw new Error("No linked payment exception case");
      const data = await callAdminRpc("admin_transition_event_payment_exception", {
        p_exception_id: linkedException.id,
        p_exception_type: exceptionTypeDraft,
        p_exception_status: exceptionStatusDraft,
        p_resolution: exceptionResolutionDraft.trim() || null,
        p_notes: exceptionNotesDraft.trim() || null,
        p_refund_handled_externally: exceptionTypeDraft === "refund_handled_externally" ? true : null,
        p_external_refund_reference: externalRefundReferenceDraft.trim() || null,
        p_support_ticket_id: selected?.id ?? null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_transition_event_payment_exception", linkedException.id, {
          exception_updated_at: linkedException.updated_at,
          exception_type: exceptionTypeDraft,
          exception_status: exceptionStatusDraft,
          resolution: exceptionResolutionDraft.trim() || null,
          notes: exceptionNotesDraft.trim() || null,
          refund_handled_externally: exceptionTypeDraft === "refund_handled_externally",
          external_refund_reference: externalRefundReferenceDraft.trim() || null,
          support_ticket_id: selected?.id ?? null,
        }),
      });
      return { data, exceptionId: linkedException.id };
    },
    onSuccess: ({ exceptionId }) => {
      invalidateSupportQueries();
      adminToast.success({ id: `admin-support-exception-updated-${exceptionId}`, title: "Payment exception case updated" });
    },
    onError: (err) => adminToast.error({ id: "admin-support-exception-update-error", title: sanitizeAdminRpcErrorMessage(err) }),
  });

  const saveContext = () => {
    const eventId = eventIdDraft.trim();
    const checkoutSessionId = checkoutSessionDraft.trim();
    if (eventId && !UUID_PATTERN.test(eventId)) {
      adminToast.error({ id: "admin-support-event-uuid-invalid", title: "Enter a valid event UUID before saving context" });
      return;
    }

    updateTicketMutation.mutate({
      event_id: eventId || null,
      set_event_id: true,
      checkout_session_id: checkoutSessionId || null,
      set_checkout_session_id: true,
      toast_message: "Context saved",
    });
  };

  const requestExceptionAction = (action: "create" | "transition") => {
    if (REFUND_EXCEPTION_TYPES.has(exceptionTypeDraft) && !exceptionNotesDraft.trim()) {
      adminToast.error({ id: "admin-support-refund-notes-required", title: "Refund-related exception cases require notes before submit" });
      return;
    }

    if (action === "transition" && exceptionTypeDraft === "refund_handled_externally" && !externalRefundReferenceDraft.trim()) {
      adminToast.error({ id: "admin-support-refund-reference-required", title: "External refund reference is required when a refund is handled externally" });
      return;
    }

    setPendingExceptionAction(action);
  };

  const confirmExceptionAction = async () => {
    if (pendingExceptionAction === "create") return createExceptionMutation.mutateAsync();
    if (pendingExceptionAction === "transition") return transitionExceptionMutation.mutateAsync();
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setPriorityFilter("all");
    setSearch("");
  };

  const openProfileDrawer = (userId: string, trigger: HTMLElement | null) => {
    profileDrawerTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setProfileUserId(userId);
  };

  const closeProfileDrawer = () => {
    setProfileUserId(null);
    const trigger = profileDrawerTriggerRef.current;
    profileDrawerTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  };

  const exceptionConfirmCopy = pendingExceptionAction === "create"
    ? {
        title: "Open payment exception case?",
        description: `This immediately creates an event_payment_exceptions case for ticket ${selected?.reference_id ?? ""}. It changes support state for this user/event, but it does not process a refund or contact the payment provider.`,
        confirmLabel: "Open Case",
      }
    : {
        title: "Save payment exception transition?",
        description: `This immediately updates the linked payment exception to ${exceptionTypeDraft} / ${exceptionStatusDraft}. If marked refund_handled_externally, this records an external refund reference only; it does not process a refund in-app.`,
        confirmLabel: "Save Transition",
      };

  const contextChanged =
    !!selected &&
    ((eventIdDraft.trim() || null) !== (selected.event_id ?? null) ||
      (checkoutSessionDraft.trim() || null) !== (selected.checkout_session_id ?? null));

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 lg:w-[380px]">
        <div className="space-y-2 border-b border-border p-3">
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="in_review">In review</SelectItem>
                <SelectItem value="waiting_on_user">Waiting on user</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="feedback">Feedback</SelectItem>
                <SelectItem value="safety">Safety</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, email, message..."
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>

        <ScrollArea className="max-h-[60vh] flex-1 lg:max-h-none">
          {supportInboxQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading support tickets
            </div>
          ) : supportInboxQuery.isError ? (
            <div className="space-y-3 p-5 text-sm">
              <p className="font-medium">Unable to load support inbox</p>
              <p className="text-muted-foreground">
                {sanitizeAdminRpcErrorMessage(supportInboxQuery.error)}
              </p>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => supportInboxQuery.refetch()}>
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : totalTickets === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No support tickets yet</p>
            </div>
          ) : tickets.length === 0 ? (
            <div className="space-y-3 p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No tickets match these filters</p>
              {hasActiveFilters ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((ticket) => {
                const priority = PRIORITY_CONFIG[ticket.priority as SupportPriority] ?? PRIORITY_CONFIG.normal;
                const status = STATUS_CONFIG[ticket.status as SupportStatus] ?? STATUS_CONFIG.submitted;
                const category = SUPPORT_CATEGORIES[ticket.primary_type as PrimaryType];
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(ticket.id)}
                      className={`w-full px-3 py-3 text-left transition-colors hover:bg-secondary/50 ${
                        selectedId === ticket.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: priority.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold text-primary">{ticket.reference_id}</span>
                            {ticket.needs_attention ? (
                              <span className="h-2 w-2 rounded-full bg-orange-500" title="Needs reply" />
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge
                              variant="outline"
                              className="h-5 text-[10px]"
                              style={{ borderColor: category?.color ?? "#888", color: category?.color }}
                            >
                              {category?.label ?? ticket.primary_type}
                            </Badge>
                            <Badge variant="secondary" className="h-5 text-[10px]">
                              {status.label}
                            </Badge>
                            {ticket.reply_count > 0 ? (
                              <Badge variant="outline" className="h-5 text-[10px]">
                                {ticket.reply_count} replies
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{ticket.subcategory}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {ticket.profile_name || ticket.user_email || "-"}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1" title={ticket.platform ?? ""}>
                              <PlatformIcon platform={ticket.platform} />
                              {ticket.platform ?? "-"}
                            </span>
                            <span>{formatRelativeTime(ticket.updated_at)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>

      <div className="flex min-h-[480px] flex-1 flex-col rounded-xl border border-border bg-card/30">
        {!selectedId ? (
          <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
            Select a ticket to view details
          </div>
        ) : supportThreadQuery.isLoading && !selected ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading ticket thread
          </div>
        ) : supportThreadQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
            <p className="font-medium">Unable to load support thread</p>
            <p className="max-w-md text-muted-foreground">
              {sanitizeAdminRpcErrorMessage(supportThreadQuery.error)}
            </p>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => supportThreadQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold">{selected.reference_id}</span>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: STATUS_CONFIG[selected.status as SupportStatus]?.color,
                      color: STATUS_CONFIG[selected.status as SupportStatus]?.color,
                    }}
                  >
                    {STATUS_CONFIG[selected.status as SupportStatus]?.label ?? selected.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Created {formatRelativeTime(selected.created_at)} - Updated {formatRelativeTime(selected.updated_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selected.status}
                  onValueChange={(value) =>
                    updateTicketMutation.mutate({
                      status: value as SupportStatus,
                      toast_message: value === "resolved" ? "Ticket resolved" : "Status updated",
                    })
                  }
                  disabled={updateTicketMutation.isPending}
                >
                  <SelectTrigger className="h-9 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="in_review">In review</SelectItem>
                    <SelectItem value="waiting_on_user">Waiting on user</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={selected.priority}
                  onValueChange={(value) =>
                    updateTicketMutation.mutate({
                      priority: value as SupportPriority,
                      toast_message: "Priority updated",
                    })
                  }
                  disabled={updateTicketMutation.isPending}
                >
                  <SelectTrigger className="h-9 w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-2"
                  onClick={() =>
                    updateTicketMutation.mutate({
                      status: "resolved",
                      toast_message: "Ticket resolved",
                    })
                  }
                  disabled={selected.status === "resolved" || updateTicketMutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark resolved
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 border-b border-border p-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={profileAvatarUrl ?? undefined} />
                <AvatarFallback>{getInitials(profileName, selected.user_email ?? "?")}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{profileName}</p>
                <p className="text-sm text-muted-foreground">{selected.user_email ?? "-"}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <PlatformIcon platform={selected.platform} />
                    {selected.platform ?? "-"}
                  </span>
                  <span>{selected.app_version ?? "-"}</span>
                  <span className="max-w-[200px] truncate">{selected.device_model ?? "-"}</span>
                  <span>{selected.os_version ?? "-"}</span>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={(event) => openProfileDrawer(selected.user_id, event.currentTarget)}>
                <ExternalLink className="h-4 w-4" />
                Open profile
              </Button>
            </div>

            <div className="space-y-3 border-b border-border bg-secondary/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment and event context</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Input
                  value={eventIdDraft}
                  onChange={(event) => setEventIdDraft(event.target.value)}
                  placeholder="event_id"
                  className="h-9 font-mono text-xs"
                />
                <Input
                  value={checkoutSessionDraft}
                  onChange={(event) => setCheckoutSessionDraft(event.target.value)}
                  placeholder="checkout_session_id"
                  className="h-9 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-2"
                  onClick={saveContext}
                  disabled={!contextChanged || updateTicketMutation.isPending}
                >
                  {updateTicketMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save context
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>linked_exception_id: {selected.event_payment_exception_id ?? linkedException?.id ?? "-"}</span>
                {supportEvents.length > 0 ? <span>{supportEvents.length} support events</span> : null}
              </div>
            </div>

            <ScrollArea className="max-h-[320px] flex-1 p-4">
              <div className="mb-4 rounded-lg border border-border bg-secondary/20 p-3">
                <p className="mb-1 text-xs text-muted-foreground">Original request</p>
                <p className="whitespace-pre-wrap text-sm">{selected.message}</p>
              </div>
              <div className="space-y-3">
                {threadReplies.map((reply) => {
                  const isUser = reply.sender_type === "user";
                  return (
                    <div key={reply.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                          isUser ? "bg-primary/20 text-foreground" : "border border-border bg-card"
                        }`}
                      >
                        <p className="mb-1 text-[10px] font-semibold text-muted-foreground">
                          {isUser ? profileName : "Vibely Support"}
                        </p>
                        <p className="whitespace-pre-wrap">{reply.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{formatRelativeTime(reply.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {deliveryJobs.length > 0 ? (
              <div className="space-y-2 border-t border-border bg-secondary/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery jobs</p>
                <div className="space-y-2">
                  {deliveryJobs.map((job) => (
                    <div key={job.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="capitalize">
                        {job.channel}
                      </Badge>
                      <Badge variant={deliveryStateVariant(job.state)} className="capitalize">
                        {job.state.replace(/_/g, " ")}
                      </Badge>
                      <span>{job.attempts} attempts</span>
                      {job.provider_id ? <span>provider_id: {job.provider_id}</span> : null}
                      {job.error_code ? <span className="text-destructive">error: {job.error_code}</span> : null}
                      {job.next_retry_at && job.state !== "completed" ? (
                        <span>next retry {formatRelativeTime(job.next_retry_at)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {selected.status !== "resolved" ? (
              <div className="space-y-3 border-t border-border p-4">
                <Textarea
                  placeholder="Write a reply..."
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send-email"
                    checked={sendEmail}
                    onCheckedChange={(checked) => setSendEmail(checked === true)}
                  />
                  <label htmlFor="send-email" className="text-sm text-muted-foreground">
                    Send email copy to user
                  </label>
                </div>
                <Button
                  onClick={() => sendReplyMutation.mutate()}
                  disabled={!replyText.trim() || sendReplyMutation.isPending}
                  className="gap-2"
                >
                  {sendReplyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              </div>
            ) : (
              <div className="border-t border-border p-4 text-sm text-muted-foreground">
                Reopen the ticket before sending another reply.
              </div>
            )}

            <div className="space-y-2 border-t border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600/90">
                Internal notes (not visible to user)
              </p>
              <Textarea
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                rows={2}
                placeholder="Notes for admins only..."
              />
              <Button
                size="sm"
                variant="secondary"
                className="gap-2"
                onClick={() =>
                  updateTicketMutation.mutate({
                    admin_notes: notesDraft,
                    set_admin_notes: true,
                    toast_message: "Notes saved",
                  })
                }
                disabled={updateTicketMutation.isPending || notesDraft === (selected.admin_notes ?? "")}
              >
                {updateTicketMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save notes
              </Button>
            </div>

            <div className="space-y-3 border-t border-border bg-secondary/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Payment exception case</p>
                {linkedException ? (
                  <Badge variant="outline">
                    {EXCEPTION_TYPE_OPTIONS.find((option) => option.value === linkedException.exception_type)?.label ??
                      linkedException.exception_type}{" "}
                    /{" "}
                    {EXCEPTION_STATUS_OPTIONS.find((option) => option.value === linkedException.exception_status)?.label ??
                      linkedException.exception_status}
                  </Badge>
                ) : (
                  <Badge variant="secondary">No case linked</Badge>
                )}
              </div>

              {!selected.event_id ? (
                <p className="text-xs text-muted-foreground">Save event context before opening a payment exception case.</p>
              ) : null}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Select value={exceptionTypeDraft} onValueChange={(value) => setExceptionTypeDraft(value as ExceptionType)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Exception type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCEPTION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={exceptionStatusDraft} onValueChange={(value) => setExceptionStatusDraft(value as ExceptionStatus)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Exception status" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCEPTION_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Input
                value={externalRefundReferenceDraft}
                onChange={(event) => setExternalRefundReferenceDraft(event.target.value)}
                placeholder="External refund reference"
                className="h-9"
              />

              <Textarea
                value={exceptionResolutionDraft}
                onChange={(event) => setExceptionResolutionDraft(event.target.value)}
                rows={2}
                placeholder="Resolution summary"
              />

              <Textarea
                value={exceptionNotesDraft}
                onChange={(event) => setExceptionNotesDraft(event.target.value)}
                rows={2}
                placeholder="Operator notes for this exception case"
              />

              <div className="flex flex-wrap gap-2">
                {!linkedException ? (
                  <Button
                    size="sm"
                    onClick={() => requestExceptionAction("create")}
                    disabled={!selected.event_id || createExceptionMutation.isPending}
                  >
                    {createExceptionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Open case
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => requestExceptionAction("transition")}
                    disabled={transitionExceptionMutation.isPending}
                  >
                    {transitionExceptionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save transition
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {profileUserId ? <AdminUserDetailDrawer userId={profileUserId} onClose={closeProfileDrawer} /> : null}
      <AdminConfirmDialog
        open={!!pendingExceptionAction}
        title={exceptionConfirmCopy.title}
        description={exceptionConfirmCopy.description}
        confirmLabel={exceptionConfirmCopy.confirmLabel}
        variant="default"
        isPending={createExceptionMutation.isPending || transitionExceptionMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingExceptionAction(null);
        }}
        onConfirm={confirmExceptionAction}
      />
    </div>
  );
}
