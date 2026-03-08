import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Minus, Coins, Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface AdminGrantCreditsModalProps {
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
}

const AdminGrantCreditsModal = ({
  userId,
  userName,
  isOpen,
  onClose,
}: AdminGrantCreditsModalProps) => {
  const [extraTime, setExtraTime] = useState(1);
  const [extendedVibe, setExtendedVibe] = useState(0);
  const [superVibe, setSuperVibe] = useState(0);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();

  const handleGrant = async () => {
    if (extraTime === 0 && extendedVibe === 0 && superVibe === 0) {
      toast.error("Select at least one credit type");
      return;
    }

    setIsSubmitting(true);

    try {
      // Check if user already has a credits row
      const { data: existing } = await supabase
        .from("user_credits")
        .select("extra_time_credits, extended_vibe_credits, super_vibe_credits")
        .eq("user_id", userId)
        .maybeSingle();

      const prevExtra = existing?.extra_time_credits || 0;
      const prevExtended = existing?.extended_vibe_credits || 0;
      const prevSuper = existing?.super_vibe_credits || 0;

      await supabase
        .from("user_credits")
        .upsert({
          user_id: userId,
          extra_time_credits: prevExtra + extraTime,
          extended_vibe_credits: prevExtended + extendedVibe,
          super_vibe_credits: prevSuper + superVibe,
        }, { onConflict: 'user_id' });

      // Log each credit adjustment
      const adjustments = [];
      if (extraTime > 0) adjustments.push({ credit_type: "extra_time", previous_value: prevExtra, new_value: prevExtra + extraTime });
      if (extendedVibe > 0) adjustments.push({ credit_type: "extended_vibe", previous_value: prevExtended, new_value: prevExtended + extendedVibe });
      if (superVibe > 0) adjustments.push({ credit_type: "super_vibe", previous_value: prevSuper, new_value: prevSuper + superVibe });

      if (user?.id && adjustments.length > 0) {
        await supabase.from("credit_adjustments").insert(
          adjustments.map((a) => ({
            admin_id: user.id,
            user_id: userId,
            credit_type: a.credit_type,
            previous_value: a.previous_value,
            new_value: a.new_value,
            adjustment_reason: reason || null,
          }))
        );
      }

      toast.success(
        `Granted ${extraTime > 0 ? `${extraTime}× Extra Time` : ""}${
          extraTime > 0 && (extendedVibe > 0 || superVibe > 0) ? " + " : ""
        }${extendedVibe > 0 ? `${extendedVibe}× Extended Vibe` : ""}${
          (extendedVibe > 0 || extraTime > 0) && superVibe > 0 ? " + " : ""
        }${superVibe > 0 ? `${superVibe}× Super Vibe` : ""} to ${userName}`
      );
      onClose();
    } catch (err) {
      console.error("Error granting credits:", err);
      toast.error("Failed to grant credits");
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

              {/* Extra Time (+2 min) */}
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

              {/* Extended Vibe (+5 min) */}
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

              {/* Super Vibe */}
              <div className="glass-card p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Super Vibe (each)</span>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setSuperVibe((p) => Math.max(0, p - 1))}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold text-foreground tabular-nums">{superVibe}</span>
                  <button
                    onClick={() => setSuperVibe((p) => p + 1)}
                    className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Reason */}
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
                onClick={handleGrant}
                disabled={isSubmitting || (extraTime === 0 && extendedVibe === 0 && superVibe === 0)}
              >
                {isSubmitting ? "Granting..." : "Grant Credits"}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AdminGrantCreditsModal;
