import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  Edit,
  FileCheck,
  Filter,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
import { formatAdminRelativeTime, formatAdminUtcDate, formatAdminUtcDateTime } from "@/lib/adminTime";
import { resolveAdminErrorMessage } from "@/lib/adminErrorResolver";

type AdminLogDetails = Record<string, unknown>;

type AdminAuditRow = {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  action_type: string;
  target_type: string;
  target_id: string | null;
  details: AdminLogDetails | null;
  request_id?: string | null;
  correlation_id?: string | null;
  action_outcome?: string | null;
  error_code?: string | null;
  created_at: string;
};

type AdminActivityLogPayload = AdminRpcPayload & {
  rows?: AdminAuditRow[];
  total_count?: number;
  limit?: number;
  offset?: number;
};

type ActionPresentation = {
  label: string;
  icon: LucideIcon;
  className: string;
};

type SelectOption = {
  value: string;
  label: string;
};

const ACTIVITY_LOG_PAGE_SIZE = 50;

const toneClasses = {
  positive: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  destructive: "bg-red-500/15 text-red-300 border-red-500/30",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  neutral: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  primary: "bg-primary/15 text-primary border-primary/30",
};

const actionPresentations: Record<string, ActionPresentation> = {
  "credit.adjust": { label: "Credits Adjusted", icon: CreditCard, className: toneClasses.info },
  "premium.grant": { label: "Premium Granted", icon: UserCheck, className: toneClasses.positive },
  "premium.extend": { label: "Premium Extended", icon: UserCheck, className: toneClasses.positive },
  "premium.revoke": { label: "Premium Revoked", icon: UserX, className: toneClasses.warning },
  "premium.expire": { label: "Premium Expired", icon: Clock, className: toneClasses.warning },
  "premium.correct_history": { label: "Premium History Corrected", icon: Edit, className: toneClasses.info },
  "report.dismiss": { label: "Report Dismissed", icon: FileCheck, className: toneClasses.neutral },
  "report.reviewed": { label: "Report Reviewed", icon: FileCheck, className: toneClasses.info },
  "report.warning_issued": { label: "Report Warning Issued", icon: AlertTriangle, className: toneClasses.warning },
  "report.user_suspended": { label: "Report User Suspended", icon: UserX, className: toneClasses.destructive },
  "report.suspension_lifted": { label: "Report Suspension Lifted", icon: UserCheck, className: toneClasses.positive },
  "report.policy_context_attached": { label: "Report Policy Context Attached", icon: FileCheck, className: toneClasses.info },
  "moderation.warning_issued": { label: "Warning Issued", icon: AlertTriangle, className: toneClasses.warning },
  "moderation.user_suspended": { label: "User Suspended", icon: UserX, className: toneClasses.destructive },
  "moderation.suspension_lifted": { label: "Suspension Lifted", icon: UserCheck, className: toneClasses.positive },
  "verification.approve": { label: "Verification Approved", icon: CheckCircle2, className: toneClasses.positive },
  "verification.reject": { label: "Verification Rejected", icon: XCircle, className: toneClasses.destructive },
  "event.create": { label: "Event Created", icon: Calendar, className: toneClasses.positive },
  "event.update": { label: "Event Updated", icon: Edit, className: toneClasses.info },
  "event.end": { label: "Event Ended", icon: Clock, className: toneClasses.warning },
  "event.auto_finalize": { label: "Event Auto-Finalized", icon: Clock, className: toneClasses.warning },
  "event.extend": { label: "Event Extended", icon: Clock, className: toneClasses.info },
  "event.go_live": { label: "Event Went Live", icon: PlayCircle, className: toneClasses.positive },
  "event.cancel": { label: "Event Cancelled", icon: XCircle, className: toneClasses.destructive },
  "event.archive": { label: "Event Archived", icon: Archive, className: toneClasses.warning },
  "event.unarchive": { label: "Event Unarchived", icon: Archive, className: toneClasses.positive },
  "event.bulk_archive": { label: "Events Bulk Archived", icon: Archive, className: toneClasses.warning },
  "event.archive_series": { label: "Event Series Archived", icon: Archive, className: toneClasses.warning },
  "event.delete": { label: "Event Deleted", icon: Trash2, className: toneClasses.destructive },
  "event.generate_recurring": { label: "Recurring Events Generated", icon: Calendar, className: toneClasses.positive },
  "event.reminder_requested": { label: "Event Reminder Requested", icon: Send, className: toneClasses.info },
  "notification.mark_read": { label: "Notifications Marked Read", icon: Bell, className: toneClasses.info },
  "notification.delete": { label: "Notifications Deleted", icon: Trash2, className: toneClasses.destructive },
  "support.exception_create": { label: "Support Exception Created", icon: MessageSquare, className: toneClasses.info },
  "support.exception_update": { label: "Support Exception Updated", icon: MessageSquare, className: toneClasses.info },
  "compliance.export_queued": { label: "Export Queued", icon: Download, className: toneClasses.primary },
  "experiment.status_update": { label: "Experiment Status Updated", icon: Edit, className: toneClasses.info },
  "trust.recommendation_decision": { label: "Trust Recommendation Decided", icon: Shield, className: toneClasses.info },
  "event_registration.mark_attendance": { label: "Attendance Marked", icon: CheckCircle2, className: toneClasses.info },
  "event_registration.remove": { label: "Registration Removed", icon: UserX, className: toneClasses.destructive },
  media_jobs_requeue_stale: { label: "Stale Media Jobs Requeued", icon: RefreshCw, className: toneClasses.info },
  media_jobs_retry_failed: { label: "Failed Media Jobs Retried", icon: RefreshCw, className: toneClasses.warning },
  media_retention_setting_updated: { label: "Media Retention Updated", icon: Archive, className: toneClasses.info },
  media_retention_chat_policy_updated: { label: "Chat Retention Policy Updated", icon: MessageSquare, className: toneClasses.info },
  admin_upsert_push_campaign_draft: { label: "Push Campaign Draft Saved", icon: Bell, className: toneClasses.info },
  admin_delete_push_campaign_draft: { label: "Push Campaign Draft Deleted", icon: Trash2, className: toneClasses.destructive },
  create_event_payment_exception: { label: "Payment Exception Created", icon: MessageSquare, className: toneClasses.info },
  transition_event_payment_exception: { label: "Payment Exception Transitioned", icon: MessageSquare, className: toneClasses.info },

  // Legacy client-side action names kept for historical rows.
  suspend_user: { label: "Suspended User", icon: UserX, className: toneClasses.destructive },
  warn_user: { label: "Warned User", icon: AlertTriangle, className: toneClasses.warning },
  ban_user: { label: "Banned User", icon: Shield, className: toneClasses.destructive },
  review_report: { label: "Reviewed Report", icon: FileCheck, className: toneClasses.info },
  create_event: { label: "Created Event", icon: Calendar, className: toneClasses.positive },
  edit_event: { label: "Edited Event", icon: Edit, className: toneClasses.info },
  delete_event: { label: "Deleted Event", icon: Trash2, className: toneClasses.destructive },
  lift_suspension: { label: "Lifted Suspension", icon: UserCheck, className: toneClasses.positive },
};

