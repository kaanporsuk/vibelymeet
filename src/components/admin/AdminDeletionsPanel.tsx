import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Clock, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminConfirmDialog from "./AdminConfirmDialog";
import {
  callAdminRpc,
  createAdminTargetIdempotencyKey,
  sanitizeAdminRpcErrorMessage,
  type AdminRpcPayload,
} from "@/lib/adminRpc";
import { formatAdminUtcDateTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";

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
  completion_job_id?: string | null;
  completion_job_state?: string | null;
  completion_attempts?: number | null;
  completion_next_retry_at?: string | null;
  completion_last_error?: string | null;
  completion_error_code?: string | null;
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

function formatTimestamp(value: string | null | undefined, _dateFormat = "MMM d, yyyy HH:mm") {
  return formatAdminUtcDateTime(value, "Unavailable");
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

function completionActionHint(request: DeletionRequest) {
  if (!request.scheduled_deletion_at) return "Missing scheduled date";
  if (!request.completion_job_state) return "Eligible after scheduled date";
  if (request.completion_job_state === "queued") return "Cleanup already queued";
  if (request.completion_job_state === "processing") return "Cleanup in progress";
  if (request.completion_job_state === "completed") return "Cleanup completed";
  return "Review job state before retry";
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
        p_reason: "Durable completion job queued from Admin Account Deletions tab",
        p_idempotency_key: createAdminTargetIdempotencyKey(
          "admin_mark_account_deletion_completed",
          request.id,
          {
            intent: "queue-durable-completion-v1",
            completion_job_id: request.completion_job_id ?? null,
            completion_job_state: request.completion_job_state ?? "missing",
            completion_attempts: request.completion_attempts ?? 0,
            completion_error_code: request.completion_error_code ?? null,
            completion_next_retry_at: request.completion_next_retry_at ?? null,
          },
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACCOUNT_DELETIONS_QUERY_KEY] });
      setRequestToComplete(null);
      adminToast.success({
        id: "account-deletion-completion-queued",
        title: "Deletion completion job queued",
      });
    },
    onError: (reason) => {
      adminToast.error({
        id: "account-deletion-completion-failed",
        title: sanitizeAdminRpcErrorMessage(reason),
      });
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
          {request.completion_job_state && (
            <p className="text-xs text-muted-foreground">
              Completion job: {request.completion_job_state}
            </p>
          )}
          {request.completion_last_error && (
            <p className="text-xs text-destructive break-words">
              Last job error: {request.completion_error_code || "job_error"}
            </p>
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
              Queue Cleanup
            </Button>
            {!request.can_mark_completed && (
              <p className="text-[11px] text-muted-foreground text-right">
                {completionActionHint(request)}
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
        title="Queue durable deletion cleanup?"
        description={`This queues the durable completion worker for ${requestToComplete?.user_name || "this user"}.\n\nThe request will not be marked completed until provider cleanup, media cleanup, profile PII scrub, and Supabase auth deletion all succeed.`}
        confirmLabel="Queue Cleanup"
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
