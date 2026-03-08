import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Loader2, Trash2, CheckCircle, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AdminDeletionsPanel = () => {
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["admin-deletion-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_deletion_requests")
        .select("*")
        .order("requested_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch profile names for display
  const userIds = [...new Set(requests.map((r: any) => r.user_id))];
  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-deletion-profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, name, email_verified, avatar_url")
        .in("id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const profileMap = new Map(profiles.map((p: any) => [p.id, p]));

  const processNow = useMutation({
    mutationFn: async (requestId: string) => {
      const request = requests.find((r: any) => r.id === requestId);
      if (!request) throw new Error("Request not found");

      // Mark as completed
      const { error } = await supabase
        .from("account_deletion_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", requestId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-deletion-requests"] });
      toast.success("Deletion request marked as completed");
    },
    onError: () => {
      toast.error("Failed to process deletion");
    },
  });

  const pending = requests.filter((r: any) => r.status === "pending");
  const completed = requests.filter((r: any) => r.status === "completed");
  const cancelled = requests.filter((r: any) => r.status === "cancelled");

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-amber-500 border-amber-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "completed":
        return <Badge variant="outline" className="text-destructive border-destructive/30"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="text-muted-foreground border-border"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const renderRequestRow = (request: any, showProcessButton = false) => {
    const profile = profileMap.get(request.user_id);
    return (
      <div key={request.id} className="flex items-center justify-between p-4 rounded-xl bg-secondary/40 border border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground text-sm">
              {profile?.name || "Unknown User"}
            </p>
            {statusBadge(request.status)}
          </div>
          <p className="text-xs text-muted-foreground">
            Requested: {format(new Date(request.requested_at), "MMM d, yyyy HH:mm")}
          </p>
          {request.scheduled_deletion_at && request.status === "pending" && (
            <p className="text-xs text-amber-500">
              Scheduled: {format(new Date(request.scheduled_deletion_at), "MMM d, yyyy")}
            </p>
          )}
          {request.reason && (
            <p className="text-xs text-muted-foreground">Reason: {request.reason}</p>
          )}
          {request.cancelled_at && (
            <p className="text-xs text-muted-foreground">
              Recovered: {format(new Date(request.cancelled_at), "MMM d, yyyy HH:mm")}
            </p>
          )}
        </div>
        {showProcessButton && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => processNow.mutate(request.id)}
            disabled={processNow.isPending}
            className="gap-1"
          >
            {processNow.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Process Now
          </Button>
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

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{pending.length}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{completed.length}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-muted-foreground">{cancelled.length}</p>
          <p className="text-xs text-muted-foreground">Recovered</p>
        </div>
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="w-full">
          <TabsTrigger value="pending" className="flex-1">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">Completed ({completed.length})</TabsTrigger>
          <TabsTrigger value="cancelled" className="flex-1">Recovered ({cancelled.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3 mt-4">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No pending deletion requests</p>
          ) : (
            pending.map((r: any) => renderRequestRow(r, true))
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-3 mt-4">
          {completed.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No completed deletions</p>
          ) : (
            completed.map((r: any) => renderRequestRow(r))
          )}
        </TabsContent>

        <TabsContent value="cancelled" className="space-y-3 mt-4">
          {cancelled.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No recovered accounts</p>
          ) : (
            cancelled.map((r: any) => renderRequestRow(r))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminDeletionsPanel;
