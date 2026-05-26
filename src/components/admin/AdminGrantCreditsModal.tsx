import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Minus, Coins, Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminTargetIdempotencyKey } from "@/lib/adminRpc";
import { invalidateAdminQueries } from "@/lib/adminQueryInvalidation";
import { adminToast } from "@/lib/adminToast";
import { resolveAdminErrorMessage } from "@/lib/adminErrorResolver";

interface AdminGrantCreditsModalProps {
  userId: string;
  userName: string;
  currentCredits?: {
    extra_time_credits: number;
    extended_vibe_credits: number;
    updated_at: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
}

const AdminGrantCreditsModal = ({
  userId,
  userName,
  currentCredits,
  isOpen,
  onClose,
}: AdminGrantCreditsModalProps) => {
  const queryClient = useQueryClient();
  const [extraTime, setExtraTime] = useState(1);
  const [extendedVibe, setExtendedVibe] = useState(0);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const grantSummary = `${extraTime > 0 ? `${extraTime} Extra Time` : ""}${
    extraTime > 0 && extendedVibe > 0 ? " + " : ""
  }${extendedVibe > 0 ? `${extendedVibe} Extended Vibe` : ""}`;

  const openGrantConfirmation = () => {
    if (extraTime === 0 && extendedVibe === 0) {
      adminToast.error({
        id: "grant-credits-none-selected",
        title: "Select at least one credit type",
      });
      return;
    }
    setConfirmOpen(true);
  };

  const handleGrant = async () => {
    if (extraTime === 0 && extendedVibe === 0) {
      adminToast.error({
        id: "grant-credits-none-selected",
        title: "Select at least one credit type",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const adjustments = [
        ...(extraTime > 0 ? [{ credit_type: "extra_time", delta: extraTime }] : []),
        ...(extendedVibe > 0 ? [{ credit_type: "extended_vibe", delta: extendedVibe }] : []),
      ];

      await callAdminRpc("admin_adjust_user_credits", {
        p_user_id: userId,
        p_adjustments: adjustments,
        p_reason: reason || null,
        p_idempotency_key: createAdminTargetIdempotencyKey("admin_adjust_user_credits", userId, {
          adjustments,
          current_extra_time_credits: currentCredits?.extra_time_credits ?? null,
          current_extended_vibe_credits: currentCredits?.extended_vibe_credits ?? null,
          current_credits_updated_at: currentCredits?.updated_at ?? null,
          reason: reason || null,
        }),
      });

      adminToast.success({
        id: `grant-credits-success-${userId}`,
        title: `Granted ${extraTime > 0 ? `${extraTime}× Extra Time` : ""}${
          extraTime > 0 && extendedVibe > 0 ? " + " : ""
        }${extendedVibe > 0 ? `${extendedVibe}× Extended Vibe` : ""} to ${userName}`,
      });
      await invalidateAdminQueries(queryClient, ["users"]);
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      adminToast.error({
        id: `grant-credits-failed-${userId}`,
        title: "Failed to grant credits",
        description: resolveAdminErrorMessage(err, "Failed to grant credits"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          >
            <div className="glass-card p-6 rounded-2xl w-full max-w-sm space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-bold text-foreground">Grant Credits</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                Grant extension credits to <span className="font-medium text-foreground">{userName}</span>
              </p>

              <div className="glass-card p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Extra Time (+2 min each)</span>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setExtraTime((p) => Math.max(0, p - 1))}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold text-foreground tabular-nums">{extraTime}</span>
                  <button
                    onClick={() => setExtraTime((p) => p + 1)}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="glass-card p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-foreground">Extended Vibe (+5 min each)</span>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setExtendedVibe((p) => Math.max(0, p - 1))}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold text-foreground tabular-nums">{extendedVibe}</span>
                  <button
                    onClick={() => setExtendedVibe((p) => p + 1)}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <input
                type="text"
                placeholder="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground"
              />

              <Button
                variant="gradient"
                className="w-full"
                onClick={openGrantConfirmation}
                disabled={isSubmitting || (extraTime === 0 && extendedVibe === 0)}
              >
                {isSubmitting ? "Granting..." : "Grant Credits"}
              </Button>
            </div>
            <AdminConfirmDialog
              open={confirmOpen}
              title={`Grant credits to ${userName}?`}
              description={`This calls the backend admin credit adjustment RPC for ${grantSummary || "the selected credits"}. The balance update, credit_adjustments rows, and admin_activity_logs row commit together or fail together.${reason.trim() ? `\n\nReason: ${reason.trim()}` : ""}`}
              confirmLabel="Grant Credits"
              variant="default"
              isPending={isSubmitting}
              onOpenChange={setConfirmOpen}
              onConfirm={handleGrant}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AdminGrantCreditsModal;
