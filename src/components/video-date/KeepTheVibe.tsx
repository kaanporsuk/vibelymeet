import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface KeepTheVibeProps {
  extraTimeCredits: number;
  extendedVibeCredits: number;
  onExtend: (minutes: number, type: "extra_time" | "extended_vibe") => Promise<boolean>;
}

export const KeepTheVibe = ({
  extraTimeCredits,
  extendedVibeCredits,
  onExtend,
}: KeepTheVibeProps) => {
  const [isExtending, setIsExtending] = useState(false);
  const hasCredits = extraTimeCredits > 0 || extendedVibeCredits > 0;

  const handleExtend = async (minutes: number, type: "extra_time" | "extended_vibe") => {
    if (isExtending) return;
    setIsExtending(true);

    const success = await onExtend(minutes, type);
    if (success) {
      toast.success(`${minutes} extra minutes added! 🎉`, { duration: 2500 });
    } else {
      toast.error("Failed to extend. Try again.");
    }

    setIsExtending(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2"
    >
      {hasCredits ? (
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {extraTimeCredits > 0 && (
              <motion.button
                key="extra-time"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                disabled={isExtending}
                onClick={() => handleExtend(2, "extra_time")}
                aria-label={`Add 2 minutes with Extra Time credit, ${extraTimeCredits} remaining`}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur-md border border-white/10 text-xs font-medium text-foreground hover:bg-card/90 transition-colors disabled:opacity-50"
              >
                <Clock className="w-3 h-3 text-primary" />
                +2 min
                <span className="text-muted-foreground">({extraTimeCredits})</span>
              </motion.button>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {extendedVibeCredits > 0 && (
              <motion.button
                key="extended-vibe"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                disabled={isExtending}
                onClick={() => handleExtend(5, "extended_vibe")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur-md border border-white/10 text-xs font-medium text-foreground hover:bg-card/90 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3 text-accent" />
                +5 min
                <span className="text-muted-foreground">({extendedVibeCredits})</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 max-w-[220px]">
          <p className="text-[9px] text-muted-foreground text-center leading-snug">
            Extra Time adds <span className="text-foreground/90 font-medium">+2 min</span>. Extended Vibe adds{" "}
            <span className="text-foreground/90 font-medium">+5 min</span>.
          </p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => window.open('/credits', '_blank')}
            aria-label="Get video date credits (opens in a new tab)"
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur-md border border-primary/30 text-xs font-medium text-foreground hover:bg-card/90 transition-colors"
          >
            <Sparkles className="w-3 h-3 text-primary" />
            ⚡ Get Credits
          </motion.button>
          <span className="text-[9px] text-muted-foreground text-center">Opens in new tab — date continues</span>
        </div>
      )}
    </motion.div>
  );
};
