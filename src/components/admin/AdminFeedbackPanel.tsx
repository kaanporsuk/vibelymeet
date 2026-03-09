import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { toast } from "sonner";

type FeedbackStatus = "new" | "reviewed" | "resolved" | "dismissed";

interface FeedbackItem {
  id: string;
  user_id: string | null;
  category: string;
  message: string;
  device_info: Record<string, unknown> | null;
  page_url: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  userName?: string;
}

const categoryConfig: Record<string, { label: string; className: string }> = {
  bug: {
    label: "🐛 Bug",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  feature: {
    label: "💡 Feature",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  question: {
    label: "❓ Question",
    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  },
  other: {
    label: "💬 Other",
    className: "bg-secondary text-muted-foreground border-border",
  },
};

const statusConfig: Record<string, { label: string; className: string }> = {
  new: {
    label: "New",
    className: "bg-primary/20 text-primary border-primary/30",
  },
  reviewed: {
    label: "Reviewed",
    className: "bg-secondary text-muted-foreground border-border",
  },
  resolved: {
    label: "Resolved",
    className: "bg-green-500/15 text-green-400 border-green-500/30",
  },
  dismissed: {
    label: "Dismissed",
    className: "bg-muted/50 text-muted-foreground border-border",
  },
};

const STATUSES: FeedbackStatus[] = ["new", "reviewed", "resolved", "dismissed"];

const AdminFeedbackPanel = () => {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminNotesDraft, setAdminNotesDraft] = useState<Record<string, string>>({});

  const { data: feedback = [], isLoading } = useQuery({
    queryKey: ["admin-feedback"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const userIds = [
        ...new Set((data || []).map((f) => f.user_id).filter(Boolean)),
      ] as string[];

      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", userIds);
        profileMap = Object.fromEntries(
          (profiles || []).map((p) => [p.id, p.name])
        );
      }

      return (data || []).map((item) => ({
        ...item,
        device_info: item.device_info as Record<string, unknown> | null,
        userName: item.user_id
          ? profileMap[item.user_id] || "Unknown user"
          : "Anonymous",
      })) as FeedbackItem[];
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("feedback")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
      queryClient.invalidateQueries({ queryKey: ["admin-new-feedback-count"] });
      toast.success("Status updated");
    },
    onError: () => toast.error("Failed to update status"),
  });

  const saveNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from("feedback")
        .update({ admin_notes: notes })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
      toast.success("Notes saved");
    },
    onError: () => toast.error("Failed to save notes"),
  });

  const handleExpand = (item: FeedbackItem) => {
    if (expandedId === item.id) {
      setExpandedId(null);
    } else {
      setExpandedId(item.id);
      if (adminNotesDraft[item.id] === undefined) {
        setAdminNotesDraft((prev) => ({
          ...prev,
          [item.id]: item.admin_notes ?? "",
        }));
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="glass-card p-4 animate-pulse h-16 rounded-xl"
          />
        ))}
      </div>
    );
  }

  if (feedback.length === 0) {
    return (
      <div className="glass-card p-12 text-center rounded-xl">
        <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">No feedback yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Submissions from users will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {feedback.map((item) => {
        const catCfg = categoryConfig[item.category] || categoryConfig.other;
        const stCfg = statusConfig[item.status] || statusConfig.new;
        const isExpanded = expandedId === item.id;

        return (
          <div
            key={item.id}
            className="glass-card rounded-xl overflow-hidden border border-border/30"
          >
            {/* Row Summary */}
            <button
              className="w-full p-4 flex items-start gap-3 text-left hover:bg-secondary/20 transition-colors"
              onClick={() => handleExpand(item)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border font-medium ${catCfg.className}`}
                  >
                    {catCfg.label}
                  </span>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border font-medium ${stCfg.className}`}
                  >
                    {stCfg.label}
                  </span>
                </div>
                <p className="text-sm text-foreground line-clamp-1">
                  {item.message.slice(0, 80)}
                  {item.message.length > 80 ? "…" : ""}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{item.userName}</span>
                  <span>·</span>
                  <span>
                    {formatDistanceToNow(new Date(item.created_at!), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
              )}
            </button>

            {/* Expanded Detail */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-border/40 space-y-4 pt-4">
                {/* Full Message */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Full Message
                  </p>
                  <p className="text-sm text-foreground bg-secondary/40 rounded-lg p-3 leading-relaxed">
                    {item.message}
                  </p>
                </div>

                {/* Page URL */}
                {item.page_url && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Page URL
                    </p>
                    <p className="text-sm text-foreground font-mono bg-secondary/40 rounded-lg p-2">
                      {item.page_url}
                    </p>
                  </div>
                )}

                {/* Device Info */}
                {item.device_info && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Device Info
                    </p>
                    <div className="text-xs bg-secondary/40 rounded-lg p-3 space-y-1 font-mono">
                      {Object.entries(item.device_info).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-muted-foreground min-w-[80px]">
                            {k}:
                          </span>
                          <span className="text-foreground break-all">
                            {String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Status Selector */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Status
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((s) => {
                      const cfg = statusConfig[s];
                      const isActive = item.status === s;
                      return (
                        <button
                          key={s}
                          onClick={() =>
                            updateStatusMutation.mutate({ id: item.id, status: s })
                          }
                          disabled={isActive || updateStatusMutation.isPending}
                          className={`px-3 py-1 rounded-full text-xs border transition-all ${
                            isActive
                              ? cfg.className + " font-semibold"
                              : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary/60"
                          }`}
                        >
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Admin Notes */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Admin Notes
                  </p>
                  <Textarea
                    placeholder="Add internal notes about this feedback..."
                    value={adminNotesDraft[item.id] ?? ""}
                    onChange={(e) =>
                      setAdminNotesDraft((prev) => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    rows={3}
                    className="resize-none text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() =>
                      saveNotesMutation.mutate({
                        id: item.id,
                        notes: adminNotesDraft[item.id] ?? "",
                      })
                    }
                    disabled={saveNotesMutation.isPending}
                  >
                    {saveNotesMutation.isPending ? "Saving…" : "Save Notes"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AdminFeedbackPanel;
