import { useMemo, useState } from "react";
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
import { format } from "date-fns";
import { toast } from "sonner";
import { avatarUrl as avatarPreset } from "@/utils/imageUrl";
import { REPORT_REASONS, type ReportReasonId } from "../../../shared/safety/reportReasons";
import { resolvePrimaryProfilePhotoPath } from "../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminIdempotencyKey, type AdminRpcPayload } from "@/lib/adminRpc";
import { ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY } from "@/hooks/useAdminOverviewDashboard";
import { normalizeReportSearchText, resolveReportSearchQuery } from "./adminReportSearch";

type SortField = "created_at" | "status";
type SortDirection = "asc" | "desc";
type ReportActionType = "dismiss" | "warn" | "suspend";
type PolicyCategory = "harassment" | "fake" | "inappropriate" | "spam" | "safety" | "underage" | "no_show" | "payment" | "other";

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
  const normalizedSearchQuery = searchQuery.trim();
  const reportSearchQuery = resolveReportSearchQuery(normalizedSearchQuery);

  const openReportActionDialog = (report: UserReportRow) => {
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
  };

  // Fetch all reports
  const { data: reports, isLoading, isError } = useQuery({
    queryKey: ["admin-reports", statusFilter, sortField, sortDirection, normalizedSearchQuery, reportSearchQuery],
    queryFn: async () => {
      const payload = await callAdminRpc<ReportsReadModelPayload>("admin_get_reports_read_model", {
        p_status: statusFilter,
        p_sort_field: sortField,
        p_sort_direction: sortDirection,
        p_limit: 200,
        p_search: reportSearchQuery || null,
      });

      return (payload.reports ?? []).map((report) => ({
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
      })) as UserReportRow[];
    },
  });

  const profiles = useMemo(() => {
    const profileMap: Record<string, ReportProfileRow> = {};
    for (const report of reports ?? []) {
      if (report.reporter_profile?.id) profileMap[report.reporter_profile.id] = report.reporter_profile;
      if (report.reported_profile?.id) profileMap[report.reported_profile.id] = report.reported_profile;
    }
    return profileMap;
  }, [reports]);
  const reportsUnavailable = isError && (!reports || reports.length === 0);

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
        p_idempotency_key: createAdminIdempotencyKey("admin_resolve_report"),
        p_policy_category: policyCategory,
        p_recommendation_id: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
      queryClient.invalidateQueries({ queryKey: ["admin-reports-summary"] });
      queryClient.invalidateQueries({ queryKey: ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY });
      toast.success("Report action completed");
      closeReportActionDialog();
    },
    onError: () => {
      toast.error("Report action was not completed", {
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

  const handleTakeAction = async () => {
    if (!selectedReport) return;
    const notes = actionNotes.trim();

    if ((actionType === "warn" || actionType === "suspend") && !notes) {
      toast.error(actionType === "warn" ? "Add a warning message before issuing a warning" : "Add suspension notes before suspending the user");
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
      toast.error("Report action was not completed", {
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
      toast.error(actionType === "warn" ? "Add a warning message before issuing a warning" : "Add suspension notes before suspending the user");
      return;
    }
    setShowActionConfirm(true);
  };

  const reportActionPending = resolveReport.isPending;
  const reportActionLabel =
    actionType === "suspend" ? "Suspend User" : actionType === "warn" ? "Issue Warning" : "Dismiss Report";
  const reportActionDescription = selectedReport
    ? actionType === "suspend"
      ? `This will suspend ${profiles?.[selectedReport.reported_id]?.name || "the reported user"}, create a suspension record, attach policy category "${policyLabel(policyCategory)}", and mark this report as action taken only after the suspension writes succeed.\n\nReason: ${actionNotes.trim()}`
      : actionType === "warn"
        ? `This will create a user-visible warning for ${profiles?.[selectedReport.reported_id]?.name || "the reported user"}, attach policy category "${policyLabel(policyCategory)}", and mark this report as action taken in the same backend transaction.\n\nMessage: ${actionNotes.trim()}`
        : `This will mark the report as dismissed through admin_resolve_report with policy category "${policyLabel(policyCategory)}".${actionNotes.trim() ? `\n\nNotes: ${actionNotes.trim()}` : ""}`
    : "";

  // Filter by search query
  const filteredReports = reports?.filter((report) => {
    if (!normalizedSearchQuery) return true;
    const reporter = profiles?.[report.reporter_id];
    const reported = profiles?.[report.reported_id];
    const searchLower = normalizedSearchQuery.toLowerCase();
    const normalizedSearch = normalizeReportSearchText(normalizedSearchQuery);
    const reasonLabel = reasonLabels[report.reason] || report.reason;
    return (
      reporter?.name?.toLowerCase().includes(searchLower) ||
      reported?.name?.toLowerCase().includes(searchLower) ||
      report.reason?.toLowerCase().includes(searchLower) ||
      reasonLabel.toLowerCase().includes(searchLower) ||
      normalizeReportSearchText(reasonLabel).includes(normalizedSearch)
    );
  });

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
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 bg-secondary/50"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                <TableHead>
                  <button
                    onClick={() => handleSort("created_at")}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Date
                    {getSortIcon("created_at")}
                  </button>
                </TableHead>
                <TableHead>
                  <button
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
                  <TableCell colSpan={6} className="text-center py-8 text-destructive">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-70" />
                    <p className="font-medium">Reports unavailable</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This is a fetch failure, not proof that no reports exist.
                    </p>
                  </TableCell>
                </TableRow>
              ) : filteredReports?.length === 0 ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No reports found
                  </TableCell>
                </TableRow>
              ) : (
                filteredReports?.map((report) => {
                  const reported = profiles?.[report.reported_id];
                  const reporter = profiles?.[report.reporter_id];
                  const ReasonIcon = reasonIcons[report.reason] || AlertTriangle;

                  return (
                    <TableRow key={report.id} className="border-border/50 hover:bg-secondary/30">
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
                          {format(new Date(report.created_at), "MMM d, yyyy")}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(report.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openReportActionDialog(report)}
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
            <DialogTitle>Review Report</DialogTitle>
            <DialogDescription>
              Take action on this report against{" "}
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
                <Select value={actionType} onValueChange={(v) => setActionType(v as ReportActionType)}>
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
                <Select value={policyCategory} onValueChange={(v) => setPolicyCategory(v as PolicyCategory)}>
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
                  className="bg-secondary/50"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeReportActionDialog}>
              Cancel
            </Button>
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
