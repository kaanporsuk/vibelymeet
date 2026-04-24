import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Wifi } from "lucide-react";

interface ReconnectionOverlayProps {
  isVisible: boolean;
  partnerName: string;
  graceTimeLeft: number;
  mode?: "partner_away" | "network_interrupted";
}

export const ReconnectionOverlay = ({
  isVisible,
  partnerName,
  graceTimeLeft,
  mode = "partner_away",
}: ReconnectionOverlayProps) => {
  const title =
    mode === "network_interrupted"
      ? "Connection interrupted - reconnecting..."
      : `Reconnecting with ${partnerName}...`;
  const subtitle =
    mode === "network_interrupted"
      ? "Your match may be reconnecting. We'll keep the date open for a moment."
      : "Hang tight - they might be back! We'll keep the date open for a moment.";
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />

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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
