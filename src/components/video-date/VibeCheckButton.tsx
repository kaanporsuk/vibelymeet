import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Check, Sparkles } from "lucide-react";

interface VibeCheckButtonProps {
  timeLeft: number;
  onVibe: () => void;
  disabled?: boolean;
}

export const VibeCheckButton = ({ timeLeft, onVibe, disabled }: VibeCheckButtonProps) => {
  const [hasVibed, setHasVibed] = useState(false);
  const isProminent = timeLeft <= 20; // At the 40-second mark (20s remaining)

  const handleTap = () => {
    if (hasVibed || disabled) return;
    setHasVibed(true);
    onVibe();
    // Haptic
    if (navigator.vibrate) {
      navigator.vibrate([30, 50, 30]);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <AnimatePresence mode="wait">
        {hasVibed ? (
          <motion.button
            key="vibed"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative flex items-center gap-2 px-6 py-3 rounded-full border border-primary/50 bg-primary/20 cursor-default"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.1 }}
            >
              <Check className="w-5 h-5 text-primary" />
            </motion.div>
            <span className="text-sm font-display font-semibold text-primary">
              Vibed
            </span>

            {/* Sparkle particles */}
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1.5 h-1.5 rounded-full bg-primary"
                initial={{ opacity: 1, scale: 1 }}
                animate={{
                  opacity: 0,
                  scale: 0,
                  x: Math.cos((i * Math.PI * 2) / 6) * 40,
                  y: Math.sin((i * Math.PI * 2) / 6) * 40,
                }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
              />
            ))}
          </motion.button>
        ) : (
          <motion.button
            key="not-vibed"
            onClick={handleTap}
            disabled={disabled}
            whileTap={{ scale: 0.92 }}
            animate={
              isProminent
                ? {
                    scale: [1, 1.05, 1],
                    boxShadow: [
                      "0 0 0px hsl(var(--primary) / 0)",
                      "0 0 24px hsl(var(--primary) / 0.5)",
                      "0 0 0px hsl(var(--primary) / 0)",
                    ],
                  }
                : {}
            }
            transition={
              isProminent
                ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
                : {}
            }
            className={`
              relative flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-700
              ${
                isProminent
                  ? "bg-primary border-2 border-primary/80 shadow-lg"
                  : "bg-secondary/40 border border-border/50 opacity-70"
              }
            `}
          >
            {isProminent && (
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ rotate: [0, 15, -15, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="w-4 h-4 text-accent" />
              </motion.div>
            )}

            <Heart
              className={`w-5 h-5 transition-colors duration-700 ${
                isProminent
                  ? "text-primary-foreground fill-primary-foreground/30"
                  : "text-muted-foreground"
              }`}
            />
            <span
              className={`text-sm font-display font-semibold transition-colors duration-700 ${
                isProminent ? "text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              Vibed ✓
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Subtle hint text */}
      {!hasVibed && (
        <motion.p
          className="text-[10px] text-muted-foreground/60"
          animate={isProminent ? { opacity: [0.6, 1, 0.6] } : {}}
          transition={isProminent ? { duration: 2, repeat: Infinity } : {}}
        >
          {isProminent ? "Tap if you're feeling the vibe!" : "Feeling it?"}
        </motion.p>
      )}
    </div>
  );
};