const actionFilterOptions: SelectOption[] = [
  { value: "all", label: "All Actions" },
  { value: "event.create", label: "Event Created" },
  { value: "event.update", label: "Event Updated" },
  { value: "event.end", label: "Event Ended" },
  { value: "event.auto_finalize", label: "Event Auto-Finalized" },
  { value: "event.extend", label: "Event Extended" },
  { value: "event.go_live", label: "Event Live" },
  { value: "event.cancel", label: "Event Cancelled" },
  { value: "event.archive", label: "Event Archived" },
  { value: "event.unarchive", label: "Event Unarchived" },
  { value: "event.bulk_archive", label: "Events Bulk Archived" },
  { value: "event.archive_series", label: "Event Series Archived" },
  { value: "event.delete", label: "Event Deleted" },
  { value: "event.generate_recurring", label: "Recurring Events Generated" },
  { value: "event.reminder_requested", label: "Event Reminder Requested" },
  { value: "credit.adjust", label: "Credits Adjusted" },
  { value: "premium.grant", label: "Premium Granted" },
  { value: "premium.extend", label: "Premium Extended" },
  { value: "premium.revoke", label: "Premium Revoked" },
  { value: "premium.expire", label: "Premium Expired" },
  { value: "premium.correct_history", label: "Premium History Corrected" },
  { value: "moderation.warning_issued", label: "Warning Issued" },
  { value: "moderation.user_suspended", label: "User Suspended" },
  { value: "moderation.suspension_lifted", label: "Suspension Lifted" },
  { value: "report.dismiss", label: "Report Dismissed" },
  { value: "report.reviewed", label: "Report Reviewed" },
  { value: "report.warning_issued", label: "Report Warning Issued" },
  { value: "report.user_suspended", label: "Report User Suspended" },
  { value: "report.suspension_lifted", label: "Report Suspension Lifted" },
  { value: "report.policy_context_attached", label: "Report Policy Context Attached" },
  { value: "verification.approve", label: "Verification Approved" },
  { value: "verification.reject", label: "Verification Rejected" },
  { value: "notification.mark_read", label: "Notifications Marked Read" },
  { value: "notification.delete", label: "Notifications Deleted" },
  { value: "support.exception_create", label: "Support Exception Created" },
  { value: "support.exception_update", label: "Support Exception Updated" },
  { value: "compliance.export_queued", label: "Export Queued" },
  { value: "experiment.status_update", label: "Experiment Status Updated" },
  { value: "trust.recommendation_decision", label: "Trust Recommendation Decided" },
  { value: "event_registration.mark_attendance", label: "Attendance Marked" },
  { value: "event_registration.remove", label: "Registration Removed" },
  { value: "media_jobs_requeue_stale", label: "Stale Media Jobs Requeued" },
  { value: "media_jobs_retry_failed", label: "Failed Media Jobs Retried" },
  { value: "media_retention_setting_updated", label: "Media Retention Updated" },
  { value: "media_retention_chat_policy_updated", label: "Chat Retention Policy Updated" },
  { value: "admin_upsert_push_campaign_draft", label: "Push Draft Saved" },
  { value: "admin_delete_push_campaign_draft", label: "Push Draft Deleted" },
  { value: "create_event_payment_exception", label: "Legacy Payment Exception Created" },
  { value: "transition_event_payment_exception", label: "Legacy Payment Exception Transitioned" },
  { value: "create_event", label: "Legacy Create Event" },
  { value: "edit_event", label: "Legacy Edit Event" },
  { value: "delete_event", label: "Legacy Delete Event" },
  { value: "suspend_user", label: "Legacy Suspension" },
  { value: "warn_user", label: "Legacy Warning" },
  { value: "ban_user", label: "Legacy Ban" },
  { value: "review_report", label: "Legacy Report Review" },
  { value: "lift_suspension", label: "Legacy Lift Suspension" },
];

