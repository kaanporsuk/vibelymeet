import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Wifi } from "lucide-react";

interface ReconnectionOverlayProps {
  isVisible: boolean;
  partnerName: string;
  graceTimeLeft: number;
  mode?: "partner_away" | "network_interrupted";
  networkTier?: "good" | "fair" | "poor";
  backdropImageUrl?: string | null;
}

export const ReconnectionOverlay = ({
  isVisible,
  partnerName,
  graceTimeLeft,
  mode = "partner_away",
  networkTier = "good",
  backdropImageUrl = null,
}: ReconnectionOverlayProps) => {
  const title =
    mode === "network_interrupted"
      ? "Reconnecting gently..."
      : "Keeping the room open...";
  const subtitle =
    mode === "network_interrupted"
      ? "The connection softened. We'll hold the room for a few seconds."
      : "Your match may be stepping back in. We'll hold the room for a few seconds.";
  const ariaLabel =
    mode === "network_interrupted"
      ? "Trying to reconnect"
      : `Trying to reconnect with ${partnerName}`;
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-center justify-center"
          aria-label={ariaLabel}
        >
          {backdropImageUrl ? (
            <img
              src={backdropImageUrl}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
            />
          ) : null}
          <div className="absolute inset-0 bg-background/65 backdrop-blur-xl" />

          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative z-10 glass-card p-8 rounded-3xl text-center space-y-4 max-w-xs"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <Wifi className="w-10 h-10 text-primary mx-auto" />
            </motion.div>

            <div className="space-y-1">
              <h3 className="text-lg font-display font-semibold text-foreground">
                {title}
              </h3>
              <p className="text-sm text-muted-foreground">
                {subtitle}
              </p>
            </div>

            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-2xl font-display font-bold text-foreground tabular-nums">
                {graceTimeLeft}s
              </span>
            </div>

            {networkTier !== "good" && (
              <div className="mx-auto inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-white/70">
                {networkTier === "poor" ? "Audio priority mode" : "Stabilizing video"}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
