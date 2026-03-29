import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CharadesPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { charadesGuessMatches } from "../../../../shared/vibely-games/reducer";

const EXPIRY_MS = 48 * 60 * 60 * 1000;

interface CharadesGameProps {
  payload: CharadesPayload;
  isOwn: boolean;
  sessionCreatedAt?: string | null;
  onGuess?: (guess: string) => void;
}

export const CharadesGame = ({ payload, isOwn, sessionCreatedAt, onGuess }: CharadesGameProps) => {
  const [guess, setGuess] = useState("");
  const [showWrong, setShowWrong] = useState(false);
  const { playFeedback } = useSoundEffects();
  const previousGuessCount = useRef(payload.data.guesses?.length || 0);

  const isGuessed = payload.data.isGuessed === true || payload.step === "completed";

  const createdMs = sessionCreatedAt ? new Date(sessionCreatedAt).getTime() : NaN;
  const isExpired =
    payload.step !== "completed" &&
    Number.isFinite(createdMs) &&
    Date.now() - createdMs > EXPIRY_MS;

  useEffect(() => {
    const currentCount = payload.data.guesses?.length || 0;
    if (currentCount !== previousGuessCount.current) {
      previousGuessCount.current = currentCount;
    }
  }, [payload.data.guesses?.length]);

  const handleSubmit = useCallback(() => {
    if (!guess.trim() || isOwn || isGuessed || isExpired) return;
    const trimmedGuess = guess.trim();

    onGuess?.(trimmedGuess);

    const localMatch = charadesGuessMatches(payload.data.answer, trimmedGuess);

    if (localMatch) {
      playFeedback("correct");
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.5 },
        colors: ["#8B5CF6", "#06B6D4", "#D946EF"],
        shapes: ["circle", "star"],
      });
    } else {
      playFeedback("wrong");
      setShowWrong(true);
      setTimeout(() => setShowWrong(false), 1500);
    }

    setGuess("");
  }, [guess, isOwn, isGuessed, isExpired, payload.data.answer, onGuess, playFeedback]);

  const headerSub =
    isExpired
      ? "This challenge expired"
      : isOwn
        ? "They're guessing..."
        : isGuessed
          ? "You got it!"
          : "Guess the movie/song!";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-full max-w-[280px] rounded-2xl overflow-hidden",
        "bg-gradient-to-br from-purple-500/20 to-violet-600/20",
        "border border-purple-500/30 backdrop-blur-sm",
        isExpired && "opacity-50"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">👻</span>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Emoji Charades</h4>
            <p className="text-xs text-muted-foreground">{headerSub}</p>
          </div>
        </div>
      </div>

      {/* Emoji Display */}
      <div className="p-6 flex justify-center items-center gap-3">
        {payload.data.emojis.map((emoji, index) => (
          <motion.span
            key={index}
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: index * 0.1, type: "spring" }}
            className="text-4xl"
          >
            {emoji}
          </motion.span>
        ))}
      </div>

      {/* Answer reveal or guess input */}
      <AnimatePresence mode="wait">
        {isGuessed ? (
          <motion.div
            key="answer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-3 pb-3"
          >
            <div className="p-3 rounded-xl bg-green-500/20 border border-green-500/30 text-center">
              <p className="text-xs text-green-400 mb-1">🎉 Correct!</p>
              <p className="font-semibold text-foreground">{payload.data.answer}</p>
            </div>
          </motion.div>
        ) : isExpired ? (
          <motion.div
            key="expired"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-3 pb-3"
          >
            <p className="text-sm text-muted-foreground text-center">This challenge expired</p>
          </motion.div>
        ) : !isOwn ? (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-3 pb-3"
          >
            <div className="relative">
              <input
                type="text"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Guess the movie..."
                className={cn(
                  "w-full px-4 py-2 rounded-xl text-sm",
                  "bg-secondary/50 border border-border/50",
                  "focus:outline-none focus:border-purple-500/50",
                  "placeholder:text-muted-foreground",
                  showWrong && "border-red-500/50 animate-shake"
                )}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!guess.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg bg-purple-500/30 text-purple-400 text-xs font-medium disabled:opacity-50"
              >
                Guess
              </button>
            </div>
            <AnimatePresence>
              {showWrong && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-red-400 mt-1 text-center"
                >
                  Not quite... try again!
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
};
