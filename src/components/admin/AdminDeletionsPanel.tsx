import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle, Clock, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminConfirmDialog from "./AdminConfirmDialog";
import {
  callAdminRpc,
  createAdminIdempotencyKey,
  sanitizeAdminRpcErrorMessage,
  type AdminRpcPayload,
} from "@/lib/adminRpc";

type TabFilter = "pending" | "completed" | "cancelled";

type DeletionRequest = {
  id: string;
  user_id: string;
  user_name: string | null;
  status: TabFilter | string;
  requested_at: string | null;
  scheduled_deletion_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reason: string | null;
  can_mark_completed: boolean;
};

type AccountDeletionCounts = {
  pending: number;
  completed: number;
  recovered: number;
  other: number;
};

type AccountDeletionListPayload = AdminRpcPayload & {
  counts?: Partial<AccountDeletionCounts>;
  rows?: DeletionRequest[];
};

const EMPTY_COUNTS: AccountDeletionCounts = {
  pending: 0,
  completed: 0,
  recovered: 0,
  other: 0,
};

const ACCOUNT_DELETIONS_QUERY_KEY = "admin-account-deletions";

function formatTimestamp(value: string | null | undefined, dateFormat = "MMM d, yyyy HH:mm") {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return format(date, dateFormat);
}

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="text-amber-500 border-amber-500/30">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="text-destructive border-destructive/30">
          <CheckCircle className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" className="text-muted-foreground border-border">
          <RotateCcw className="w-3 h-3 mr-1" />
          Recovered
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

const AdminDeletionsPanel = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabFilter>("pending");
  const [requestToComplete, setRequestToComplete] = useState<DeletionRequest | null>(null);

  const {
    data,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [ACCOUNT_DELETIONS_QUERY_KEY, activeTab],
    queryFn: async () => {
      const payload = await callAdminRpc<AccountDeletionListPayload>("admin_list_account_deletions", {
        p_status: activeTab,
        p_limit: 100,
      });

      return {
        counts: {
          pending: Number(payload.counts?.pending ?? 0),
          completed: Number(payload.counts?.completed ?? 0),
          recovered: Number(payload.counts?.recovered ?? 0),
          other: Number(payload.counts?.other ?? 0),
        },
        rows: payload.rows ?? [],
      };
    },
  });

  const counts = data?.counts ?? EMPTY_COUNTS;
  const requests = data?.rows ?? [];

  const markCompleted = useMutation({
    mutationFn: async (request: DeletionRequest) =>
      callAdminRpc("admin_mark_account_deletion_completed", {
        p_request_id: request.id,
        p_reason: "Verified from /kaan Account Deletions tab",
        p_idempotency_key: createAdminIdempotencyKey("admin_mark_account_deletion_completed"),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACCOUNT_DELETIONS_QUERY_KEY] });
      setRequestToComplete(null);
      toast.success("Deletion request marked completed as a verified checkpoint");
    },
    onError: (reason) => {
      toast.error(sanitizeAdminRpcErrorMessage(reason));
    },
  });

  const renderRequestRow = (request: DeletionRequest, showCompleteAction = false) => {
    const isCompleteActionDisabled = markCompleted.isPending || !request.can_mark_completed;

    return (
      <div
        key={request.id}
        className="flex items-center justify-between gap-4 p-4 rounded-xl bg-secondary/40 border border-border/50"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-foreground text-sm">
              {request.user_name || "Unknown User"}
            </p>
            {statusBadge(request.status)}
          </div>
          <p className="text-xs text-muted-foreground">
            Requested: {formatTimestamp(request.requested_at)}
          </p>
          {request.scheduled_deletion_at && request.status === "pending" && (
            <p className="text-xs text-amber-500">
              Scheduled: {formatTimestamp(request.scheduled_deletion_at, "MMM d, yyyy")}
            </p>
          )}
          {request.completed_at && (
            <p className="text-xs text-muted-foreground">
              Completed: {formatTimestamp(request.completed_at)}
            </p>
          )}
          {request.cancelled_at && (
            <p className="text-xs text-muted-foreground">
              Recovered: {formatTimestamp(request.cancelled_at)}
            </p>
          )}
          {request.reason && (
            <p className="text-xs text-muted-foreground break-words">Reason: {request.reason}</p>
          )}
        </div>
        {showCompleteAction && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setRequestToComplete(request)}
              disabled={isCompleteActionDisabled}
              className="gap-1"
            >
              {markCompleted.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              Mark Completed
            </Button>
            {!request.can_mark_completed && (
              <p className="text-[11px] text-muted-foreground text-right">
                {request.scheduled_deletion_at
                  ? "Eligible after scheduled date"
                  : "Missing scheduled date"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
          <div className="space-y-3">
            <div>
              <p className="font-medium text-foreground">Unable to load account deletion requests</p>
              <p className="text-sm text-muted-foreground">
                {sanitizeAdminRpcErrorMessage(error)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{counts.pending}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{counts.completed}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-muted-foreground">{counts.recovered}</p>
          <p className="text-xs text-muted-foreground">Recovered</p>
        </div>
      </div>

      {counts.other > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              {counts.other} account deletion {counts.other === 1 ? "request has" : "requests have"}{" "}
              unsupported statuses and are hidden from these tabs.
            </p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabFilter)}>
        <TabsList className="w-full">
          <TabsTrigger value="pending" className="flex-1">
            Pending ({counts.pending})
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">
            Completed ({counts.completed})
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="flex-1">
            Recovered ({counts.recovered})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3 mt-4">
          {isFetching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No pending deletion requests</p>
          ) : (
            requests.map((request) => renderRequestRow(request, true))
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-3 mt-4">
          {isFetching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No completed deletions</p>
          ) : (
            requests.map((request) => renderRequestRow(request))
          )}
        </TabsContent>

        <TabsContent value="cancelled" className="space-y-3 mt-4">
          {isFetching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No recovered accounts</p>
          ) : (
            requests.map((request) => renderRequestRow(request))
          )}
        </TabsContent>
      </Tabs>

      <AdminConfirmDialog
        open={!!requestToComplete}
        title="Mark deletion request completed?"
        description={`This does not delete the Supabase auth user or profile.\n\nIt marks this request as a verified completion checkpoint for ${requestToComplete?.user_name || "this user"}. Existing database triggers may release account-deletion media holds.`}
        confirmLabel="Mark Completed"
        isPending={markCompleted.isPending}
        onOpenChange={(open) => {
          if (!open) setRequestToComplete(null);
        }}
        onConfirm={() => {
          if (requestToComplete) return markCompleted.mutateAsync(requestToComplete);
        }}
      />
    </div>
  );
};

export default AdminDeletionsPanel;