const targetFilterOptions: SelectOption[] = [
  { value: "all", label: "All Targets" },
  { value: "user", label: "Users" },
  { value: "report", label: "Reports" },
  { value: "event", label: "Events" },
  { value: "admin_notifications", label: "Admin Notifications" },
  { value: "push_campaign", label: "Push Campaigns" },
  { value: "event_registration", label: "Event Registrations" },
  { value: "event_payment_exception", label: "Payment Exceptions" },
  { value: "data_export_job", label: "Data Exports" },
  { value: "media_retention_settings", label: "Media Retention" },
  { value: "experiment", label: "Experiments" },
  { value: "moderation_recommendation", label: "Moderation Recommendations" },
];

const DETAIL_PRIORITY_KEYS = [
  "reason",
  "message",
  "title",
  "affected_count",
  "archived_count",
  "minutes",
  "scope",
  "rows_deleted",
  "scheduled_end",
  "auto_finalize_at",
  "grace_minutes",
  "generated_count",
  "requested_count",
  "row_count_estimate",
  "scope_type",
  "pii_classification",
  "decision",
  "action",
  "attended",
  "requeued_count",
  "retried_count",
  "family",
  "stale_minutes",
] as const;

const formatUnknownActionLabel = (actionType: string): string => {
  const words = actionType
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length ? words.join(" ") : "Admin Action";
};

