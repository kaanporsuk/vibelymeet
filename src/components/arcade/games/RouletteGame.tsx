import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { RoulettePayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Lock, Eye } from "lucide-react";

const EXPIRY_MS = 48 * 60 * 60 * 1000;

interface RouletteGameProps {
  payload: RoulettePayload;
  isOwn: boolean;
  sessionCreatedAt?: string | null;
  onAnswer?: (answer: string) => void;
}

export const RouletteGame = ({ payload, isOwn, sessionCreatedAt, onAnswer }: RouletteGameProps) => {
  const [answerDraft, setAnswerDraft] = useState("");

  const isUnlocked = payload.data.isUnlocked;
  const hasSubmitted = !!payload.data.receiverAnswer || payload.step === "completed";

  const createdMs = sessionCreatedAt ? new Date(sessionCreatedAt).getTime() : NaN;
  const isExpired =
    payload.step !== "completed" &&
    Number.isFinite(createdMs) &&
    Date.now() - createdMs > EXPIRY_MS;

  const handleSubmit = useCallback(() => {
    const trimmed = answerDraft.trim();
    if (!trimmed || isOwn || hasSubmitted || isExpired) return;
    onAnswer?.(trimmed);
    setAnswerDraft("");
  }, [answerDraft, isOwn, hasSubmitted, isExpired, onAnswer]);

  const headerSub = isExpired
    ? "This challenge expired"
    : isUnlocked
      ? "Answers revealed!"
      : "Answer to unlock";

  const compact = isExpired || isUnlocked || hasSubmitted;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full max-w-[min(100%,252px)] rounded-xl overflow-hidden",
        "bg-gradient-to-br from-cyan-500/20 to-teal-600/20",
        "border border-cyan-500/30 backdrop-blur-sm",
        isExpired && "opacity-50"
      )}
    >
      {/* Header */}
      <div className={cn("border-b border-cyan-500/20", compact ? "px-2 py-1.5" : "px-2.5 py-2")}>
        <div className="flex items-center gap-1.5">
          <span className={compact ? "text-base" : "text-xl"}>🎡</span>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-foreground leading-tight">Vibe Roulette</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">{headerSub}</p>
          </div>
        </div>
      </div>

      {/* Question */}
      <div className={cn("border-b border-cyan-500/20", compact ? "px-2 py-1.5" : "px-2.5 py-2.5")}>
        <p className="text-xs font-medium text-foreground text-center italic leading-snug">
          "{payload.data.question}"
        </p>
      </div>

      {/* Answers */}
      <div className={cn(compact ? "p-2 space-y-1.5" : "p-2.5 space-y-2")}>
        {/* Sender's Answer */}
        <div className="relative">
          <div
            className={cn(
              "rounded-lg border",
              compact ? "py-1.5 px-2" : "p-2",
              isUnlocked
                ? "bg-neon-violet/10 border-neon-violet/30"
                : "bg-secondary/50 border-border/50"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-neon-violet font-medium">
                {isOwn ? "Your answer" : "Their answer"}
              </span>
            </div>
            {isUnlocked ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-foreground"
              >
                {payload.data.senderAnswer}
              </motion.p>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Lock className="w-4 h-4" />
                <span className="text-sm blur-sm select-none">Hidden until you answer</span>
              </div>
            )}
          </div>
        </div>

        {/* Receiver's Answer / Input */}
        <div className="relative">
          {isExpired ? (
            <p className="text-sm text-muted-foreground text-center px-2 py-2">This challenge expired</p>
          ) : isUnlocked && hasSubmitted ? (
            <div className={cn("rounded-lg bg-neon-cyan/10 border border-neon-cyan/30", compact ? "py-1.5 px-2" : "p-2")}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-neon-cyan font-medium">
                  {isOwn ? "Their answer" : "Your answer"}
                </span>
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-foreground"
              >
                {payload.data.receiverAnswer ?? ""}
              </motion.p>
            </div>
          ) : hasSubmitted ? (
            <div className={cn("rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-center", compact ? "py-1.5 px-2" : "p-2")}>
              <Eye className="w-4 h-4 text-cyan-400 mx-auto mb-0.5" />
              <p className="text-[11px] text-cyan-400 font-medium">Submitted</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Waiting for reveal</p>
            </div>
          ) : !isOwn ? (
            <div className="space-y-2">
              <textarea
                value={answerDraft}
                onChange={(e) => setAnswerDraft(e.target.value)}
                placeholder="Answer to reveal..."
                rows={2}
                maxLength={500}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-secondary/50 border border-border/50 focus:outline-none focus:border-cyan-500/50 resize-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!answerDraft.trim()}
                className="w-full py-1.5 rounded-lg bg-cyan-500/30 hover:bg-cyan-500/40 text-cyan-400 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Lock className="w-4 h-4 inline mr-2" />
                Answer to Unlock
              </button>
            </div>
          ) : (
            <div className={cn("rounded-lg bg-secondary/30 border border-border/30 text-center", compact ? "py-1.5 px-2" : "p-2")}>
              <p className="text-xs text-muted-foreground">Waiting for their answer...</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
