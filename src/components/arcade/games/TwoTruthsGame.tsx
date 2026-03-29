import { motion, AnimatePresence } from "framer-motion";
import { TwoTruthsPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const EXPIRY_MS = 48 * 60 * 60 * 1000;

interface TwoTruthsGameProps {
  payload: TwoTruthsPayload;
  isOwn: boolean;
  sessionCreatedAt?: string | null;
  onGuess?: (index: number) => void;
}

export const TwoTruthsGame = ({
  payload,
  isOwn,
  sessionCreatedAt,
  onGuess,
}: TwoTruthsGameProps) => {
  const guessedIndex = payload.data.guessedIndex ?? null;
  const hasGuess = guessedIndex !== null;
  const isCompleted = payload.step === "completed";
  const { playFeedback } = useSoundEffects();

  const createdMs = sessionCreatedAt ? new Date(sessionCreatedAt).getTime() : NaN;
  const isExpired =
    payload.step !== "completed" &&
    Number.isFinite(createdMs) &&
    Date.now() - createdMs > EXPIRY_MS;

  const handleGuess = (index: number) => {
    if (isOwn || isCompleted || hasGuess || isExpired) return;

    const correct = index === payload.data.lieIndex;

    if (correct) {
      playFeedback("correct");
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#8B5CF6", "#06B6D4", "#D946EF"],
      });
    } else {
      playFeedback("wrong");
    }

    onGuess?.(index);
  };

  const getButtonState = (index: number) => {
    if (isExpired) return "default";
    if (!isCompleted && !hasGuess) return "default";
    if (index === payload.data.lieIndex) return "lie";
    if (guessedIndex === index && index !== payload.data.lieIndex) return "wrong";
    return "truth";
  };

  const showReveal = !isExpired && (isCompleted || hasGuess);
  const compact = showReveal || isExpired;

  const headerSub = isExpired
    ? "This challenge expired"
    : isOwn
      ? "They're guessing..."
      : "Can you spot the lie?";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full max-w-[min(100%,252px)] rounded-xl overflow-hidden",
        "bg-gradient-to-br from-pink-500/20 to-rose-600/20",
        "border border-pink-500/30 backdrop-blur-sm",
        isExpired && "opacity-50"
      )}
    >
      {/* Header */}
      <div className={cn("border-b border-pink-500/20", compact ? "px-2 py-1.5" : "px-2.5 py-2")}>
        <div className="flex items-center gap-1.5">
          <span className={compact ? "text-base" : "text-xl"}>🎭</span>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-foreground leading-tight">Two Truths & A Lie</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">{headerSub}</p>
          </div>
        </div>
      </div>

      {/* Statements */}
      <div className={cn(compact ? "px-2 py-1.5 space-y-1" : "px-2.5 py-2 space-y-1.5")}>
        {payload.data.statements.map((statement, index) => {
          const state = getButtonState(index);

          return (
            <motion.button
              key={index}
              whileTap={!isOwn && !isCompleted && !hasGuess && !isExpired ? { scale: 0.98 } : undefined}
              onClick={() => handleGuess(index)}
              disabled={isOwn || isCompleted || hasGuess || isExpired}
              className={cn(
                "w-full text-left text-sm transition-all duration-300",
                "border",
                compact ? "py-1.5 px-2 rounded-lg" : "p-2.5 rounded-xl",
                state === "default" && "bg-secondary/50 border-border/50 hover:border-pink-500/50 hover:bg-pink-500/10",
                state === "lie" && "bg-green-500/20 border-green-500/50 text-green-400",
                state === "wrong" && "bg-red-500/20 border-red-500/50 text-red-400",
                state === "truth" && "bg-secondary/30 border-border/30 text-muted-foreground"
              )}
            >
              <AnimatePresence mode="wait">
                {state === "lie" && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="inline-block mr-2"
                  >
                    ✓
                  </motion.span>
                )}
                {state === "wrong" && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="inline-block mr-2"
                  >
                    ✗
                  </motion.span>
                )}
              </AnimatePresence>
              {statement}
            </motion.button>
          );
        })}
      </div>

      {/* Result message */}
      <AnimatePresence>
        {showReveal && guessedIndex !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className={compact ? "px-2 pb-1.5" : "px-2.5 pb-2"}
          >
            <div
              className={cn(
                "py-1.5 px-2 rounded-md text-center text-[11px] font-medium leading-tight",
                guessedIndex === payload.data.lieIndex
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              )}
            >
              {guessedIndex === payload.data.lieIndex ? "🎉 You got me!" : "Nice try! 😅"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