const presentationForAction = (actionType: string): ActionPresentation => {
  const explicit = actionPresentations[actionType];
  if (explicit) return explicit;

  if (actionType.includes("delete") || actionType.includes("cancel") || actionType.includes("reject")) {
    return { label: formatUnknownActionLabel(actionType), icon: Trash2, className: toneClasses.destructive };
  }
  if (actionType.includes("warning") || actionType.includes("suspend") || actionType.includes("archive")) {
    return { label: formatUnknownActionLabel(actionType), icon: AlertTriangle, className: toneClasses.warning };
  }
  if (actionType.includes("create") || actionType.includes("approve") || actionType.includes("grant")) {
    return { label: formatUnknownActionLabel(actionType), icon: CheckCircle2, className: toneClasses.positive };
  }
  return { label: formatUnknownActionLabel(actionType), icon: Shield, className: toneClasses.neutral };
};

const formatTargetLabel = (targetType: string): string => formatUnknownActionLabel(targetType);

const shortenId = (id: string): string => {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
};

const outcomeClassName = (outcome: string | null | undefined): string => {
  const normalized = (outcome ?? "").toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("blocked")) {
    return toneClasses.destructive;
  }
  if (normalized.includes("warn") || normalized.includes("retry") || normalized.includes("queued")) {
    return toneClasses.warning;
  }
  if (normalized.includes("success") || normalized.includes("complete")) {
    return toneClasses.positive;
  }
  return toneClasses.neutral;
};

const formatDateBoundary = (date: string, edge: "start" | "end"): string | null => {
  if (!date) return null;
  const boundary = new Date(`${date}T00:00:00.000`);
  if (edge === "end") boundary.setDate(boundary.getDate() + 1);
  return boundary.toISOString();
};

const compactValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || typeof value === "undefined") return "";
  return JSON.stringify(value);
};

const formatDetailsSummary = (details: AdminLogDetails | null): string | null => {
  if (!details || Object.keys(details).length === 0) return null;

  for (const key of DETAIL_PRIORITY_KEYS) {
    const value = details[key];
    const compact = compactValue(value);
    if (compact) {
      return `${formatTargetLabel(key)}: ${compact}`.slice(0, 180);
    }
  }

  return JSON.stringify(details).slice(0, 180);
};

