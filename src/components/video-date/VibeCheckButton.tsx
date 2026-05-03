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
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const isFinalTenSeconds = timeLeft <= 10;
  const hasDecided = decision === true || decision === false;

  const handleTap = async (action: "vibe" | "pass") => {
    if (hasDecided || disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(action);
    setError(null);
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    try {
      const result = await Promise.resolve(action === "vibe" ? onVibe() : onPass());
      if (result === false) setError("Couldn’t save. Try again.");
    } catch {
      setError("Couldn’t save. Try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  if (hasDecided) {
    return (
      <div className="flex flex-col items-center gap-2 px-4">
        <div className="relative flex min-h-12 items-center gap-2 rounded-full border border-primary/50 bg-black/55 px-6 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.34)] backdrop-blur-2xl cursor-default">
          <Check className="w-5 h-5 text-primary" />
          <span className="text-sm font-display font-semibold text-primary">
            {decision ? "Vibe saved" : "Pass saved"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 px-4">
      <p className="text-center text-[12.5px] font-medium leading-none text-white/[0.74]">
        Choose when it feels right
      </p>
      <div className="flex h-[68px] w-[min(calc(100vw-48px),340px)] items-center justify-center gap-2.5 rounded-full border border-white/[0.10] bg-[rgba(10,10,16,0.62)] p-2 shadow-[0_14px_44px_rgba(0,0,0,0.35),0_0_28px_rgba(139,92,246,0.10),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
        <motion.button
          onClick={() => void handleTap("pass")}
          disabled={disabled || submitting !== null}
          whileTap={{ scale: 0.94 }}
          aria-label="Pass"
          className="relative flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-4 text-white/68 transition-colors hover:bg-white/[0.09] hover:text-white/85 disabled:opacity-60"
        >
          <X className="w-4 h-4" />
          <span className="text-[15px] font-display font-semibold leading-none">
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
          className="relative flex h-[52px] flex-[1.12] items-center justify-center gap-2 overflow-hidden rounded-full border border-white/20 bg-gradient-to-r from-primary to-accent px-5 text-primary-foreground shadow-[0_18px_44px_hsl(var(--primary)/0.34)] transition-colors disabled:opacity-60"
        >
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.34),transparent_34%)]" aria-hidden />
          <Heart className="relative w-5 h-5 fill-primary-foreground/25" />
          <span className="relative text-[15px] font-display font-semibold leading-none">
            {submitting === "vibe" ? "Saving..." : "Vibe"}
          </span>
        </motion.button>
      </div>
      {error ? (
        <p className="max-w-[280px] text-center text-[11px] font-medium leading-snug text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
};
