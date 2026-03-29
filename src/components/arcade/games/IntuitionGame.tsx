import { motion, AnimatePresence } from "framer-motion";
import { IntuitionPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import confetti from "canvas-confetti";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const EXPIRY_MS = 48 * 60 * 60 * 1000;

interface IntuitionGameProps {
  payload: IntuitionPayload;
  isOwn: boolean;
  matchName?: string;
  sessionCreatedAt?: string | null;
  onRespond?: (response: "correct" | "wrong") => void;
}

export const IntuitionGame = ({
  payload,
  isOwn,
  matchName = "They",
  sessionCreatedAt,
  onRespond,
}: IntuitionGameProps) => {
  const { playFeedback } = useSoundEffects();

  const createdMs = sessionCreatedAt ? new Date(sessionCreatedAt).getTime() : NaN;
  const isExpired =
    payload.step !== "completed" &&
    Number.isFinite(createdMs) &&
    Date.now() - createdMs > EXPIRY_MS;

  const response = payload.data.receiverResponse ?? null;
  const showOutcome = !isExpired && response !== null;
  const prediction = payload.data.options[payload.data.senderChoice];

  const handleRespond = (res: "correct" | "wrong") => {
    if (isExpired) return;

    if (res === "correct") {
      playFeedback("correct");
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
        colors: ["#8B5CF6", "#06B6D4", "#FFD700"],
      });
    } else {
      playFeedback("wrong");
    }

    onRespond?.(res);
  };

  const compact = showOutcome || isExpired;

  const headerSub = isExpired
    ? "This challenge expired"
    : response
      ? response === "correct"
        ? "Mind reader!"
        : "Not quite..."
      : "Are they right?";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full max-w-[min(100%,252px)] rounded-xl overflow-hidden",
        "bg-gradient-to-br from-indigo-500/20 to-blue-600/20",
        "border border-indigo-500/30 backdrop-blur-sm",
        isExpired && "opacity-50"
      )}
    >
      {/* Header */}
      <div className={cn("border-b border-indigo-500/20", compact ? "px-2 py-1.5" : "px-2.5 py-2")}>
        <div className="flex items-center gap-1.5">
          <span className={compact ? "text-base" : "text-xl"}>🔮</span>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-foreground leading-tight">Intuition Test</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">{headerSub}</p>
          </div>
        </div>
      </div>

      {/* Prediction */}
      <div className={cn("text-center", compact ? "px-2 py-1.5" : "px-2.5 py-3")}>
        <p className={cn("text-[11px] text-muted-foreground", compact ? "mb-1" : "mb-2")}>
          {isOwn ? "You think they prefer..." : `${matchName} thinks you prefer...`}
        </p>
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          className={cn(
            "inline-block rounded-xl",
            "bg-gradient-to-r from-indigo-500/30 to-blue-500/30",
            "border border-indigo-500/50",
            compact ? "px-3 py-1.5" : "px-4 py-2.5"
          )}
        >
          <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>{prediction}</p>
        </motion.div>
        <p className={cn("text-[11px] text-muted-foreground", compact ? "mt-1" : "mt-2")}>
          (vs. {payload.data.options[payload.data.senderChoice === 0 ? 1 : 0]})
        </p>
      </div>

      {/* Response Section */}
      <AnimatePresence mode="wait">
        {showOutcome && response ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="px-2 pb-2"
          >
            <div
              className={cn(
                "p-2 rounded-lg text-center",
                response === "correct"
                  ? "bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/50"
                  : "bg-red-500/20 border border-red-500/30"
              )}
            >
              {response === "correct" ? (
                <div className="flex items-center justify-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-amber-400">Mind reader</span>
                </div>
              ) : (
                <p className="text-xs text-red-400">Not quite</p>
              )}
            </div>
          </motion.div>
        ) : !isOwn && !isExpired ? (
          <motion.div
            key="buttons"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-1.5 px-2 pb-2"
          >
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRespond("correct")}
              className="flex-1 py-1.5 rounded-lg bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-medium text-xs transition-colors"
            >
              Correct
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRespond("wrong")}
              className="flex-1 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-medium text-xs transition-colors"
            >
              Wrong
            </motion.button>
          </motion.div>
        ) : !isExpired ? (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-2.5 pb-2"
          >
            <div className="p-2 rounded-xl bg-secondary/30 text-center">
              <p className="text-xs text-muted-foreground">Waiting for their response...</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
};