const AdminActivityLog = () => {
  const [filterAction, setFilterAction] = useState("all");
  const [filterTarget, setFilterTarget] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageIndex, setPageIndex] = useState(0);

  const hasInvalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const fromBoundary = useMemo(() => formatDateBoundary(dateFrom, "start"), [dateFrom]);
  const toBoundary = useMemo(() => formatDateBoundary(dateTo, "end"), [dateTo]);

  const {
    data: activityPayload,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery<AdminActivityLogPayload>({
    queryKey: ["admin-activity-logs", filterAction, filterTarget, fromBoundary, toBoundary, pageIndex],
    queryFn: async () =>
      callAdminRpc<AdminActivityLogPayload>("admin_search_admin_audit_logs", {
        p_action_type: filterAction === "all" ? null : filterAction,
        p_target_type: filterTarget === "all" ? null : filterTarget,
        p_target_id: null,
        p_actor_id: null,
        p_from: fromBoundary,
        p_to: toBoundary,
        p_limit: ACTIVITY_LOG_PAGE_SIZE,
        p_offset: pageIndex * ACTIVITY_LOG_PAGE_SIZE,
      }),
    enabled: !hasInvalidDateRange,
  });

  const logs = Array.isArray(activityPayload?.rows) ? activityPayload.rows : [];
  const reportedTotalCount = Number(activityPayload?.total_count);
  const totalCount =
    Number.isFinite(reportedTotalCount) && reportedTotalCount >= 0
      ? Math.floor(reportedTotalCount)
      : logs.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / ACTIVITY_LOG_PAGE_SIZE));
  const firstVisibleLog = totalCount === 0 ? 0 : pageIndex * ACTIVITY_LOG_PAGE_SIZE + 1;
  const lastVisibleLog = Math.min(totalCount, pageIndex * ACTIVITY_LOG_PAGE_SIZE + logs.length);
  const canGoPrevious = pageIndex > 0;
  const canGoNext = pageIndex + 1 < totalPages;

  useEffect(() => {
    if (!isLoading && pageIndex >= totalPages) {
      setPageIndex(totalPages - 1);
    }
  }, [isLoading, pageIndex, totalPages]);

  const resetPage = () => setPageIndex(0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Activity Log</h2>
          <p className="text-sm text-muted-foreground">Track all admin moderation and production-impacting actions</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[220px_190px_150px_150px_auto]">
          <Select
            value={filterAction}
            onValueChange={(value) => {
              setFilterAction(value);
              resetPage();
            }}
          >
            <SelectTrigger className="bg-secondary/50">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              {actionFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterTarget}
            onValueChange={(value) => {
              setFilterTarget(value);
              resetPage();
            }}
          >
            <SelectTrigger className="bg-secondary/50">
              <SelectValue placeholder="All Targets" />
            </SelectTrigger>
            <SelectContent>
              {targetFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label="Activity log start date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              resetPage();
            }}
            className="bg-secondary/50"
          />
          <Input
            type="date"
            aria-label="Activity log end date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              resetPage();
            }}
            className="bg-secondary/50"
          />
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => refetch()}
            disabled={isFetching || hasInvalidDateRange}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/50 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Showing {firstVisibleLog}-{lastVisibleLog} of {totalCount} logs
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Page {pageIndex + 1} of {totalPages}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrevious || isLoading}
              onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext || isLoading}
              onClick={() => setPageIndex((page) => page + 1)}
            >
              Next
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[600px]">
          <div className="p-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-24 bg-secondary/50 rounded-xl animate-pulse" />
              ))
            ) : hasInvalidDateRange ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Start date must be before the end date.
              </div>
            ) : isError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Unable to read activity logs from admin_search_admin_audit_logs.
                <span className="mt-1 block text-xs">
                  {resolveAdminErrorMessage(error, "Could not load activity log")}
                </span>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No activity logs match the current filters.
              </div>
            ) : (
              logs.map((log, index) => {
                const presentation = presentationForAction(log.action_type);
                const Icon = presentation.icon;
                const details = formatDetailsSummary(log.details);
                const actorLabel = log.details?.actor_type === "system"
                  ? "System"
                  : log.admin_name || log.admin_id || "Unknown admin";

                return (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.015 }}
                    className="flex gap-4 p-4 bg-secondary/30 rounded-xl hover:bg-secondary/50 transition-colors"
                  >
                    <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${presentation.className}`}>
                      <Icon className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="outline" className={presentation.className}>
                          {presentation.label}
                        </Badge>
                        <Badge variant="outline" className="border-border text-muted-foreground">
                          {formatTargetLabel(log.target_type)}
                        </Badge>
                        {log.action_outcome && (
                          <Badge variant="outline" className={outcomeClassName(log.action_outcome)}>
                            {log.action_outcome}
                          </Badge>
                        )}
                        {log.error_code && (
                          <Badge variant="outline" className={toneClasses.destructive}>
                            {log.error_code}
                          </Badge>
                        )}
                        {log.target_id && (
                          <span className="text-xs text-muted-foreground">{shortenId(log.target_id)}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          <span title={formatAdminUtcDateTime(log.created_at)}>
                            {formatAdminRelativeTime(log.created_at)}
                          </span>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-foreground">{actorLabel}</span>
                        <span className="text-muted-foreground">performed</span>
                        <span className="font-medium text-foreground" title={log.action_type}>
                          {presentation.label}
                        </span>
                      </div>

                      {details && (
                        <p className="text-xs text-muted-foreground mt-2 truncate">
                          {details}
                        </p>
                      )}
                      {(log.request_id || log.correlation_id) && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {log.request_id && (
                            <span title={log.request_id}>request {shortenId(log.request_id)}</span>
                          )}
                          {log.correlation_id && (
                            <span title={log.correlation_id}>correlation {shortenId(log.correlation_id)}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{formatAdminUtcDateTime(log.created_at)}</div>
                      <div className="mt-1">{formatAdminUtcDate(log.created_at)}</div>
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
