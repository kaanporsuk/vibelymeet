import { useEffect, useMemo, useRef, useState, type AriaAttributes, type KeyboardEvent } from "react";
import AdminReportsSummary from "@/components/admin/AdminReportsSummary";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Shield,
  Ban,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  MessageSquareWarning,
  UserX,
  Camera,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { avatarUrl as avatarPreset } from "@/utils/imageUrl";
import { REPORT_REASONS, type ReportReasonId } from "../../../shared/safety/reportReasons";
import { resolvePrimaryProfilePhotoPath } from "../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminTargetIdempotencyKey, type AdminRpcPayload } from "@/lib/adminRpc";
import { invalidateAdminQueries } from "@/lib/adminQueryInvalidation";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { resolveReportSearchQuery } from "./adminReportSearch";
import AdminEmptyState from "./AdminEmptyState";
import { formatAdminUtcDateTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";

type SortField = "created_at" | "status";
type SortDirection = "asc" | "desc";
type ReportActionType = "dismiss" | "warn" | "suspend";
type PolicyCategory = "harassment" | "fake" | "inappropriate" | "spam" | "safety" | "underage" | "no_show" | "payment" | "other";
const REPORTS_PAGE_SIZE = 50;

type UserReportRow = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: ReportReasonId;
  details: string | null;
  status: string;
  created_at: string;
  reporter_profile?: ReportProfileRow | null;
  reported_profile?: ReportProfileRow | null;
};

type ReportProfileRow = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  photos: string[] | null;
  avatarUrl: string;
};

type ReportsReadModelPayload = AdminRpcPayload & {
  reports?: Array<
    Omit<UserReportRow, "reporter_profile" | "reported_profile"> & {
      reporter_profile?: Omit<ReportProfileRow, "avatarUrl"> | null;
      reported_profile?: Omit<ReportProfileRow, "avatarUrl"> | null;
    }
  >;
  limit?: number;
  offset?: number;
  total_count?: number;
};

const reasonIcons: Record<ReportReasonId, LucideIcon> = {
  harassment: MessageSquareWarning,
  fake: UserX,
  inappropriate: Camera,
  spam: AlertTriangle,
  safety: Shield,
  underage: UserX,
  other: Filter,
};

const reasonLabels: Record<ReportReasonId, string> = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.id, r.label])
) as Record<ReportReasonId, string>;

const policyCategories: Array<{ id: PolicyCategory; label: string }> = [
  { id: "harassment", label: "Harassment" },
  { id: "fake", label: "Fake profile" },
  { id: "inappropriate", label: "Inappropriate content" },
  { id: "spam", label: "Spam or scam" },
  { id: "safety", label: "Safety concern" },
  { id: "underage", label: "Underage concern" },
  { id: "no_show", label: "No-show pattern" },
  { id: "payment", label: "Payment or refund issue" },
  { id: "other", label: "Other" },
];

const policyLabel = (id: PolicyCategory) => policyCategories.find((category) => category.id === id)?.label || "Other";

