import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WouldRatherPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Zap } from "lucide-react";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const EXPIRY_MS = 48 * 60 * 60 * 1000;

interface WouldRatherGameProps {
  payload: WouldRatherPayload;
  isOwn: boolean;
  sessionCreatedAt?: string | null;
  onVote?: (choice: "A" | "B") => void;
}

export const WouldRatherGame = ({ payload, isOwn, sessionCreatedAt, onVote }: WouldRatherGameProps) => {
  const { playFeedback } = useSoundEffects();

  const myVote: "A" | "B" | null = isOwn
    ? (payload.data.senderVote ?? null)
    : (payload.data.receiverVote ?? null);

  const bothVoted = !!(payload.data.senderVote && payload.data.receiverVote);
  const isMatch = payload.data.isMatch;

  const createdMs = sessionCreatedAt ? new Date(sessionCreatedAt).getTime() : NaN;
  const isExpired =
    payload.step !== "completed" &&
    Number.isFinite(createdMs) &&
    Date.now() - createdMs > EXPIRY_MS;

  useEffect(() => {
    if (isMatch && bothVoted) {
      playFeedback("match");
    }
  }, [isMatch, bothVoted, playFeedback]);

  const handleVote = (choice: "A" | "B") => {
    if (myVote || isOwn || isExpired) return;
    playFeedback("click");
    onVote?.(choice);
  };

  const getOptionState = (option: "A" | "B") => {
    if (isExpired) return "default";
    if (!myVote) return "voting";
    if (bothVoted) {
      if (isMatch && payload.data.senderVote === option) return "match";
      if (payload.data.senderVote === option && payload.data.receiverVote === option) return "match";
      if (payload.data.senderVote === option) return "sender";
      if (payload.data.receiverVote === option) return "receiver";
    }
    if (myVote === option) return "selected";
    return "default";
  };

  const headerSub = isExpired
    ? "This challenge expired"
    : !myVote
      ? "Pick one!"
      : bothVoted
        ? "Results are in!"
        : "Waiting for their vote...";

  const compact = bothVoted || isExpired;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full max-w-[280px] rounded-2xl overflow-hidden",
        "border backdrop-blur-sm",
        isExpired && "opacity-50",
        isExpired
          ? "bg-gradient-to-br from-amber-500/10 to-orange-600/10 border-amber-500/30"
          : isMatch
            ? "bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border-amber-500/50"
            : "bg-gradient-to-br from-amber-500/10 to-orange-600/10 border-amber-500/30"
      )}
    >
      {/* Header */}
      <div className={cn("border-b border-amber-500/20", compact ? "px-2.5 py-2" : "p-3")}>
        <div className="flex items-center gap-2">
          <span className={compact ? "text-lg" : "text-2xl"}>⚡</span>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-foreground leading-tight">Would You Rather?</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">{headerSub}</p>
          </div>
        </div>
      </div>

      {/* Split Card */}
      <div className="relative flex">
        {/* Option A */}
        <motion.button
          type="button"
          whileTap={!myVote && !isExpired ? { scale: 0.98 } : undefined}
          onClick={() => handleVote("A")}
          disabled={!!myVote || isExpired}
          className={cn(
            "flex-1 text-center transition-all duration-300 border-r border-amber-500/20",
            compact ? "px-2 py-2.5" : "p-4",
            getOptionState("A") === "voting" && "hover:bg-amber-500/10",
            getOptionState("A") === "selected" && "bg-amber-500/20",
            getOptionState("A") === "match" && "bg-amber-500/30",
            getOptionState("A") === "sender" && "bg-neon-violet/20",
            getOptionState("A") === "receiver" && "bg-neon-cyan/20"
          )}
        >
          <p className={cn("text-sm font-medium text-foreground", compact ? "mb-1" : "mb-2")}>{payload.data.optionA}</p>
          <AnimatePresence>
            {!isExpired &&
              bothVoted &&
              payload.data.senderVote === "A" && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-violet/30 text-neon-violet"
                >
                  {isOwn ? "You" : "Them"}
                </motion.div>
              )}
            {!isExpired &&
              bothVoted &&
              payload.data.receiverVote === "A" && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-cyan/30 text-neon-cyan ml-1"
                >
                  {isOwn ? "Them" : "You"}
                </motion.div>
              )}
          </AnimatePresence>
        </motion.button>

        {/* Lightning Divider */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div
            className={cn(
              "rounded-full bg-background border border-amber-500/50 flex items-center justify-center",
              compact ? "w-7 h-7" : "w-8 h-8",
            )}
          >
            <Zap className={cn("text-amber-500", compact ? "w-3.5 h-3.5" : "w-4 h-4")} />
          </div>
        </div>

        {/* Option B */}
        <motion.button
          type="button"
          whileTap={!myVote && !isExpired ? { scale: 0.98 } : undefined}
          onClick={() => handleVote("B")}
          disabled={!!myVote || isExpired}
          className={cn(
            "flex-1 text-center transition-all duration-300",
            compact ? "px-2 py-2.5" : "p-4",
            getOptionState("B") === "voting" && "hover:bg-amber-500/10",
            getOptionState("B") === "selected" && "bg-amber-500/20",
            getOptionState("B") === "match" && "bg-amber-500/30",
            getOptionState("B") === "sender" && "bg-neon-violet/20",
            getOptionState("B") === "receiver" && "bg-neon-cyan/20"
          )}
        >
          <p className={cn("text-sm font-medium text-foreground", compact ? "mb-1" : "mb-2")}>{payload.data.optionB}</p>
          <AnimatePresence>
            {!isExpired &&
              bothVoted &&
              payload.data.senderVote === "B" && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-violet/30 text-neon-violet"
                >
                  {isOwn ? "You" : "Them"}
                </motion.div>
              )}
            {!isExpired &&
              bothVoted &&
              payload.data.receiverVote === "B" && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-cyan/30 text-neon-cyan ml-1"
                >
                  {isOwn ? "Them" : "You"}
                </motion.div>
              )}
          </AnimatePresence>
        </motion.button>
      </div>

      {isExpired ? (
        <p className="text-[11px] text-muted-foreground text-center px-2 py-1.5 border-t border-amber-500/20">
          This challenge expired
        </p>
      ) : null}

      {/* Match Banner */}
      <AnimatePresence>
        {!isExpired && isMatch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className={cn("bg-gradient-to-r from-amber-500/30 to-yellow-500/30 text-center", compact ? "py-1.5 px-2" : "p-2")}
          >
            <motion.div
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ repeat: Infinity, duration: 1.6 }}
              className={cn("text-amber-400 font-semibold", compact ? "text-xs" : "text-sm")}
            >
              ⭐ It's a Match! ⭐
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
