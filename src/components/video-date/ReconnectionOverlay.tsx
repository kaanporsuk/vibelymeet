import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Wifi } from "lucide-react";

interface ReconnectionOverlayProps {
  isVisible: boolean;
  partnerName: string;
  graceTimeLeft: number;
}

export const ReconnectionOverlay = ({
  isVisible,
  partnerName,
  graceTimeLeft,
}: ReconnectionOverlayProps) => {
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
                Reconnecting with {partnerName}...
              </h3>
              <p className="text-sm text-muted-foreground">
                Hang tight — they might be back! ⏳
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