const AdminReportsPanel = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedReport, setSelectedReport] = useState<UserReportRow | null>(null);
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [showActionConfirm, setShowActionConfirm] = useState(false);
  const [actionNotes, setActionNotes] = useState("");
  const [actionType, setActionType] = useState<ReportActionType>("dismiss");
  const [policyCategory, setPolicyCategory] = useState<PolicyCategory>("other");
  const [pageIndex, setPageIndex] = useState(0);
  const reportDialogTriggerRef = useRef<HTMLElement | null>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 350);
  const normalizedSearchQuery = debouncedSearchQuery.trim();
  const reportSearchQuery = resolveReportSearchQuery(normalizedSearchQuery);

  const openReportActionDialog = (report: UserReportRow, trigger?: HTMLElement | null) => {
    reportDialogTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedReport(report);
    setActionType("dismiss");
    setActionNotes("");
    setShowActionConfirm(false);
    setPolicyCategory(policyCategories.some((category) => category.id === report.reason) ? (report.reason as PolicyCategory) : "other");
    setShowActionDialog(true);
  };

  const closeReportActionDialog = () => {
    setShowActionDialog(false);
    setShowActionConfirm(false);
    setSelectedReport(null);
    setActionNotes("");
    setActionType("dismiss");
    setPolicyCategory("other");
    const trigger = reportDialogTriggerRef.current;
    reportDialogTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  };

  // Fetch paginated reports through the backend admin read model.
  const { data: reportsPayload, isLoading, isError } = useQuery({
    queryKey: ["admin-reports", statusFilter, sortField, sortDirection, reportSearchQuery, pageIndex],
    queryFn: async () => {
      const payload = await callAdminRpc<ReportsReadModelPayload>("admin_get_reports_read_model", {
        p_status: statusFilter,
        p_sort_field: sortField,
        p_sort_direction: sortDirection,
        p_limit: REPORTS_PAGE_SIZE,
        p_offset: pageIndex * REPORTS_PAGE_SIZE,
        p_search: reportSearchQuery || null,
      });

      return {
        reports: (payload.reports ?? []).map((report) => ({
          ...report,
          reporter_profile: report.reporter_profile
            ? {
                ...report.reporter_profile,
                avatarUrl: avatarPreset(
                  resolvePrimaryProfilePhotoPath({
                    photos: report.reporter_profile.photos,
                    avatar_url: report.reporter_profile.avatar_url,
                  }),
                ),
              }
            : null,
          reported_profile: report.reported_profile
            ? {
                ...report.reported_profile,
                avatarUrl: avatarPreset(
                  resolvePrimaryProfilePhotoPath({
                    photos: report.reported_profile.photos,
                    avatar_url: report.reported_profile.avatar_url,
                  }),
                ),
              }
            : null,
        })) as UserReportRow[],
        totalCount: Number(payload.total_count ?? 0),
        limit: Number(payload.limit ?? REPORTS_PAGE_SIZE),
        offset: Number(payload.offset ?? pageIndex * REPORTS_PAGE_SIZE),
      };
    },
  });

  const reports = useMemo(() => reportsPayload?.reports ?? [], [reportsPayload?.reports]);
  const totalCount = Number(reportsPayload?.totalCount ?? reports.length);
  const totalPages = Math.max(1, Math.ceil(totalCount / REPORTS_PAGE_SIZE));
  const firstVisibleReport = totalCount === 0 ? 0 : pageIndex * REPORTS_PAGE_SIZE + 1;
  const lastVisibleReport = Math.min(totalCount, pageIndex * REPORTS_PAGE_SIZE + reports.length);
  const canGoPrevious = pageIndex > 0;
  const canGoNext = pageIndex + 1 < totalPages;

  const profiles = useMemo(() => {
    const profileMap: Record<string, ReportProfileRow> = {};
    for (const report of reports) {
      if (report.reporter_profile?.id) profileMap[report.reporter_profile.id] = report.reporter_profile;
      if (report.reported_profile?.id) profileMap[report.reported_profile.id] = report.reported_profile;
    }
    return profileMap;
  }, [reports]);
  const reportsUnavailable = isError;

  useEffect(() => {
    setPageIndex(0);
  }, [reportSearchQuery, sortField, sortDirection, statusFilter]);

  useEffect(() => {
    if (!isLoading && !isError && pageIndex > 0 && reports.length === 0) {
      setPageIndex(Math.max(0, totalPages - 1));
    }
  }, [isError, isLoading, pageIndex, reports.length, totalPages]);

  const resolveReport = useMutation({
    mutationFn: async ({
      report,
      action,
      notes,
      policyCategory,
    }: {
      report: UserReportRow;
      action: ReportActionType;
      notes: string;
      policyCategory: PolicyCategory;
    }) => {
      const rpcAction =
        action === "warn" ? "issue_warning" : action === "suspend" ? "suspend_user" : "dismiss";
      return callAdminRpc("admin_resolve_report_with_policy", {
        p_report_id: report.id,
        p_action: rpcAction,
        p_reason: notes || reasonLabels[report.reason] || report.reason,
        p_message: notes || null,
        p_suspension_expires_at: null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_resolve_report", report.id, {
          action: rpcAction,
          report_status: report.status,
          report_created_at: report.created_at,
          policy_category: policyCategory,
          reason: notes || reasonLabels[report.reason] || report.reason,
        }),
        p_policy_category: policyCategory,
        p_recommendation_id: null,
      });
    },
    onSuccess: (_data, variables) => {
      void invalidateAdminQueries(queryClient, ["reports", "overview", "badges"]);
      const inspectedStatus = variables.action === "dismiss" ? "dismissed" : "action_taken";
      const reportForInspection = { ...variables.report, status: inspectedStatus };
      adminToast.success({
        id: `admin-report-action-${variables.report.id}`,
        title: "Report action completed",
        description: "This moderation action is not undoable from the toast. Reopen the report record if you need to inspect the result.",
        action: {
          label: "Reopen report",
          onClick: () => openReportActionDialog(reportForInspection),
        },
      });
      closeReportActionDialog();
    },
    onError: () => {
      adminToast.error({
        id: "admin-report-action-error",
        title: "Report action was not completed",
        description: "The backend admin_resolve_report transaction failed, so no partial UI success was reported.",
      });
    },
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    setPageIndex(0);
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4 text-muted-foreground" />;
    return sortDirection === "asc" ? (
      <ChevronUp className="w-4 h-4 text-primary" />
    ) : (
      <ChevronDown className="w-4 h-4 text-primary" />
    );
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
      reviewed: "bg-blue-500/10 text-blue-400 border-blue-500/30",
      action_taken: "bg-green-500/10 text-green-400 border-green-500/30",
      dismissed: "bg-gray-500/10 text-gray-400 border-gray-500/30",
    };

    const icons: Record<string, LucideIcon> = {
      pending: Clock,
      reviewed: Eye,
      action_taken: CheckCircle,
      dismissed: XCircle,
    };

    const Icon = icons[status] || Clock;

    return (
      <Badge variant="outline" className={styles[status] || styles.pending}>
        <Icon className="w-3 h-3 mr-1" />
        {status.replace("_", " ")}
      </Badge>
    );
  };

  const getAriaSort = (field: SortField): AriaAttributes["aria-sort"] => {
    if (sortField !== field) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  };

  const activateReportRow = (report: UserReportRow, trigger: HTMLElement | null) => {
    if (report.status !== "pending") return;
    openReportActionDialog(report, trigger);
  };

  const handleReportRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, report: UserReportRow) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateReportRow(report, event.currentTarget);
  };

  const handleTakeAction = async () => {
    if (!selectedReport) return;
    const notes = actionNotes.trim();

    if ((actionType === "warn" || actionType === "suspend") && !notes) {
      adminToast.error({
        id: "admin-report-notes-required",
        title: actionType === "warn" ? "Add a warning message before issuing a warning" : "Add suspension notes before suspending the user",
      });
      return;
    }

    try {
      await resolveReport.mutateAsync({
        report: selectedReport,
        action: actionType,
        notes,
        policyCategory,
      });
    } catch (error) {
      adminToast.error({
        id: "admin-report-action-error",
        title: "Report action was not completed",
        description:
          actionType === "dismiss"
            ? "The backend report resolution transaction failed."
            : "The required moderation side effect and report closure run in one backend transaction. Review the user and report state before retrying.",
      });
      throw error;
    }
  };

  const requestReportActionConfirmation = () => {
    if (!selectedReport) return;
    const notes = actionNotes.trim();
    if ((actionType === "warn" || actionType === "suspend") && !notes) {
      adminToast.error({
        id: "admin-report-notes-required",
        title: actionType === "warn" ? "Add a warning message before issuing a warning" : "Add suspension notes before suspending the user",
      });
      return;
    }
    setShowActionConfirm(true);
  };

  const reportActionPending = resolveReport.isPending;
  const selectedReportIsActionable = selectedReport?.status === "pending";
  const reportActionLabel =
    actionType === "suspend" ? "Suspend User" : actionType === "warn" ? "Issue Warning" : "Dismiss Report";
  const reportActionDescription = selectedReport
    ? actionType === "suspend"
      ? `This will suspend ${profiles?.[selectedReport.reported_id]?.name || "the reported user"}, create a suspension record, attach policy category "${policyLabel(policyCategory)}", and mark this report as action taken only after the suspension writes succeed.\n\nReason: ${actionNotes.trim()}`
      : actionType === "warn"
        ? `This will create a user-visible warning for ${profiles?.[selectedReport.reported_id]?.name || "the reported user"}, attach policy category "${policyLabel(policyCategory)}", and mark this report as action taken in the same backend transaction.\n\nMessage: ${actionNotes.trim()}`
        : `This will mark the report as dismissed through admin_resolve_report with policy category "${policyLabel(policyCategory)}".${actionNotes.trim() ? `\n\nNotes: ${actionNotes.trim()}` : ""}`
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Summary Cards */}
      <AdminReportsSummary />
      {/* Filters */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search by user name or reason..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPageIndex(0);
              }}
              className="pl-11 bg-secondary/50"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPageIndex(0);
            }}
          >
            <SelectTrigger className="w-full md:w-[180px] bg-secondary/50">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="action_taken">Action Taken</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Showing {firstVisibleReport}-{lastVisibleReport} of {totalCount} reports
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Page {pageIndex + 1} of {totalPages}.
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
      </div>

      {/* Reports Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead>Reported User</TableHead>
                <TableHead>Reporter</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead aria-sort={getAriaSort("created_at")}>
                  <button
                    type="button"
                    aria-label={`Sort by report date ${sortField === "created_at" ? sortDirection : "inactive"}`}
                    onClick={() => handleSort("created_at")}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Date
                    {getSortIcon("created_at")}
                  </button>
                </TableHead>
                <TableHead aria-sort={getAriaSort("status")}>
                  <button
                    type="button"
                    aria-label={`Sort by report status ${sortField === "status" ? sortDirection : "inactive"}`}
                    onClick={() => handleSort("status")}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Status
                    {getSortIcon("status")}
                  </button>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell colSpan={6}>
                      <div className="h-12 bg-secondary/50 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : reportsUnavailable ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={6}>
                    <AdminEmptyState
                      icon={AlertTriangle}
                      title="Reports unavailable"
                      description="This is a fetch failure, not proof that no reports exist."
                      tone="danger"
                    />
                  </TableCell>
                </TableRow>
              ) : reports.length === 0 ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={6}>
                    <AdminEmptyState
                      icon={AlertTriangle}
                      title="No reports found"
                      description={reportSearchQuery || statusFilter !== "all" ? "Try clearing search or status filters." : "New safety reports will appear here."}
                      actionLabel={reportSearchQuery || statusFilter !== "all" ? "Clear filters" : undefined}
                      onAction={
                        reportSearchQuery || statusFilter !== "all"
                          ? () => {
                              setSearchQuery("");
                              setStatusFilter("all");
                            }
                          : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((report) => {
                  const reported = profiles?.[report.reported_id];
                  const reporter = profiles?.[report.reporter_id];
                  const ReasonIcon = reasonIcons[report.reason] || AlertTriangle;

                  return (
                    <TableRow
                      key={report.id}
                      tabIndex={0}
                      aria-label={`Report against ${reported?.name || "unknown user"} from ${reporter?.name || "unknown reporter"}. ${report.status === "pending" ? "Press Enter to review." : "Already reviewed."}`}
                      aria-disabled={report.status !== "pending"}
                      onClick={(event) => activateReportRow(report, event.currentTarget)}
                      onKeyDown={(event) => handleReportRowKeyDown(event, report)}
                      className={`border-border/50 hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${report.status === "pending" ? "cursor-pointer" : ""}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 border-2 border-red-500/30">
                            <AvatarImage src={reported?.avatarUrl} />
                            <AvatarFallback className="bg-red-500/20 text-red-400">
                              {reported?.name?.[0] || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">
                            {reported?.name || "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={reporter?.avatarUrl} />
                            <AvatarFallback>{reporter?.name?.[0] || "?"}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-muted-foreground">
                            {reporter?.name || "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ReasonIcon className="w-4 h-4 text-red-400" />
                          <span>{reasonLabels[report.reason] || report.reason}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatAdminUtcDateTime(report.created_at)}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(report.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            openReportActionDialog(report, event.currentTarget);
                          }}
                          className="gap-2"
                          disabled={report.status !== "pending"}
                        >
                          <Shield className="w-4 h-4" />
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Action Dialog */}
      <Dialog
        open={showActionDialog}
        onOpenChange={(open) => {
          if (open) {
            setShowActionDialog(true);
          } else {
            closeReportActionDialog();
          }
        }}
      >
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>{selectedReportIsActionable ? "Review Report" : "Report Record"}</DialogTitle>
            <DialogDescription>
              {selectedReportIsActionable
                ? "Take action on this report against "
                : "This report has already been handled and is open for inspection against "}
              {selectedReport ? profiles?.[selectedReport.reported_id]?.name || "the reported user" : "the reported user"}
            </DialogDescription>
          </DialogHeader>

          {selectedReport && (
            <div className="space-y-4">
              {/* Report details */}
              <div className="glass-card p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Reason:</span>
                  <span className="text-foreground">
                    {reasonLabels[selectedReport.reason] || selectedReport.reason}
                  </span>
                </div>
                {selectedReport.details && (
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Details:</span>
                    <p className="text-foreground mt-1">{selectedReport.details}</p>
                  </div>
                )}
              </div>

              {/* Action type */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Action</label>
                <Select
                  value={actionType}
                  onValueChange={(v) => setActionType(v as ReportActionType)}
                  disabled={!selectedReportIsActionable}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dismiss">Dismiss Report</SelectItem>
                    <SelectItem value="warn">Issue Warning</SelectItem>
                    <SelectItem value="suspend">Suspend User</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Policy category</label>
                <Select
                  value={policyCategory}
                  onValueChange={(v) => setPolicyCategory(v as PolicyCategory)}
                  disabled={!selectedReportIsActionable}
                >
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {policyCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  P4 attaches policy context for triage and audit. It does not automate enforcement.
                </p>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Notes</label>
                <Textarea
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder="Add notes about this action..."
                  readOnly={!selectedReportIsActionable}
                  className="bg-secondary/50"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeReportActionDialog}>
              {selectedReportIsActionable ? "Cancel" : "Close"}
            </Button>
            {selectedReportIsActionable ? (
              <Button
                onClick={requestReportActionConfirmation}
                disabled={reportActionPending}
                className={
                  actionType === "suspend"
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-primary"
                }
              >
                {reportActionPending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : actionType === "suspend" ? (
                  <>
                    <Ban className="w-4 h-4 mr-2" />
                    Suspend User
                  </>
                ) : actionType === "warn" ? (
                  <>
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Issue Warning
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 mr-2" />
                    Dismiss
                  </>
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AdminConfirmDialog
        open={showActionConfirm}
        title={`${reportActionLabel}?`}
        description={reportActionDescription}
        confirmLabel={reportActionLabel}
        variant={actionType === "suspend" ? "destructive" : "default"}
        isPending={reportActionPending}
        onOpenChange={setShowActionConfirm}
        onConfirm={handleTakeAction}
      />
    </motion.div>
  );
};

export default AdminReportsPanel;
