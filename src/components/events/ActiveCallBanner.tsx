import { motion } from "framer-motion";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ActiveCallBannerProps {
  sessionId: string;
  partnerName?: string;
  /** ready_gate = lobby overlay destination; survey/video = /date */
  mode?: "video" | "ready_gate" | "survey";
  onRejoin: () => void;
  onEnd?: () => void;
}

export const ActiveCallBanner = ({
  sessionId,
  partnerName,
  mode = "video",
  onRejoin,
  onEnd,
}: ActiveCallBannerProps) => {
  const title =
    mode === "ready_gate"
      ? "Ready Gate in progress"
      : mode === "survey"
        ? "Date feedback pending"
        : "You have an active date!";
  const subtitle =
    mode === "ready_gate"
      ? partnerName
        ? `${partnerName} — open the event lobby to finish Ready Gate`
        : "Open the event lobby to finish Ready Gate"
      : mode === "survey"
        ? partnerName
          ? `With ${partnerName} — finish your feedback`
          : "Finish your post-date feedback"
        : partnerName
          ? `With ${partnerName} — tap Rejoin`
          : "Tap Rejoin to return 💚";
  const rejoinLabel = mode === "ready_gate" ? "Continue" : mode === "survey" ? "Finish" : "Rejoin";

  return (
    <motion.div
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -80, opacity: 0 }}
      className="fixed top-0 left-0 right-0 z-[60] px-4 pt-safe"
    >
      <div className="max-w-lg mx-auto mt-2 rounded-2xl bg-gradient-to-r from-primary to-accent p-[1px]">
        <div className="rounded-2xl bg-background/95 backdrop-blur-xl px-4 py-3 flex items-center justify-between gap-3">
          {/* Pulsing indicator + text */}
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="shrink-0 w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center"
            >
              <Video className="w-4 h-4 text-primary" />
            </motion.div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{title}</p>
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {onEnd ? (
              <button
                type="button"
                aria-label={mode === "ready_gate" ? "Leave Ready Gate" : "End date"}
                onClick={onEnd}
                className="w-8 h-8 rounded-full bg-destructive/15 flex items-center justify-center hover:bg-destructive/25 transition-colors"
              >
                <PhoneOff className="w-3.5 h-3.5 text-destructive" />
              </button>
            ) : null}
            <Button
              variant="gradient"
              size="sm"
              onClick={onRejoin}
              className="h-8 px-3 text-xs font-semibold"
            >
              <Phone className="w-3 h-3 mr-1" />
              {rejoinLabel}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
