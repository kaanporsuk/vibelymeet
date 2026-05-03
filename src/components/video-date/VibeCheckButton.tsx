import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Heart, X } from "lucide-react";

interface VibeCheckButtonProps {
  timeLeft: number;
  decision?: boolean | null;
  onVibe: () => void | Promise<boolean | void>;
  onPass: () => void | Promise<boolean | void>;
  disabled?: boolean;
}

export const VibeCheckButton = ({
  timeLeft,
  decision,
  onVibe,
  onPass,
  disabled,
}: VibeCheckButtonProps) => {
  const [submitting, setSubmitting] = useState<"vibe" | "pass" | null>(null);
  const submittingRef = useRef(false);
  const isFinalTenSeconds = timeLeft <= 10;
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
      <div className="flex flex-col items-center gap-2">
        <div className="relative flex min-h-12 items-center gap-2 rounded-full border border-primary/50 bg-black/50 px-6 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.34)] backdrop-blur-2xl cursor-default">
          <Check className="w-5 h-5 text-primary" />
          <span className="text-sm font-display font-semibold text-primary">
            {decision ? "Vibed" : "Passed"}
          </span>
        </div>
        <p className="max-w-[240px] text-center text-[10px] leading-snug text-muted-foreground/75">
          Waiting softly for your match...
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 px-4">
      {isFinalTenSeconds && !hasDecided ? (
        <motion.p
          className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-display font-bold uppercase tracking-[0.22em] text-accent"
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 0.72, repeat: Infinity, ease: "easeInOut" }}
        >
          Soft nudge
        </motion.p>
      ) : null}
      <div className="flex w-full max-w-[360px] items-center justify-center gap-2.5 rounded-full border border-white/[0.12] bg-black/[0.35] p-1.5 shadow-[0_20px_64px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
        <motion.button
          onClick={() => void handleTap("pass")}
          disabled={disabled || submitting !== null}
          whileTap={{ scale: 0.94 }}
          aria-label="Pass"
          className="relative flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-4 py-3 text-white/60 transition-colors hover:bg-white/[0.09] hover:text-white/80 disabled:opacity-60"
        >
          <X className="w-4 h-4" />
          <span className="text-[15px] font-display font-semibold">
            {submitting === "pass" ? "Saving..." : "Pass"}
          </span>
        </motion.button>
        <motion.button
          onClick={() => void handleTap("vibe")}
          disabled={disabled || submitting !== null}
          whileTap={{ scale: 0.92 }}
          animate={
            isFinalTenSeconds
              ? {
                  scale: [1, 1.08, 1],
                  boxShadow: [
                    "0 0 0px hsl(var(--primary) / 0)",
                    "0 0 30px hsl(var(--primary) / 0.65)",
                    "0 0 0px hsl(var(--primary) / 0)",
                  ],
                }
              : {}
          }
          transition={isFinalTenSeconds ? { duration: 0.82, repeat: Infinity, ease: "easeInOut" } : {}}
          aria-label="Vibe"
          className="relative flex min-h-12 flex-[1.12] items-center justify-center gap-2 overflow-hidden rounded-full border border-white/20 bg-gradient-to-r from-primary to-accent px-5 py-3 text-primary-foreground shadow-[0_18px_44px_hsl(var(--primary)/0.36)] transition-colors disabled:opacity-60"
        >
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.34),transparent_34%)]" aria-hidden />
          <Heart className="relative w-5 h-5 fill-primary-foreground/25" />
          <span className="relative text-[15px] font-display font-semibold">
            {submitting === "vibe" ? "Saving..." : "Vibe"}
          </span>
        </motion.button>
      </div>
      <p
        className={`max-w-[280px] text-center text-[10.5px] leading-snug ${isFinalTenSeconds ? "text-accent font-medium" : "text-white/[0.45]"}`}
      >
        {isFinalTenSeconds
          ? "Choose from the feeling, not the clock."
          : "Choose when it feels right."}
      </p>
    </div>
  );
};
