import { motion } from "framer-motion";
import { ArrowRight, ClipboardCheck, PhoneOff, Timer, Video } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

interface ActiveCallBannerProps {
  sessionId: string;
  partnerName?: string | null;
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
        ? "Finish your date feedback"
        : "You have an active date!";
  const subtitle =
    mode === "ready_gate"
      ? partnerName
        ? `${partnerName} — open the event lobby to finish Ready Gate`
        : "Open the event lobby to finish Ready Gate"
      : mode === "survey"
        ? "Tell us how it went"
        : partnerName
          ? `With ${partnerName} — tap Rejoin`
          : "Tap Rejoin to return 💚";
  const rejoinLabel = mode === "ready_gate" ? "Continue" : mode === "survey" ? "Finish" : "Rejoin";
  const StatusIcon = mode === "ready_gate" ? Timer : mode === "survey" ? ClipboardCheck : Video;
  const actionLabel =
    mode === "ready_gate"
      ? "Open Ready Gate"
      : mode === "survey"
        ? "Finish date feedback"
        : "Rejoin active date";

  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRejoin();
  };

  return (
    <motion.div
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -8, opacity: 0 }}
      className="rounded-2xl bg-gradient-to-r from-primary to-accent p-[1px]"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={actionLabel}
        data-session-id={sessionId}
        onClick={onRejoin}
        onKeyDown={handleSurfaceKeyDown}
        className="group rounded-2xl bg-background/95 backdrop-blur-xl px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
      >
        <div className="flex items-center gap-3 min-w-0">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="shrink-0 w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center"
          >
            <StatusIcon className="w-4 h-4 text-primary" />
          </motion.div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onEnd ? (
            <button
              type="button"
              aria-label={mode === "ready_gate" ? "Leave Ready Gate" : "End date"}
              onClick={(event) => {
                event.stopPropagation();
                onEnd();
              }}
              className="w-8 h-8 rounded-full bg-destructive/15 flex items-center justify-center hover:bg-destructive/25 transition-colors"
            >
              <PhoneOff className="w-3.5 h-3.5 text-destructive" />
            </button>
          ) : null}
          <Button
            variant="gradient"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onRejoin();
            }}
            className="h-8 px-3 text-xs font-semibold"
          >
            {rejoinLabel}
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
