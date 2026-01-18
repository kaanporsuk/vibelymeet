import { useState } from "react";
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
  Frown,
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
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import { getSignedPhotoUrl, extractPathFromSignedUrl, isSignedUrlExpiring } from "@/services/storageService";

type SortField = "created_at" | "status";
type SortDirection = "asc" | "desc";

const reasonIcons: Record<string, any> = {
  harassment: MessageSquareWarning,
  fake: UserX,
  inappropriate: Camera,
  vibe: Frown,
};

const reasonLabels: Record<string, string> = {
  harassment: "Harassment",
  fake: "Fake Profile",
  inappropriate: "Inappropriate Content",
  vibe: "Vibe Mismatch",
};

const AdminReportsPanel = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [actionNotes, setActionNotes] = useState("");
  const [actionType, setActionType] = useState<"dismiss" | "warn" | "suspend">("dismiss");

  // Fetch all reports
  const { data: reports, isLoading } = useQuery({
    queryKey: ["admin-reports", statusFilter, sortField, sortDirection],
    queryFn: async () => {
      let query = supabase
        .from("user_reports")
        .select("*")
        .order(sortField, { ascending: sortDirection === "asc" });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch profiles for reporters and reported users
  const { data: profiles } = useQuery({
    queryKey: ["admin-report-profiles", reports],
    queryFn: async () => {
      if (!reports?.length) return {};

      const userIds = new Set<string>();
      reports.forEach((r) => {
        userIds.add(r.reporter_id);
        userIds.add(r.reported_id);
      });

      const { data } = await supabase
        .from("profiles")
        .select("id, name, avatar_url, photos")
        .in("id", Array.from(userIds));

      const profileMap: Record<string, any> = {};
      for (const p of data || []) {
        let avatarUrl = p.avatar_url || p.photos?.[0];
        if (avatarUrl && isSignedUrlExpiring(avatarUrl)) {
          const path = extractPathFromSignedUrl(avatarUrl);
          if (path) {
            const newUrl = await getSignedPhotoUrl(path);
            avatarUrl = newUrl || avatarUrl;
          }
        }
        profileMap[p.id] = { ...p, avatarUrl };
      }
      return profileMap;
    },
    enabled: !!reports?.length,
  });

  // Update report mutation
  const updateReport = useMutation({
    mutationFn: async ({
      reportId,
      status,
      actionTaken,
    }: {
      reportId: string;
      status: string;
      actionTaken: string;
    }) => {
      const { data: session } = await supabase.auth.getSession();
      const { error } = await supabase
        .from("user_reports")
        .update({
          status,
          action_taken: actionTaken,
          reviewed_at: new Date().toISOString(),
          reviewed_by: session.session?.user.id,
        })
        .eq("id", reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
      toast.success("Report updated successfully");
      setShowActionDialog(false);
      setSelectedReport(null);
      setActionNotes("");
    },
    onError: () => {
      toast.error("Failed to update report");
    },
  });

  // Suspend user mutation
  const suspendUser = useMutation({
    mutationFn: async (userId: string) => {
      const { data: session } = await supabase.auth.getSession();

      // Update profile
      await supabase
        .from("profiles")
        .update({ is_suspended: true, suspension_reason: actionNotes || "Multiple reports" })
        .eq("id", userId);

      // Create suspension record
      await supabase.from("user_suspensions").insert({
        user_id: userId,
        suspended_by: session.session?.user.id,
        reason: actionNotes || "Multiple reports",
        status: "active",
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

    const icons: Record<string, any> = {
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

    if (actionType === "suspend") {
      await suspendUser.mutateAsync(selectedReport.reported_id);
    }

    await updateReport.mutateAsync({
      reportId: selectedReport.id,
      status: actionType === "dismiss" ? "dismissed" : "action_taken",
      actionTaken: `${actionType}: ${actionNotes}`,
    });
  };

  // Filter by search query
  const filteredReports = reports?.filter((report) => {
    if (!searchQuery) return true;
    const reporter = profiles?.[report.reporter_id];
    const reported = profiles?.[report.reported_id];
    const searchLower = searchQuery.toLowerCase();
    return (
      reporter?.name?.toLowerCase().includes(searchLower) ||
      reported?.name?.toLowerCase().includes(searchLower) ||
      report.reason?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
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
                          onClick={() => {
                            setSelectedReport(report);
                            setShowActionDialog(true);
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
      <Dialog open={showActionDialog} onOpenChange={setShowActionDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Review Report</DialogTitle>
            <DialogDescription>
              Take action on this report against{" "}
              {profiles?.[selectedReport?.reported_id]?.name || "the reported user"}
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
                <Select value={actionType} onValueChange={(v: any) => setActionType(v)}>
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
            <Button variant="outline" onClick={() => setShowActionDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleTakeAction}
              disabled={updateReport.isPending || suspendUser.isPending}
              className={
                actionType === "suspend"
                  ? "bg-destructive hover:bg-destructive/90"
                  : "bg-primary"
              }
            >
              {updateReport.isPending || suspendUser.isPending ? (
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
    </motion.div>
  );
};

export default AdminReportsPanel;