import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Crown, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { addWeeks, addMonths, addYears } from "date-fns";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminTargetIdempotencyKey } from "@/lib/adminRpc";
import { invalidateAdminQueries } from "@/lib/adminQueryInvalidation";
import { formatAdminUtcDate, formatAdminUtcDateTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";

interface AdminPremiumModalProps {
  userId: string;
  userName: string;
  currentIsPremium: boolean;
  currentSubscriptionTier?: string | null;
  currentPremiumUntil: string | null;
  history?: PremiumHistoryEntry[];
  isOpen: boolean;
  onClose: () => void;
  onReopen?: () => void;
}

type Duration = "1week" | "1month" | "3months" | "1year" | "custom";
type PremiumAction = "grant" | "extend" | "revoke";
type PremiumTier = "premium" | "vip";

type PremiumHistoryEntry = {
  id: string;
  action: string;
  premium_until: string | null;
  reason: string | null;
  created_at: string;
  admin_id: string | null;
  adminName: string;
};

function premiumErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const durationOptions: { value: Duration; label: string }[] = [
  { value: "1week", label: "1 Week" },
  { value: "1month", label: "1 Month" },
  { value: "3months", label: "3 Months" },
  { value: "1year", label: "1 Year" },
  { value: "custom", label: "Custom" },
];

const calcDate = (from: Date, duration: Duration): Date => {
  switch (duration) {
    case "1week": return addWeeks(from, 1);
    case "1month": return addMonths(from, 1);
    case "3months": return addMonths(from, 3);
    case "1year": return addYears(from, 1);
    default: return from;
  }
};

const normalizePremiumTier = (tier?: string | null): PremiumTier => (
  tier?.trim().toLowerCase() === "vip" ? "vip" : "premium"
);

const formatTierLabel = (tier: PremiumTier): string => (
  tier === "vip" ? "VIP" : "Premium"
);

const getDefaultGrantTier = (currentIsPremium: boolean, currentSubscriptionTier?: string | null): PremiumTier => (
  currentIsPremium ? normalizePremiumTier(currentSubscriptionTier) : "premium"
);

const AdminPremiumModal = ({
  userId,
  userName,
  currentIsPremium,
  currentSubscriptionTier,
  currentPremiumUntil,
  history = [],
  isOpen,
  onClose,
  onReopen,
}: AdminPremiumModalProps) => {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState<Duration>("1month");
  const [customDate, setCustomDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PremiumAction | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [grantTier, setGrantTier] = useState<PremiumTier>(getDefaultGrantTier(currentIsPremium, currentSubscriptionTier));
  const currentTier = normalizePremiumTier(currentSubscriptionTier);
  const currentTierLabel = formatTierLabel(currentTier);
  const selectedTierLabel = formatTierLabel(grantTier);
  const customDateMissing = duration === "custom" && !customDate;
  const latestHistoryEntry = history.reduce<PremiumHistoryEntry | null>((latest, entry) => {
    if (!latest) return entry;
    return new Date(entry.created_at).getTime() > new Date(latest.created_at).getTime() ? entry : latest;
  }, null);

  useEffect(() => {
    if (!isOpen) return;
    setGrantTier(getDefaultGrantTier(currentIsPremium, currentSubscriptionTier));
    setPendingAction(null);
  }, [currentIsPremium, currentSubscriptionTier, isOpen]);

  const closeModal = () => {
    setPendingAction(null);
    onClose();
  };

  const reopenHistory = () => {
    setHistoryOpen(true);
    onReopen?.();
  };

  const getTargetDate = (baseDate: Date): Date => {
    if (duration === "custom") {
      return customDate ? new Date(customDate) : new Date();
    }
    return calcDate(baseDate, duration);
  };

  const getExtendTargetDate = (): Date => {
    const base = currentPremiumUntil ? new Date(currentPremiumUntil) : new Date();
    if (duration === "custom" && customDate) {
      const cd = new Date(customDate);
      return cd > base ? cd : base;
    }
    return calcDate(base, duration);
  };

  const getPendingTargetDate = (action: PremiumAction | null): Date | null => {
    if (action === "grant") return getTargetDate(new Date());
    if (action === "extend") return getExtendTargetDate();
    return null;
  };

  const invalidatePremiumQueries = async () => {
    await invalidateAdminQueries(queryClient, ["users"]);
  };

  const handleGrant = async () => {
    setIsSubmitting(true);
    try {
      const targetDate = getTargetDate(new Date());

      await callAdminRpc("admin_set_premium_status", {
        p_user_id: userId,
        p_action: "grant",
        p_premium_until: targetDate.toISOString(),
        p_subscription_tier: grantTier,
        p_reason: reason || null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_set_premium_status", userId, {
          action: "grant",
          current_is_premium: currentIsPremium,
          current_subscription_tier: currentSubscriptionTier ?? null,
          current_premium_until: currentPremiumUntil,
          latest_history_id: latestHistoryEntry?.id ?? null,
          premium_until: targetDate.toISOString(),
          subscription_tier: grantTier,
          reason: reason || null,
        }),
      });

      adminToast.success({
        id: `admin-premium-grant-${userId}`,
        title: `${selectedTierLabel} granted to ${userName} until ${formatAdminUtcDate(targetDate)}`,
        action: { label: "View history", onClick: reopenHistory },
      });
      await invalidatePremiumQueries();
      closeModal();
    } catch (e: unknown) {
      adminToast.error({ id: `admin-premium-grant-error-${userId}`, title: premiumErrorMessage(e, "Failed to grant premium") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtend = async () => {
    setIsSubmitting(true);
    try {
      const targetDate = getExtendTargetDate();

      await callAdminRpc("admin_set_premium_status", {
        p_user_id: userId,
        p_action: "extend",
        p_premium_until: targetDate.toISOString(),
        p_subscription_tier: grantTier,
        p_reason: reason || null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_set_premium_status", userId, {
          action: "extend",
          current_is_premium: currentIsPremium,
          current_subscription_tier: currentSubscriptionTier ?? null,
          current_premium_until: currentPremiumUntil,
          latest_history_id: latestHistoryEntry?.id ?? null,
          premium_until: targetDate.toISOString(),
          subscription_tier: grantTier,
          reason: reason || null,
        }),
      });

      adminToast.success({
        id: `admin-premium-extend-${userId}`,
        title: `${selectedTierLabel} extended for ${userName} until ${formatAdminUtcDate(targetDate)}`,
        action: { label: "View history", onClick: reopenHistory },
      });
      await invalidatePremiumQueries();
      closeModal();
    } catch (e: unknown) {
      adminToast.error({ id: `admin-premium-extend-error-${userId}`, title: premiumErrorMessage(e, "Failed to extend premium") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    setIsSubmitting(true);
    try {
      await callAdminRpc("admin_set_premium_status", {
        p_user_id: userId,
        p_action: "revoke",
        p_premium_until: null,
        p_subscription_tier: "free",
        p_reason: reason || null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_set_premium_status", userId, {
          action: "revoke",
          current_is_premium: currentIsPremium,
          current_subscription_tier: currentSubscriptionTier ?? null,
          current_premium_until: currentPremiumUntil,
          latest_history_id: latestHistoryEntry?.id ?? null,
          reason: reason || null,
        }),
      });

      adminToast.success({
        id: `admin-premium-revoke-${userId}`,
        title: `Premium revoked for ${userName}`,
        description: "Premium changes are not undone from toast; use the modal to grant or extend again deliberately.",
        action: { label: "View history", onClick: reopenHistory },
      });
      await invalidatePremiumQueries();
      closeModal();
    } catch (e: unknown) {
      adminToast.error({ id: `admin-premium-revoke-error-${userId}`, title: premiumErrorMessage(e, "Failed to revoke premium") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const premiumActionCopy = (() => {
    const targetDate = getPendingTargetDate(pendingAction);
    const accessLine = targetDate ? `\nAccess through: ${formatAdminUtcDate(targetDate)}` : "";
    const reasonLine = reason.trim() ? `\nReason: ${reason.trim()}` : "";
    if (pendingAction === "grant") {
      return {
        title: `Grant ${selectedTierLabel} to ${userName}?`,
        description: `This calls the backend admin premium RPC. Profile premium state, premium_history, and admin_activity_logs commit together or fail together.\nTier: ${selectedTierLabel}${accessLine}${reasonLine}`,
        confirmLabel: `Grant ${selectedTierLabel}`,
        variant: "default" as const,
      };
    }
    if (pendingAction === "extend") {
      return {
        title: `Extend ${selectedTierLabel} for ${userName}?`,
        description: `This calls the backend admin premium RPC. The premium_until update, premium_history row, and admin audit row commit together or fail together.\nTier: ${selectedTierLabel}${accessLine}${reasonLine}`,
        confirmLabel: `Extend ${selectedTierLabel}`,
        variant: "default" as const,
      };
    }
    if (pendingAction === "revoke") {
      return {
        title: `Revoke premium for ${userName}?`,
        description: `This calls the backend admin premium RPC. Premium removal, premium_history, and admin_activity_logs commit together or fail together.\nCurrent tier: ${currentTierLabel}${reasonLine}`,
        confirmLabel: "Revoke Premium",
        variant: "destructive" as const,
      };
    }
    return { title: "", description: "", confirmLabel: "Confirm", variant: "destructive" as const };
  })();

  const confirmPremiumAction = async () => {
    if (pendingAction === "grant") return handleGrant();
    if (pendingAction === "extend") return handleExtend();
    if (pendingAction === "revoke") return handleRevoke();
  };

  const actionBadgeColor: Record<string, string> = {
    grant: "bg-green-500/20 text-green-400 border-green-500/30",
    granted: "bg-green-500/20 text-green-400 border-green-500/30",
    extend: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    extended: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    revoke: "bg-destructive/20 text-destructive border-destructive/30",
    revoked: "bg-destructive/20 text-destructive border-destructive/30",
    expire: "bg-muted text-muted-foreground border-border",
    expired: "bg-muted text-muted-foreground border-border",
  };

  if (!isOpen) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
        onClick={closeModal}
      />
      <div className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="flex max-h-[85vh] w-full flex-col overflow-hidden bg-background border border-border rounded-2xl shadow-2xl"
        >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Crown className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-display font-bold text-foreground">Premium Status</h3>
              <p className="text-xs text-muted-foreground">{userName}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={closeModal}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Current Status */}
        {currentIsPremium ? (
          <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 mb-1">
              ✦ Active {currentTierLabel}
            </Badge>
            <p className="text-xs text-muted-foreground">
              Expires: {currentPremiumUntil ? formatAdminUtcDateTime(currentPremiumUntil) : "Never"}
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-secondary/50 border border-border">
            <Badge variant="outline" className="text-muted-foreground">Free Account</Badge>
          </div>
        )}

        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-300">
          Premium changes use the backend admin_set_premium_status RPC so profile state, premium_history, and admin audit logging are transactional.
        </div>

        {/* Tier */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Subscription tier</h4>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGrantTier("premium")}
                className={`flex-1 px-3 py-2 rounded-full text-xs font-medium border transition-colors ${
                  grantTier === "premium"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-foreground border-border hover:border-primary/50"
                }`}
              >
                Premium
              </button>
              <button
                type="button"
                onClick={() => setGrantTier("vip")}
                className={`flex-1 px-3 py-2 rounded-full text-xs font-medium border transition-colors ${
                  grantTier === "vip"
                    ? "bg-amber-500/90 text-amber-950 border-amber-500"
                    : "bg-secondary/50 text-foreground border-border hover:border-amber-500/50"
                }`}
              >
                VIP
              </button>
            </div>
          </div>

        {/* Duration Picker */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            {currentIsPremium ? "Extend Duration" : `Grant ${selectedTierLabel}`}
          </h4>
          <div className="flex flex-wrap gap-2">
            {durationOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDuration(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  duration === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-foreground border-border hover:border-primary/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {duration === "custom" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <Input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="bg-secondary/50"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Reason */}
        <Textarea
          placeholder="Why? e.g., Beta tester, compensation, contest winner"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="bg-secondary/50 min-h-[60px]"
        />

        {/* History */}
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronDown className={`w-4 h-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            Premium History
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {history.length === 0 && (
              <p className="text-xs text-muted-foreground">No history yet</p>
            )}
            {history.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-secondary/30">
                <Badge variant="outline" className={`text-[10px] shrink-0 ${actionBadgeColor[entry.action] || ""}`}>
                  {entry.action}
                </Badge>
                <div className="min-w-0">
                  <p className="text-muted-foreground">
                    by {entry.adminName} · {formatAdminUtcDate(entry.created_at)}
                  </p>
                  {entry.reason && (
                    <p className="text-foreground truncate">{entry.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
        </div>

        <div className="border-t border-border bg-background/95 p-4">
          {currentIsPremium ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="outline"
                onClick={closeModal}
                disabled={isSubmitting}
                className="sm:mr-auto"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => setPendingAction("revoke")}
                disabled={isSubmitting}
              >
                Revoke
              </Button>
              <Button
                variant="gradient"
                onClick={() => setPendingAction("extend")}
                disabled={isSubmitting || customDateMissing}
              >
                {isSubmitting ? "Saving..." : `Extend ${selectedTierLabel}`}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="outline" onClick={closeModal} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                variant="gradient"
                onClick={() => setPendingAction("grant")}
                disabled={isSubmitting || customDateMissing}
              >
                {isSubmitting ? "Saving..." : `Grant ${selectedTierLabel}`}
              </Button>
            </div>
          )}
        </div>
        </motion.div>
      </div>

      <AdminConfirmDialog
        open={!!pendingAction}
        title={premiumActionCopy.title}
        description={premiumActionCopy.description}
        confirmLabel={premiumActionCopy.confirmLabel}
        variant={premiumActionCopy.variant}
        isPending={isSubmitting}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        onConfirm={confirmPremiumAction}
      />
    </>
  );
};

export default AdminPremiumModal;
