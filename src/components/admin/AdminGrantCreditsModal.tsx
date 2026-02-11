import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Minus, Coins, Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGrant = async () => {
    if (extraTime === 0 && extendedVibe === 0) {
      toast.error("Select at least one credit type");
      return;
    }

    setIsSubmitting(true);

    try {
      // Check if user already has a credits row
      const { data: existing } = await supabase
        .from("user_credits")
        .select("extra_time_credits, extended_vibe_credits")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("user_credits")
          .update({
            extra_time_credits: existing.extra_time_credits + extraTime,
            extended_vibe_credits: existing.extended_vibe_credits + extendedVibe,
          })
          .eq("user_id", userId);
      } else {
        await supabase.from("user_credits").insert({
          user_id: userId,
          extra_time_credits: extraTime,
          extended_vibe_credits: extendedVibe,
        });
      }

      toast.success(
        `Granted ${extraTime > 0 ? `${extraTime}× Extra Time` : ""}${
          extraTime > 0 && extendedVibe > 0 ? " + " : ""
        }${extendedVibe > 0 ? `${extendedVibe}× Extended Vibe` : ""} to ${userName}`
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

              <Button
                variant="gradient"
                className="w-full"
                onClick={handleGrant}
                disabled={isSubmitting || (extraTime === 0 && extendedVibe === 0)}
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
