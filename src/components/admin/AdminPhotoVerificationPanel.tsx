import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import {
  PROOF_SELFIES_BUCKET,
  isAbsoluteMediaUrl,
  normalizeProofSelfieObjectPath,
} from "@/lib/proofSelfieUrl";
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

type TabFilter = "pending" | "approved" | "rejected";

type ResolvedVerificationUrls = {
  profile: string;
  selfie: string | null;
  selfieError: string | null;
};

const REJECTION_REASONS = [
  "Photos don't match",
  "Face not clearly visible",
  "Suspicious or edited photo",
  "Other",
];

const AdminPhotoVerificationPanel = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabFilter>("pending");
  const [rejectModal, setRejectModal] = useState<{ id: string; userId: string } | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECTION_REASONS[0]);
  const [rejectCustomReason, setRejectCustomReason] = useState("");
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, ResolvedVerificationUrls>>({});

  const { data: verifications = [], isLoading } = useQuery({
    queryKey: ["admin-photo-verifications", activeTab],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      let query = supabase
        .from("photo_verifications")
        .select("*")
        .eq("status", activeTab)
        .order("created_at", { ascending: activeTab === "pending" });

      if (activeTab !== "pending") {
        query = query.gte("reviewed_at", thirtyDaysAgo);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch profile names for display
  const userIds = verifications.map((v: any) => v.user_id);
  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-verification-profiles", userIds.join(",")],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, name, age, avatar_url")
        .in("id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p]));

  // Resolve photo URLs (selfie = private bucket signed URL only; profile = public/Bunny via resolvePhotoUrl)
  useEffect(() => {
    let cancelled = false;

    const resolveUrls = async () => {
      const newResolved: Record<string, ResolvedVerificationUrls> = {};
      for (const v of verifications) {
        const profileUrl = resolvePhotoUrl(v.profile_photo_url);
        const rawSelfie = (v.selfie_url as string | null | undefined) ?? "";

        if (isAbsoluteMediaUrl(rawSelfie)) {
          newResolved[v.id] = { profile: profileUrl, selfie: rawSelfie.trim(), selfieError: null };
          continue;
        }

        const objectPath = normalizeProofSelfieObjectPath(rawSelfie);
        if (!objectPath) {
          console.error("[admin photo verification] Missing or invalid selfie storage path", {
            verificationId: v.id,
            userId: v.user_id,
            selfie_url: rawSelfie,
          });
          newResolved[v.id] = {
            profile: profileUrl,
            selfie: null,
            selfieError: "Invalid selfie path in database — cannot load from storage.",
          };
          continue;
        }

        const { data, error } = await supabase.storage
          .from(PROOF_SELFIES_BUCKET)
          .createSignedUrl(objectPath, 3600);

        if (cancelled) return;

        if (error || !data?.signedUrl) {
          console.error("[admin photo verification] createSignedUrl failed for proof-selfies", {
            verificationId: v.id,
            userId: v.user_id,
            objectPath,
            message: error?.message ?? "No signed URL returned",
          });
          newResolved[v.id] = {
            profile: profileUrl,
            selfie: null,
            selfieError: "Could not create a signed URL for this selfie. Check policies and path.",
          };
        } else {
          newResolved[v.id] = { profile: profileUrl, selfie: data.signedUrl, selfieError: null };
        }
      }
      if (!cancelled) setResolvedUrls(newResolved);
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

      const [pending, approvedToday, rejectedToday] = await Promise.all([
        supabase.from("photo_verifications").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("photo_verifications").select("*", { count: "exact", head: true }).eq("status", "approved").gte("reviewed_at", todayStr),
        supabase.from("photo_verifications").select("*", { count: "exact", head: true }).eq("status", "rejected").gte("reviewed_at", todayStr),
      ]);

      return {
        pending: pending.count || 0,
        approvedToday: approvedToday.count || 0,
        rejectedToday: rejectedToday.count || 0,
      };
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (verification: any) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: fnError } = await supabase.functions.invoke("admin-review-verification", {
        body: {
          verification_id: verification.id,
          action: "approve",
          admin_id: user.id,
        },
      });
      if (fnError) throw fnError;
    },
    onSuccess: () => {
      toast.success("User verified successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-photo-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-verification-stats"] });
    },
    onError: (err: any) => {
      toast.error("Failed to approve: " + (err.message || "Unknown error"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: fnError } = await supabase.functions.invoke("admin-review-verification", {
        body: {
          verification_id: id,
          action: "reject",
          admin_id: user.id,
          rejection_reason: reason,
        },
      });
      if (fnError) throw fnError;
    },
    onSuccess: () => {
      toast.success("Verification rejected");
      setRejectModal(null);
      queryClient.invalidateQueries({ queryKey: ["admin-photo-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["admin-verification-stats"] });
    },
    onError: (err: any) => {
      toast.error("Failed to reject: " + (err.message || "Unknown error"));
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
          {verifications.map((v: any) => {
            const profile = profileMap[v.user_id];
            const urls = resolvedUrls[v.id];
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
                        <img src={urls.selfie} alt="Selfie" className="w-full h-full object-cover" />
                      ) : urls?.selfieError ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <AlertTriangle className="w-8 h-8 text-destructive shrink-0" />
                          <p className="text-xs font-medium text-destructive">{urls.selfieError}</p>
                          <p className="text-[10px] text-muted-foreground">Details were logged to the browser console.</p>
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
                      Submitted {timeAgo(v.created_at)}
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
                      onClick={() => approveMutation.mutate(v)}
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
                  const reason = rejectReason === "Other" ? rejectCustomReason || "Other" : rejectReason;
                  rejectMutation.mutate({ id: rejectModal.id, reason });
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
    </motion.div>
  );
};

export default AdminPhotoVerificationPanel;
