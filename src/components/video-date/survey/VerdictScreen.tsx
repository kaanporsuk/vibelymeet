import { motion } from "framer-motion";
import { AlertTriangle, Heart, Loader2, X } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface VerdictScreenProps {
  partnerName: string;
  partnerImage: string;
  onVerdict: (liked: boolean) => void;
  onSkip: () => void;
  onReport: () => void;
  isSubmitting?: boolean;
}

export const VerdictScreen = ({
  partnerName,
  partnerImage,
  onVerdict,
  onSkip,
  onReport,
  isSubmitting = false,
}: VerdictScreenProps) => {
  const partnerInitial = (partnerName.trim()[0] ?? "?").toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="relative flex w-full max-w-full flex-col items-center gap-7 overflow-hidden py-2"
    >
      <button
        type="button"
        onClick={() => {
          if (isSubmitting) return;
          haptics.light();
          onSkip();
        }}
        disabled={isSubmitting}
        aria-label="Skip this check-in"
        className={cn(
          "absolute right-0 top-0 z-10 flex min-h-11 items-center rounded-full border border-white/[0.08] bg-white/[0.045] px-4 text-xs font-semibold text-white/[0.62] backdrop-blur transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
          isSubmitting && "cursor-not-allowed opacity-50",
        )}
      >
        Skip
      </button>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
        className="relative flex h-28 w-28 items-center justify-center"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/35 via-accent/20 to-neon-cyan/20 blur-2xl" />
        <div className="relative rounded-full bg-gradient-to-br from-primary via-accent to-neon-cyan p-[3px] shadow-[0_0_44px_hsl(var(--primary)/0.35)]">
          {partnerImage ? (
            <img
              src={partnerImage}
              alt={partnerName}
              className="h-24 w-24 rounded-full border border-white/15 object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-secondary text-3xl font-display font-bold text-white">
              {partnerInitial}
            </div>
          )}
        </div>
        <motion.div
          className="absolute inset-2 rounded-full"
          animate={{
            boxShadow: [
              "0 0 20px hsl(var(--primary) / 0.28)",
              "0 0 42px hsl(var(--accent) / 0.42)",
              "0 0 20px hsl(var(--primary) / 0.28)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.div>

      <div className="space-y-2 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-white/[0.38]">
          Private check-in
        </p>
        <h2 className="text-balance font-display text-[1.7rem] font-bold leading-[1.05] tracking-normal text-foreground sm:text-3xl">
          Keep the vibe with {partnerName}?
        </h2>
        <p className="mx-auto max-w-[18rem] text-sm leading-relaxed text-white/[0.52]">
          If you both choose Vibe, the match opens. Otherwise, this stays quiet.
        </p>
      </div>

      <div className="w-full space-y-3.5">
        <motion.button
          whileHover={isSubmitting ? undefined : { scale: 1.012 }}
          whileTap={isSubmitting ? undefined : { scale: 0.985 }}
          onClick={() => {
            if (isSubmitting) return;
            haptics.light();
            onVerdict(true);
          }}
          disabled={isSubmitting}
          aria-label={`Vibe with ${partnerName}`}
          className={cn(
            "group relative h-16 w-full overflow-hidden rounded-2xl px-6 font-semibold text-lg shadow-[0_18px_60px_-18px_hsl(var(--accent)/0.9)] transition-opacity",
            isSubmitting && "cursor-not-allowed opacity-75",
          )}
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
          }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.28),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <motion.div
            className="absolute inset-0 rounded-2xl"
            animate={{
              boxShadow: [
                "inset 0 0 0 1px rgba(255,255,255,0.18), 0 0 26px hsl(var(--primary) / 0.32)",
                "inset 0 0 0 1px rgba(255,255,255,0.26), 0 0 44px hsl(var(--accent) / 0.46)",
                "inset 0 0 0 1px rgba(255,255,255,0.18), 0 0 26px hsl(var(--primary) / 0.32)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <div className="relative flex items-center justify-center gap-3 text-primary-foreground">
            {isSubmitting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Heart className="h-6 w-6 fill-current" aria-hidden="true" />
            )}
            <span>{isSubmitting ? "Saving..." : "Vibe"}</span>
          </div>
        </motion.button>

        <motion.button
          whileHover={isSubmitting ? undefined : { scale: 1.008 }}
          whileTap={isSubmitting ? undefined : { scale: 0.985 }}
          onClick={() => {
            if (isSubmitting) return;
            haptics.light();
            onVerdict(false);
          }}
          disabled={isSubmitting}
          aria-label={`Pass on ${partnerName}`}
          className={cn(
            "flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.055] px-6 text-white/[0.76] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:border-white/15 hover:bg-white/[0.08] hover:text-foreground",
            isSubmitting && "cursor-not-allowed opacity-55",
          )}
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="font-medium">Pass</span>
        </motion.button>
      </div>

      <button
        onClick={onReport}
        disabled={isSubmitting}
        className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Report an issue</span>
      </button>
    </motion.div>
  );
};
