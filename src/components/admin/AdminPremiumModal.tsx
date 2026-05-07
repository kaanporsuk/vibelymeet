import { useState } from "react";
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
import { format, addWeeks, addMonths, addYears } from "date-fns";
import { toast } from "sonner";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminIdempotencyKey } from "@/lib/adminRpc";

interface AdminPremiumModalProps {
  userId: string;
  userName: string;
  currentIsPremium: boolean;
  currentPremiumUntil: string | null;
  history?: PremiumHistoryEntry[];
  isOpen: boolean;
  onClose: () => void;
}

type Duration = "1week" | "1month" | "3months" | "1year" | "custom";
type PremiumAction = "grant" | "extend" | "revoke";

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

const AdminPremiumModal = ({
  userId,
  userName,
  currentIsPremium,
  currentPremiumUntil,
  history = [],
  isOpen,
  onClose,
}: AdminPremiumModalProps) => {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState<Duration>("1month");
  const [customDate, setCustomDate] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PremiumAction | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [grantTier, setGrantTier] = useState<"premium" | "vip">("premium");

  const closeModal = () => {
    setPendingAction(null);
    onClose();
  };

  const getTargetDate = (baseDate: Date): Date => {
    if (duration === "custom") {
      return customDate ? new Date(customDate) : new Date();
    }
    return calcDate(baseDate, duration);
  };

  const invalidatePremiumQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-user-detail", userId] }),
    ]);
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
        p_idempotency_key: createAdminIdempotencyKey("admin_set_premium_status"),
      });

      toast.success(`Premium granted to ${userName} until ${format(targetDate, "MMM d, yyyy")}`);
      await invalidatePremiumQueries();
      closeModal();
    } catch (e: unknown) {
      toast.error(premiumErrorMessage(e, "Failed to grant premium"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtend = async () => {
    setIsSubmitting(true);
    try {
      const base = currentPremiumUntil ? new Date(currentPremiumUntil) : new Date();
      let targetDate: Date;
      if (duration === "custom" && customDate) {
        const cd = new Date(customDate);
        targetDate = cd > base ? cd : base;
      } else {
        targetDate = calcDate(base, duration);
      }

      await callAdminRpc("admin_set_premium_status", {
        p_user_id: userId,
        p_action: "extend",
        p_premium_until: targetDate.toISOString(),
        p_subscription_tier: grantTier,
        p_reason: reason || null,
        p_idempotency_key: createAdminIdempotencyKey("admin_set_premium_status"),
      });

      toast.success(`Premium extended for ${userName} until ${format(targetDate, "MMM d, yyyy")}`);
      await invalidatePremiumQueries();
      closeModal();
    } catch (e: unknown) {
      toast.error(premiumErrorMessage(e, "Failed to extend premium"));
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
        p_idempotency_key: createAdminIdempotencyKey("admin_set_premium_status"),
      });

      toast.success(`Premium revoked for ${userName}`);
      await invalidatePremiumQueries();
      closeModal();
    } catch (e: unknown) {
      toast.error(premiumErrorMessage(e, "Failed to revoke premium"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const premiumActionCopy = (() => {
    if (pendingAction === "grant") {
      return {
        title: `Grant premium to ${userName}?`,
        description: "This calls the backend admin premium RPC. Profile premium state, premium_history, and admin_activity_logs commit together or fail together.",
        confirmLabel: "Grant Premium",
        variant: "default" as const,
      };
    }
    if (pendingAction === "extend") {
      return {
        title: `Extend premium for ${userName}?`,
        description: "This calls the backend admin premium RPC. The premium_until update, premium_history row, and admin audit row commit together or fail together.",
        confirmLabel: "Extend Premium",
        variant: "default" as const,
      };
    }
    if (pendingAction === "revoke") {
      return {
        title: `Revoke premium for ${userName}?`,
        description: "This calls the backend admin premium RPC. Premium removal, premium_history, and admin_activity_logs commit together or fail together.",
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
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md max-h-[85vh] overflow-y-auto bg-background border border-border rounded-2xl shadow-2xl z-[60] p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
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

        {/* Current Status */}
        {currentIsPremium ? (
          <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 mb-1">
              ✦ Active Premium
            </Badge>
            <p className="text-xs text-muted-foreground">
              Expires: {currentPremiumUntil ? format(new Date(currentPremiumUntil), "MMM d, yyyy 'at' h:mm a") : "Never"}
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

        {/* Tier (new grants only) */}
        {!currentIsPremium && (
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
        )}

        {/* Duration Picker */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            {currentIsPremium ? "Extend Duration" : "Grant Premium"}
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

        {/* Actions */}
        <div className="space-y-2">
          {currentIsPremium ? (
            <>
              <Button
                variant="gradient"
                className="w-full"
                onClick={() => setPendingAction("extend")}
                disabled={isSubmitting || (duration === "custom" && !customDate)}
              >
                Extend Premium
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => setPendingAction("revoke")}
                disabled={isSubmitting}
              >
                Revoke Premium
              </Button>
            </>
          ) : (
            <Button
              variant="gradient"
              className="w-full"
              onClick={() => setPendingAction("grant")}
              disabled={isSubmitting || (duration === "custom" && !customDate)}
            >
              Grant Premium
            </Button>
          )}
        </div>

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
                    by {entry.adminName} · {format(new Date(entry.created_at), "MMM d, yyyy")}
                  </p>
                  {entry.reason && (
                    <p className="text-foreground truncate">{entry.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </motion.div>

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
