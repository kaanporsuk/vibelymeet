import { useState, useEffect, useMemo, useCallback, useRef, type MutableRefObject } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
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
import AdminEmptyState from "./AdminEmptyState";
import {
  callAdminRpc,
  createAdminTargetIdempotencyKey,
  type AdminRpcPayload,
} from "@/lib/adminRpc";
import { invalidateAdminQueries } from "@/lib/adminQueryInvalidation";
import { adminUtcDayStartIso, formatAdminRelativeTime, formatAdminUtcDateTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";
import { resolveAdminErrorMessage, resolveAdminFunctionErrorMessage } from "@/lib/adminErrorResolver";

type TabFilter = "pending" | "approved" | "rejected";

type ResolvedVerificationUrls = {
  profile: string;
  selfie: string | null;
  selfieError: string | null;
  selfieExpiresAt: string | null;
  selfieLoadedAt: string | null;
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
const SELFIE_URL_REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const SELFIE_URL_MIN_REFRESH_DELAY_MS = 30 * 1000;
const SELFIE_SIGN_CONCURRENCY = 4;

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

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const value = values[currentIndex] as T;
        try {
          results[currentIndex] = {
            status: "fulfilled",
            value: await mapper(value, currentIndex),
          };
        } catch (reason) {
          results[currentIndex] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
}

function shouldRefreshSelfieEntry(
  row: PhotoVerificationRow,
  existing: ResolvedVerificationUrls | undefined,
  force: boolean,
): boolean {
  if (force) return true;
  if (!row.selfie_url) return false;
  if (!existing) return true;
  if (!existing.selfie || existing.selfieError) return true;
  if (!existing.selfieExpiresAt) return true;
  const expiresAtMs = Date.parse(existing.selfieExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - Date.now() <= SELFIE_URL_REFRESH_BEFORE_EXPIRY_MS;
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
  const resolvedUrlsRef = useRef<Record<string, ResolvedVerificationUrls>>({});
  const selfieRefreshSequence = useRef(0);
  const lastSelfieRefreshAt = useRef(0);
  const approveTriggerRef = useRef<HTMLElement | null>(null);
  const rejectTriggerRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    resolvedUrlsRef.current = resolvedUrls;
  }, [resolvedUrls]);

  // Selfie: server-side signed URL (service role) after admin JWT check — avoids client Storage/RLS edge cases.
  const refreshSelfieUrls = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const refreshId = ++selfieRefreshSequence.current;
    lastSelfieRefreshAt.current = Date.now();
    if (verifications.length === 0) {
      setResolvedUrls({});
      return;
    }

    const existingById = resolvedUrlsRef.current;
    const candidateRows = verifications.filter((v) => shouldRefreshSelfieEntry(v, existingById[v.id], force));
    if (candidateRows.length === 0) {
      setResolvedUrls((prev) => {
        const next: Record<string, ResolvedVerificationUrls> = {};
        for (const v of verifications) {
          const existing = prev[v.id];
          next[v.id] = existing
            ? { ...existing, profile: resolvePhotoUrl(v.profile_photo_url) }
            : {
                profile: resolvePhotoUrl(v.profile_photo_url),
                selfie: null,
                selfieError: v.selfie_url ? "Selfie is queued for signing." : "No verification selfie was submitted.",
                selfieExpiresAt: null,
                selfieLoadedAt: null,
                _diag: {
                  verificationId: v.id,
                  userId: v.user_id,
                  originalSelfieUrl: (v.selfie_url as string | null | undefined) ?? "",
                },
              };
        }
        return next;
      });
      return;
    }

    const settledEntries = await mapWithConcurrency(
      candidateRows,
      SELFIE_SIGN_CONCURRENCY,
      async (v) => {
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

        if (invokeError) {
          const message = await resolveAdminFunctionErrorMessage(
            invokeError,
            data,
            "Could not reach selfie signing service. Deploy the Edge Function `admin-proof-selfie-sign` or try again.",
          );
          console.warn("[admin photo verification] selfie sign invoke failed", {
            verificationId: diag.verificationId,
            message,
          });
          return [
            v.id,
            {
              profile: profileUrl,
              selfie: null,
              selfieError: message,
              selfieExpiresAt: null,
              selfieLoadedAt: null,
              _diag: diag,
            } satisfies ResolvedVerificationUrls,
          ] as const;
        }

        const body = data as {
          success?: boolean;
          signedUrl?: string;
          directUrl?: string;
          expires_at?: string | null;
          error?: string;
          shape?: string;
        };

        if (body?.success && typeof body.signedUrl === "string") {
          const expiresAt = typeof body.expires_at === "string" ? body.expires_at : null;
          if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
            return [
              v.id,
              {
                profile: profileUrl,
                selfie: null,
                selfieError: "Signed selfie expiry metadata was missing. Refresh before review can continue.",
                selfieExpiresAt: null,
                selfieLoadedAt: null,
                _diag: diag,
              } satisfies ResolvedVerificationUrls,
            ] as const;
          }

          return [
            v.id,
            {
              profile: profileUrl,
              selfie: body.signedUrl,
              selfieError: null,
              selfieExpiresAt: expiresAt,
              selfieLoadedAt: null,
              _diag: diag,
            } satisfies ResolvedVerificationUrls,
          ] as const;
        }

        if (body?.success && typeof body.directUrl === "string") {
          const expiresAt = typeof body.expires_at === "string" ? body.expires_at : null;
          if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
            return [
              v.id,
              {
                profile: profileUrl,
                selfie: null,
                selfieError: "Direct selfie revalidation metadata was missing. Refresh before review can continue.",
                selfieExpiresAt: null,
                selfieLoadedAt: null,
                _diag: diag,
              } satisfies ResolvedVerificationUrls,
            ] as const;
          }

          return [
            v.id,
            {
              profile: profileUrl,
              selfie: body.directUrl,
              selfieError: null,
              selfieExpiresAt: expiresAt,
              selfieLoadedAt: null,
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
            selfieExpiresAt: null,
            selfieLoadedAt: null,
            _diag: diag,
          } satisfies ResolvedVerificationUrls,
        ] as const;
      },
    );

    const entries = settledEntries.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return result.value ? [result.value] : [];
      }

      const v = candidateRows[index];
      console.warn("[admin photo verification] selfie resolution failed", {
        verificationId: v?.id,
        message: resolveAdminErrorMessage(result.reason, "Could not load verification selfie."),
      });

      if (!v) return [];

      return [
        [
          v.id,
          {
            profile: resolvePhotoUrl(v.profile_photo_url),
            selfie: null,
            selfieError: "Could not load verification selfie.",
            selfieExpiresAt: null,
            selfieLoadedAt: null,
            _diag: {
              verificationId: v.id,
              userId: v.user_id,
              originalSelfieUrl: (v.selfie_url as string | null | undefined) ?? "",
            },
          } satisfies ResolvedVerificationUrls,
        ] as const,
      ];
    });

    if (refreshId !== selfieRefreshSequence.current) return;
    setResolvedUrls((prev) => {
      const next: Record<string, ResolvedVerificationUrls> = {};
      for (const v of verifications) {
        const previous = prev[v.id];
        next[v.id] = previous
          ? { ...previous, profile: resolvePhotoUrl(v.profile_photo_url) }
          : {
              profile: resolvePhotoUrl(v.profile_photo_url),
              selfie: null,
              selfieError: v.selfie_url ? "Selfie is queued for signing." : "No verification selfie was submitted.",
              selfieExpiresAt: null,
              selfieLoadedAt: null,
              _diag: {
                verificationId: v.id,
                userId: v.user_id,
                originalSelfieUrl: (v.selfie_url as string | null | undefined) ?? "",
              },
            };
      }
      for (const e of entries) {
        if (!e) continue;
        const [id, nextUrls] = e;
        const previous = prev[id];
        next[id] = previous?.selfie === nextUrls.selfie && previous.selfieLoadedAt
          ? { ...nextUrls, selfieLoadedAt: previous.selfieLoadedAt }
          : nextUrls;
      }
      return next;
    });
  }, [verifications]);

  useEffect(() => {
    void refreshSelfieUrls({ force: true });
  }, [refreshSelfieUrls]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (!document.hidden) void refreshSelfieUrls();
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshSelfieUrls]);

  useEffect(() => {
    const expiringAt = Object.values(resolvedUrls)
      .map((entry) => (entry.selfieExpiresAt ? Date.parse(entry.selfieExpiresAt) : NaN))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0];

    if (!expiringAt) return;

    const msUntilRefreshWindow = expiringAt - Date.now() - SELFIE_URL_REFRESH_BEFORE_EXPIRY_MS;
    const msSinceLastRefresh = Date.now() - lastSelfieRefreshAt.current;
    const throttleDelayMs = Math.max(0, SELFIE_URL_MIN_REFRESH_DELAY_MS - msSinceLastRefresh);
    const delayMs =
      msUntilRefreshWindow <= 0
        ? throttleDelayMs
        : Math.max(SELFIE_URL_MIN_REFRESH_DELAY_MS, msUntilRefreshWindow);
    const timeout = window.setTimeout(() => void refreshSelfieUrls(), delayMs);
    return () => window.clearTimeout(timeout);
  }, [refreshSelfieUrls, resolvedUrls]);

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["admin-verification-stats"],
    queryFn: async () => {
      const todayStr = adminUtcDayStartIso();

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

  const getSelfieAccess = useCallback((verificationId: string) => {
    const urls = resolvedUrls[verificationId];
    const expiresAtMs = urls?.selfieExpiresAt ? Date.parse(urls.selfieExpiresAt) : null;
    const expired = typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
    const loaded = Boolean(urls?.selfieLoadedAt);
    const ready = Boolean(urls?.selfie) && loaded && !urls?.selfieError && !expired;
    const message = !urls
      ? "Selfie is still loading."
      : urls.selfieError
        ? urls.selfieError
        : expired
          ? "Selfie link expired. Refreshing the signed URL before review can continue."
          : !urls.selfie
            ? "Verification selfie is unavailable."
            : !loaded
              ? "Selfie image is still loading. Wait for it to render before review can continue."
            : null;

    return { ready, expired, message };
  }, [resolvedUrls]);

  const restoreFocus = useCallback((ref: MutableRefObject<HTMLElement | null>) => {
    const trigger = ref.current;
    ref.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  const openApprovalConfirmation = useCallback((verification: PhotoVerificationRow, trigger: HTMLElement | null) => {
    approveTriggerRef.current = trigger;
    setApprovalTarget(verification);
  }, []);

  const closeApprovalConfirmation = useCallback(() => {
    setApprovalTarget(null);
    restoreFocus(approveTriggerRef);
  }, [restoreFocus]);

  const openRejectModal = useCallback((verification: PhotoVerificationRow, trigger: HTMLElement | null) => {
    rejectTriggerRef.current = trigger;
    setRejectModal({ id: verification.id, userId: verification.user_id });
  }, []);

  const closeRejectModal = useCallback(() => {
    setRejectModal(null);
    restoreFocus(rejectTriggerRef);
  }, [restoreFocus]);

  const closeRejectConfirmation = useCallback(() => {
    setRejectConfirmation(null);
    restoreFocus(rejectTriggerRef);
  }, [restoreFocus]);

  const approveMutation = useMutation({
    mutationFn: async (verification: PhotoVerificationRow) => {
      const selfieAccess = getSelfieAccess(verification.id);
      if (!selfieAccess?.ready) {
        throw new Error(selfieAccess?.message ?? "Verification selfie is unavailable.");
      }

      await callAdminRpc("admin_review_photo_verification", {
        p_verification_id: verification.id,
        p_action: "approve",
        p_rejection_reason: null,
        p_idempotency_key: createAdminTargetIdempotencyKey(
          "admin_review_photo_verification",
          verification.id,
          {
            action: "approve",
            current_status: verification.status,
            reviewed_at: verification.reviewed_at,
            created_at: verification.created_at,
          },
        ),
      });
    },
    onSuccess: (_data, verification) => {
      adminToast.success({
        id: `admin-photo-verification-approve-${verification.id}`,
        title: "User verified successfully",
        description: "This approval is permanent unless another admin action changes the user state.",
        action: { label: "View approved", onClick: () => setActiveTab("approved") },
      });
      setApprovalTarget(null);
      restoreFocus(approveTriggerRef);
      void invalidateAdminQueries(queryClient, ["photoVerification", "users"]);
    },
    onError: (err: unknown) => {
      adminToast.error({
        id: "admin-photo-verification-approve-error",
        title: "Failed to approve",
        description: resolveAdminErrorMessage(err, "Approval failed"),
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await callAdminRpc("admin_review_photo_verification", {
        p_verification_id: id,
        p_action: "reject",
        p_rejection_reason: reason,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_review_photo_verification", id, {
          action: "reject",
          current_status: verifications.find((row) => row.id === id)?.status ?? null,
          reviewed_at: verifications.find((row) => row.id === id)?.reviewed_at ?? null,
          reason,
        }),
      });
    },
    onSuccess: (_data, variables) => {
      adminToast.success({
        id: `admin-photo-verification-reject-${variables.id}`,
        title: "Verification rejected",
        description: "This rejection is permanent unless another admin action changes the user state.",
        action: { label: "View rejected", onClick: () => setActiveTab("rejected") },
      });
      setRejectModal(null);
      setRejectConfirmation(null);
      restoreFocus(rejectTriggerRef);
      void invalidateAdminQueries(queryClient, ["photoVerification", "users"]);
    },
    onError: (err: unknown) => {
      adminToast.error({
        id: "admin-photo-verification-reject-error",
        title: "Failed to reject",
        description: resolveAdminErrorMessage(err, "Rejection failed"),
      });
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

  const onSelfieImageError = useCallback((verificationId: string, attemptedUrl: string) => {
    setResolvedUrls((prev) => {
      const cur = prev[verificationId];
      if (!cur?.selfie || cur.selfie !== attemptedUrl) return prev;
      console.warn("[admin photo verification] selfie image load failed", {
        verificationId,
        userId: cur._diag?.userId,
        storedSelfieRef: cur._diag?.originalSelfieUrl
          ? redactUrlForLog(cur._diag.originalSelfieUrl)
          : null,
        attemptedUrlRedacted: redactUrlForLog(attemptedUrl),
      });
      return {
        ...prev,
        [verificationId]: {
          ...cur,
          selfie: null,
          selfieError:
            "Selfie failed to load (expired link, missing object, or blocked request). Check Network tab if needed.",
          selfieExpiresAt: null,
          selfieLoadedAt: null,
        },
      };
    });
  }, []);

  const onSelfieImageLoad = useCallback((verificationId: string, loadedUrl: string) => {
    setResolvedUrls((prev) => {
      const cur = prev[verificationId];
      if (!cur?.selfie || cur.selfie !== loadedUrl || cur.selfieLoadedAt) return prev;
      return {
        ...prev,
        [verificationId]: {
          ...cur,
          selfieLoadedAt: new Date().toISOString(),
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
        <AdminEmptyState
          icon={ShieldCheck}
          title={`No ${activeTab} verifications`}
          description={activeTab === "pending" ? "New verification submissions will appear here." : "Recently reviewed verification rows appear here for the last 30 days."}
        />
      ) : (
        <div className="space-y-4">
          {verifications.map((v) => {
            const profile = profileMap[v.user_id];
            const urls = resolvedUrls[v.id];
            const selfieUrl = urls?.selfie ?? null;
            const selfieAccess = getSelfieAccess(v.id);
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
                      {selfieUrl && !selfieAccess?.expired ? (
                        <img
                          src={selfieUrl}
                          alt="Selfie"
                          className="w-full h-full object-cover"
                          onLoad={() => onSelfieImageLoad(v.id, selfieUrl)}
                          onError={() => onSelfieImageError(v.id, selfieUrl)}
                        />
                      ) : urls?.selfieError || selfieAccess?.message ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <AlertTriangle className="w-8 h-8 text-destructive shrink-0" />
                          <p className="text-xs font-medium text-destructive">
                            {urls?.selfieError ?? selfieAccess?.message}
                          </p>
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
                      {timestampLabel}{" "}
                      <span title={formatAdminUtcDateTime(timestampValue)}>
                        {formatAdminRelativeTime(timestampValue)}
                      </span>
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
                      onClick={(event) => openRejectModal(v, event.currentTarget)}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                    <Button
                      variant="default"
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={(event) => openApprovalConfirmation(v, event.currentTarget)}
                      disabled={approveMutation.isPending || !selfieAccess?.ready}
                      title={!selfieAccess?.ready ? selfieAccess?.message ?? "Selfie is unavailable" : undefined}
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
      <Dialog open={!!rejectModal} onOpenChange={(o) => !o && closeRejectModal()}>
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
              <Button variant="outline" className="flex-1" onClick={closeRejectModal}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  if (!rejectModal) return;
                  const reason = rejectReason === "Other" ? rejectCustomReason.trim() : rejectReason;
                  if (!reason) {
                    adminToast.error({
                      id: "admin-photo-verification-reason-required",
                      title: "Add a rejection reason before final confirmation",
                    });
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
          if (!open) closeApprovalConfirmation();
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
          if (!open) closeRejectConfirmation();
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
