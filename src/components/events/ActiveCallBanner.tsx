import { motion } from "framer-motion";
import { ArrowRight, ClipboardCheck, PhoneOff, Timer, Video } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

interface ActiveCallBannerProps {
  sessionId: string;
  partnerName?: string | null;
  /** ready_gate = standalone Ready Gate; survey/video = /date */
  mode?: "video" | "ready_gate" | "survey";
  onRejoin: () => void;
  onEnd?: () => void;
  disabled?: boolean;
  isBusy?: boolean;
}

export const ActiveCallBanner = ({
  sessionId,
  partnerName,
  mode = "video",
  onRejoin,
  onEnd,
  disabled = false,
  isBusy = false,
}: ActiveCallBannerProps) => {
  const isDisabled = disabled || isBusy;
  const title =
    mode === "ready_gate"
      ? "Ready Gate in progress"
      : mode === "survey"
        ? "Finish your date feedback"
        : "You have an active date!";
  const subtitle =
    mode === "ready_gate"
      ? partnerName
        ? `${partnerName} — open Ready Gate to sync up`
        : "Open Ready Gate to sync up"
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
    if (isDisabled) return;
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
        tabIndex={isDisabled ? -1 : 0}
        aria-label={actionLabel}
        aria-disabled={isDisabled}
        aria-busy={isBusy}
        data-session-id={sessionId}
        onClick={() => {
          if (isDisabled) return;
          onRejoin();
        }}
        onKeyDown={handleSurfaceKeyDown}
        className={`group rounded-2xl bg-background/95 backdrop-blur-xl px-4 py-3 flex items-center justify-between gap-3 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
          isDisabled ? "cursor-wait opacity-70" : "cursor-pointer hover:opacity-90"
        }`}
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
              disabled={isDisabled}
              onClick={(event) => {
                event.stopPropagation();
                if (isDisabled) return;
                onEnd();
              }}
              className="w-8 h-8 rounded-full bg-destructive/15 flex items-center justify-center hover:bg-destructive/25 transition-colors disabled:cursor-wait disabled:opacity-60"
            >
              <PhoneOff className="w-3.5 h-3.5 text-destructive" />
            </button>
          ) : null}
          <Button
            variant="gradient"
            size="sm"
            disabled={isDisabled}
            onClick={(event) => {
              event.stopPropagation();
              if (isDisabled) return;
              onRejoin();
            }}
            className="h-8 px-3 text-xs font-semibold disabled:cursor-wait disabled:opacity-75"
          >
            {rejoinLabel}
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
