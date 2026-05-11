import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import AdminConfirmDialog from "./AdminConfirmDialog";
import {
  callAdminRpc,
  createAdminIdempotencyKey,
  sanitizeAdminRpcErrorMessage,
  type AdminRpcPayload,
} from "@/lib/adminRpc";

type TabFilter = "pending" | "approved" | "rejected";

type ResolvedVerificationUrls = {
  profile: string;
  selfie: string | null;
  selfieError: string | null;
  /** Populated for <img onError> diagnostics */
  _diag?: {
    verificationId: string;
    userId: string;
    originalSelfieUrl: string;
  };
};

type PhotoVerificationRow = {
  id: string;
  user_id: string;
  profile_photo_url: string | null;
  selfie_url: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  client_confidence_score: number | null;
  client_match_result: boolean | null;
  rejection_reason: string | null;
  profile?: VerificationProfileRow | null;
};

type VerificationProfileRow = {
  id: string;
  name: string | null;
  age: number | null;
  avatar_url: string | null;
};

type PhotoVerificationCountsPayload = AdminRpcPayload & {
  pending?: number;
  approved_today?: number;
  rejected_today?: number;
};

type PhotoVerificationListPayload = AdminRpcPayload & {
  rows?: PhotoVerificationRow[];
};

const REJECTION_REASONS = [
  "Photos don't match",
  "Face not clearly visible",
  "Suspicious or edited photo",
  "Other",
];

/** Avoid logging signed URL query tokens (bearer access) to the console. */
function redactUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    const q = u.search ? "?<redacted>" : "";
    return `${u.origin}${u.pathname}${q}`;
  } catch {
    return "(invalid-url)";
  }
}

