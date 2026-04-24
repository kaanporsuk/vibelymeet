import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Heart, X } from "lucide-react";

interface VibeCheckButtonProps {
  timeLeft: number;
  decision?: boolean | null;
  onVibe: () => void | Promise<boolean | void>;
  onPass: () => void | Promise<boolean | void>;
  disabled?: boolean;
  /** Server Last Chance grace: local user still owes a decision. */
  graceSecondsRemaining?: number | null;
}

export const VibeCheckButton = ({
  timeLeft,
  decision,
  onVibe,
  onPass,
  disabled,
  graceSecondsRemaining,
}: VibeCheckButtonProps) => {
  const [submitting, setSubmitting] = useState<"vibe" | "pass" | null>(null);
  const submittingRef = useRef(false);
  const inGrace = graceSecondsRemaining != null;
  const isProminent = inGrace || timeLeft <= 20;
  const hasDecided = decision === true || decision === false;

  const handleTap = async (action: "vibe" | "pass") => {
    if (hasDecided || disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(action);
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    try {
      const result = await Promise.resolve(action === "vibe" ? onVibe() : onPass());
      if (result === false) return;
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  if (hasDecided) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="relative flex items-center gap-2 px-6 py-3 rounded-full border border-primary/50 bg-primary/20 cursor-default">
          <Check className="w-5 h-5 text-primary" />
          <span className="text-sm font-display font-semibold text-primary">
            {decision ? "Vibed" : "Passed"}
          </span>
        </div>
        <p className="max-w-[240px] text-center text-[10px] leading-snug text-muted-foreground/75">
          Waiting for your match...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {inGrace && !hasDecided ? (
        <motion.p
          className="text-[11px] font-display font-bold tracking-widest text-primary uppercase"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 0.72, repeat: Infinity, ease: "easeInOut" }}
        >
          Last Chance
        </motion.p>
      ) : null}
      <p
        className="max-w-[240px] text-center text-[11px] font-medium leading-snug text-foreground"
      >
        Vibe or Pass to continue
      </p>
      <div className="flex items-center gap-2">
        <motion.button
          onClick={() => void handleTap("pass")}
          disabled={disabled || submitting !== null}
          whileTap={{ scale: 0.94 }}
          className="relative flex items-center gap-2 px-4 py-3 rounded-full border border-border/70 bg-secondary/50 text-muted-foreground transition-colors disabled:opacity-60"
        >
          <X className="w-4 h-4" />
          <span className="text-sm font-display font-semibold">
            {submitting === "pass" ? "Saving..." : "Pass"}
          </span>
        </motion.button>
        <motion.button
          onClick={() => void handleTap("vibe")}
          disabled={disabled || submitting !== null}
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
          transition={isProminent ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : {}}
          className="relative flex items-center gap-2 px-5 py-3 rounded-full border-2 border-primary/80 bg-primary text-primary-foreground shadow-lg transition-colors disabled:opacity-60"
        >
          <Heart className="w-5 h-5 fill-primary-foreground/30" />
          <span className="text-sm font-display font-semibold">
            {submitting === "vibe" ? "Saving..." : "Vibe"}
          </span>
        </motion.button>
      </div>
      <p
        className={`max-w-[240px] text-center text-[10px] leading-snug ${inGrace ? "text-primary font-medium" : "text-muted-foreground/70"}`}
      >
        {inGrace
          ? `${graceSecondsRemaining}s left to choose.`
          : isProminent
            ? "Last chance: choose before the timer ends."
            : "Your choice only continues after it saves."}
      </p>
    </div>
  );
};
