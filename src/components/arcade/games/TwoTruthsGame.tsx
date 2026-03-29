import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TwoTruthsPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface TwoTruthsGameProps {
  payload: TwoTruthsPayload;
  isOwn: boolean;
  onGuess?: (index: number) => void;
}

export const TwoTruthsGame = ({ payload, isOwn, onGuess }: TwoTruthsGameProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(payload.data.guessedIndex ?? null);
  const isCompleted = payload.step === 'completed';
  const { playFeedback } = useSoundEffects();

  const handleGuess = (index: number) => {
    if (isOwn || isCompleted || selectedIndex !== null) return;
    
    setSelectedIndex(index);
    const correct = index === payload.data.lieIndex;
    
    if (correct) {
      playFeedback('correct');
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#8B5CF6', '#06B6D4', '#D946EF'],
      });
    } else {
      playFeedback('wrong');
    }
    
    onGuess?.(index);
  };

  const getButtonState = (index: number) => {
    if (!isCompleted && selectedIndex === null) return 'default';
    if (index === payload.data.lieIndex) return 'lie';
    if (selectedIndex === index && index !== payload.data.lieIndex) return 'wrong';
    return 'truth';
  };

  const compact = isCompleted || selectedIndex !== null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full max-w-[280px] rounded-2xl overflow-hidden",
        "bg-gradient-to-br from-pink-500/20 to-rose-600/20",
        "border border-pink-500/30 backdrop-blur-sm"
      )}
    >
      {/* Header */}
      <div className={cn("border-b border-pink-500/20", compact ? "px-2.5 py-2" : "p-3")}>
        <div className="flex items-center gap-2">
          <span className={compact ? "text-lg" : "text-2xl"}>🎭</span>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-foreground leading-tight">Two Truths & A Lie</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {isOwn ? "They're guessing..." : "Can you spot the lie?"}
            </p>
          </div>
        </div>
      </div>

      {/* Statements */}
      <div className={cn(compact ? "px-2.5 py-2 space-y-1.5" : "p-3 space-y-2")}>
        {payload.data.statements.map((statement, index) => {
          const state = getButtonState(index);
          
          return (
            <motion.button
              key={index}
              whileTap={!isOwn && !isCompleted ? { scale: 0.98 } : undefined}
              onClick={() => handleGuess(index)}
              disabled={isOwn || isCompleted || selectedIndex !== null}
              className={cn(
                "w-full text-left text-sm transition-all duration-300",
                "border",
                compact ? "p-2 rounded-lg" : "p-3 rounded-xl",
                state === 'default' && "bg-secondary/50 border-border/50 hover:border-pink-500/50 hover:bg-pink-500/10",
                state === 'lie' && "bg-green-500/20 border-green-500/50 text-green-400",
                state === 'wrong' && "bg-red-500/20 border-red-500/50 text-red-400",
                state === 'truth' && "bg-secondary/30 border-border/30 text-muted-foreground"
              )}
            >
              <AnimatePresence mode="wait">
                {state === 'lie' && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="inline-block mr-2"
                  >
                    ✓
                  </motion.span>
                )}
                {state === 'wrong' && (
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
        {(isCompleted || selectedIndex !== null) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className={compact ? "px-2.5 pb-2" : "px-3 pb-3"}
          >
            <div className={cn(
              "p-2 rounded-lg text-center text-xs font-medium",
              selectedIndex === payload.data.lieIndex
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            )}>
              {selectedIndex === payload.data.lieIndex ? "🎉 You got me!" : "Nice try! 😅"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