const AdminPhotoVerificationPanel = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabFilter>("pending");
  const [rejectModal, setRejectModal] = useState<{ id: string; userId: string } | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECTION_REASONS[0]);
  const [rejectCustomReason, setRejectCustomReason] = useState("");
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, ResolvedVerificationUrls>>({});
  const [approvalTarget, setApprovalTarget] = useState<PhotoVerificationRow | null>(null);
  const [rejectConfirmation, setRejectConfirmation] = useState<{ id: string; userId: string; reason: string } | null>(null);

  const { data: verifications = [], isLoading } = useQuery({
    queryKey: ["admin-photo-verifications", activeTab],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const payload = await callAdminRpc<PhotoVerificationListPayload>("admin_list_photo_verifications", {
        p_status: activeTab,
        p_reviewed_since: activeTab === "pending" ? null : thirtyDaysAgo,
        p_limit: 50,
      });
      return payload.rows ?? [];
    },
  });

  const profileMap = useMemo(
    () => Object.fromEntries(verifications.flatMap((v) => (v.profile?.id ? [[v.profile.id, v.profile]] : []))),
    [verifications]
  );

  // Selfie: server-side signed URL (service role) after admin JWT check — avoids client Storage/RLS edge cases.
  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const settledEntries = await Promise.allSettled(
        verifications.map(async (v) => {
          const profileUrl = resolvePhotoUrl(v.profile_photo_url);
          const rawSelfie = (v.selfie_url as string | null | undefined) ?? "";
          const diag = {
            verificationId: v.id,
            userId: v.user_id,
            originalSelfieUrl: rawSelfie,
          };

          const { data, error: invokeError } = await supabase.functions.invoke(
            "admin-proof-selfie-sign",
            { body: { verification_id: v.id } },
          );

          if (cancelled) return null;

          if (invokeError) {
            console.warn("[admin photo verification] selfie sign invoke failed", {
              verificationId: diag.verificationId,
              message: invokeError.message,
            });
            return [
              v.id,
              {
                profile: profileUrl,
                selfie: null,
                selfieError:
                  "Could not reach selfie signing service. Deploy the Edge Function `admin-proof-selfie-sign` or try again.",
                _diag: diag,
              } satisfies ResolvedVerificationUrls,
            ] as const;
          }

          const body = data as {
            success?: boolean;
            signedUrl?: string;
            directUrl?: string;
            error?: string;
            shape?: string;
          };

          if (body?.success && typeof body.signedUrl === "string") {
            return [
              v.id,
              {
                profile: profileUrl,
                selfie: body.signedUrl,
                selfieError: null,
                _diag: diag,
              } satisfies ResolvedVerificationUrls,
            ] as const;
          }

          if (body?.success && typeof body.directUrl === "string") {
            return [
              v.id,
              {
                profile: profileUrl,
                selfie: body.directUrl,
                selfieError: null,
                _diag: diag,
              } satisfies ResolvedVerificationUrls,
            ] as const;
          }

          console.warn("[admin photo verification] selfie sign rejected", {
            verificationId: diag.verificationId,
            error: body?.error,
            shape: body?.shape,
          });

          return [
            v.id,
            {
              profile: profileUrl,
              selfie: null,
              selfieError:
                body?.error ?? "Could not load verification selfie.",
              _diag: diag,
            } satisfies ResolvedVerificationUrls,
          ] as const;
        }),
      );

      if (cancelled) return;

      const entries = settledEntries.flatMap((result, index) => {
        if (result.status === "fulfilled") {
          return result.value ? [result.value] : [];
        }

        const v = verifications[index];
        console.warn("[admin photo verification] selfie resolution failed", {
          verificationId: v?.id,
          message: sanitizeAdminRpcErrorMessage(result.reason),
        });

        if (!v) return [];

        return [
          [
            v.id,
            {
              profile: resolvePhotoUrl(v.profile_photo_url),
              selfie: null,
              selfieError: "Could not load verification selfie.",
              _diag: {
                verificationId: v.id,
                userId: v.user_id,
                originalSelfieUrl: (v.selfie_url as string | null | undefined) ?? "",
              },
            } satisfies ResolvedVerificationUrls,
          ] as const,
        ];
      });

      const next: Record<string, ResolvedVerificationUrls> = {};
      for (const e of entries) {
        if (e) next[e[0]] = e[1];
      }
      setResolvedUrls(next);
    };

    if (verifications.length > 0) void resolveUrls();
    else setResolvedUrls({});

    return () => {
      cancelled = true;
    };
  }, [verifications]);

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["admin-verification-stats"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      const counts = await callAdminRpc<PhotoVerificationCountsPayload>("admin_get_photo_verification_counts", {
        p_today_start: todayStr,
      });

      return {
        pending: Number(counts.pending ?? 0),
        approvedToday: Number(counts.approved_today ?? 0),
        rejectedToday: Number(counts.rejected_today ?? 0),
      };
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (verification: PhotoVerificationRow) => {
      await callAdminRpc("admin_review_photo_verification", {
        p_verification_id: verification.id,
        p_action: "approve",
        p_rejection_reason: null,
        p_idempotency_key: createAdminIdempotencyKey("admin_review_photo_verification"),
      });
    },
    onSuccess: () => {
      toast.success("User verified successfully");
      setApprovalTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-photo-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-verification-stats"] });
    },
    onError: (err: unknown) => {
      toast.error("Failed to approve: " + (err instanceof Error ? err.message : "Unknown error"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await callAdminRpc("admin_review_photo_verification", {
        p_verification_id: id,
        p_action: "reject",
        p_rejection_reason: reason,
        p_idempotency_key: createAdminIdempotencyKey("admin_review_photo_verification"),
      });
    },
    onSuccess: () => {
      toast.success("Verification rejected");
      setRejectModal(null);
      setRejectConfirmation(null);
      queryClient.invalidateQueries({ queryKey: ["admin-photo-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-verification-stats"] });
    },
    onError: (err: unknown) => {
      toast.error("Failed to reject: " + (err instanceof Error ? err.message : "Unknown error"));
    },
  });

  const getConfidenceColor = (score: number | null) => {
    if (score === null || score === undefined) return "text-muted-foreground";
    if (score >= 70) return "text-green-500";
    if (score >= 40) return "text-amber-500";
    return "text-destructive";
  };

  const getConfidenceLabel = (score: number | null) => {
    if (score === null || score === undefined) return "N/A";
    if (score >= 70) return "High confidence";
    if (score >= 40) return "Medium confidence";
    return "Low confidence";
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const onSelfieImageError = useCallback((verificationId: string) => {
    setResolvedUrls((prev) => {
      const cur = prev[verificationId];
      if (!cur?.selfie) return prev;
      console.warn("[admin photo verification] selfie image load failed", {
        verificationId,
        userId: cur._diag?.userId,
        storedSelfieRef: cur._diag?.originalSelfieUrl,
        attemptedUrlRedacted: redactUrlForLog(cur.selfie),
      });
      return {
        ...prev,
        [verificationId]: {
          ...cur,
          selfie: null,
          selfieError:
            "Selfie failed to load (expired link, missing object, or blocked request). Check Network tab if needed.",
        },
      };
    });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{stats?.pending ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{stats?.approvedToday ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Approved Today</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{stats?.rejectedToday ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Rejected Today</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(["pending", "approved", "rejected"] as TabFilter[]).map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab(tab)}
            className="capitalize"
          >
            {tab}
            {tab === "pending" && stats?.pending ? (
              <Badge className="ml-2 bg-amber-500 text-white">{stats.pending}</Badge>
            ) : null}
          </Button>
        ))}
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : verifications.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No {activeTab} verifications</p>
        </div>
      ) : (
        <div className="space-y-4">
          {verifications.map((v) => {
            const profile = profileMap[v.user_id];
            const urls = resolvedUrls[v.id];
            const timestampLabel = activeTab === "pending" ? "Submitted" : "Reviewed";
            const timestampValue = activeTab === "pending" ? v.created_at : v.reviewed_at ?? v.created_at;
            return (
              <div key={v.id} className="glass-card p-4 space-y-3">
                {/* Side-by-side images */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground text-center">Profile Photo</p>
                    <div className="aspect-[4/5] rounded-xl overflow-hidden bg-secondary">
                      {urls?.profile ? (
                        <img src={urls.profile} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No photo</div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground text-center">Verification Selfie</p>
                    <div className="aspect-[4/5] rounded-xl overflow-hidden bg-secondary">
                      {urls?.selfie ? (
                        <img
                          src={urls.selfie}
                          alt="Selfie"
                          className="w-full h-full object-cover"
                          onError={() => onSelfieImageError(v.id)}
                        />
                      ) : urls?.selfieError ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <AlertTriangle className="w-8 h-8 text-destructive shrink-0" />
                          <p className="text-xs font-medium text-destructive">{urls.selfieError}</p>
                          <p className="text-[10px] text-muted-foreground">
                            If needed, check the browser console (URLs are redacted for security).
                          </p>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">
                      {profile?.name || "Unknown"}{profile?.age ? `, ${profile.age}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {timestampLabel} {timeAgo(timestampValue)}
                    </p>
                  </div>
                  <div className="text-right">
                    {v.client_confidence_score !== null && (
                      <p className={`text-sm font-medium ${getConfidenceColor(v.client_confidence_score)}`}>
                        {v.client_confidence_score}% — {getConfidenceLabel(v.client_confidence_score)}
                      </p>
                    )}
                    {v.client_match_result !== null && (
                      <Badge variant={v.client_match_result ? "default" : "destructive"} className="text-xs">
                        AI: {v.client_match_result ? "Match" : "No Match"}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Rejection reason for rejected tab */}
                {v.status === "rejected" && v.rejection_reason && (
                  <p className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                    Reason: {v.rejection_reason}
                  </p>
                )}

                {/* Actions (only for pending) */}
                {activeTab === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => setRejectModal({ id: v.id, userId: v.user_id })}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                    <Button
                      variant="default"
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setApprovalTarget(v)}
                      disabled={approveMutation.isPending}
                    >
                      {approveMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                      )}
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Modal */}
      <Dialog open={!!rejectModal} onOpenChange={(o) => !o && setRejectModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Verification</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Select value={rejectReason} onValueChange={setRejectReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REJECTION_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {rejectReason === "Other" && (
              <Textarea
                placeholder="Describe the reason..."
                value={rejectCustomReason}
                onChange={(e) => setRejectCustomReason(e.target.value)}
              />
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRejectModal(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  if (!rejectModal) return;
                  const reason = rejectReason === "Other" ? rejectCustomReason.trim() : rejectReason;
                  if (!reason) {
                    toast.error("Add a rejection reason before final confirmation.");
                    return;
                  }
                  setRejectModal(null);
                  setRejectConfirmation({ id: rejectModal.id, userId: rejectModal.userId, reason });
                }}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Confirm Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AdminConfirmDialog
        open={!!approvalTarget}
        title="Approve photo verification?"
        description={`This immediately marks the verification approved and updates the user's verification state for user ${approvalTarget?.user_id ?? ""}. This production change can affect trust badges and user visibility.`}
        confirmLabel="Approve Verification"
        variant="default"
        isPending={approveMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setApprovalTarget(null);
        }}
        onConfirm={() => approvalTarget ? approveMutation.mutateAsync(approvalTarget) : undefined}
      />
      <AdminConfirmDialog
        open={!!rejectConfirmation}
        title="Reject photo verification?"
        description={`This immediately rejects the verification and records the reason: "${rejectConfirmation?.reason ?? ""}". The user can lose or fail to receive verification status.`}
        confirmLabel="Reject Verification"
        isPending={rejectMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setRejectConfirmation(null);
        }}
        onConfirm={() =>
          rejectConfirmation
            ? rejectMutation.mutateAsync({ id: rejectConfirmation.id, reason: rejectConfirmation.reason })
            : undefined
        }
      />
    </motion.div>
  );
};

export default AdminPhotoVerificationPanel;
