import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CharadesPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface CharadesGameProps {
  payload: CharadesPayload;
  isOwn: boolean;
  onGuess?: (guess: string) => void;
}

// Simple fuzzy match function
const fuzzyMatch = (guess: string, answer: string): boolean => {
  const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedGuess = normalize(guess);
  const normalizedAnswer = normalize(answer);
  
  // Exact match or contains
  if (normalizedGuess === normalizedAnswer || normalizedAnswer.includes(normalizedGuess)) {
    return true;
  }
  
  // Levenshtein distance check (allows small typos)
  const distance = levenshteinDistance(normalizedGuess, normalizedAnswer);
  return distance <= Math.floor(normalizedAnswer.length * 0.3);
};

const levenshteinDistance = (a: string, b: string): number => {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  
  return matrix[b.length][a.length];
};

export const CharadesGame = ({ payload, isOwn, onGuess }: CharadesGameProps) => {
  const [guess, setGuess] = useState("");
  const [isGuessed, setIsGuessed] = useState(payload.data.isGuessed || false);
  const [showWrong, setShowWrong] = useState(false);
  const { playFeedback } = useSoundEffects();

  const handleSubmit = useCallback(() => {
    if (!guess.trim() || isOwn || isGuessed) return;
    
    const correct = fuzzyMatch(guess, payload.data.answer);
    
    if (correct) {
      setIsGuessed(true);
      playFeedback('correct');
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.5 },
        colors: ['#8B5CF6', '#06B6D4', '#D946EF'],
        shapes: ['circle', 'star'],
      });
    } else {
      playFeedback('wrong');
      setShowWrong(true);
      setTimeout(() => setShowWrong(false), 1500);
    }
    
    onGuess?.(guess);
    setGuess("");
  }, [guess, isOwn, isGuessed, payload.data.answer, onGuess, playFeedback]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-[280px] rounded-2xl overflow-hidden",
        "bg-gradient-to-br from-purple-500/20 to-violet-600/20",
        "border border-purple-500/30 backdrop-blur-sm"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-purple-500/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">👻</span>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Emoji Charades</h4>
            <p className="text-xs text-muted-foreground">
              {isOwn ? "They're guessing..." : isGuessed ? "You got it!" : "Guess the movie/song!"}
            </p>
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
        ) : !isOwn && (
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
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
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
        )}
      </AnimatePresence>
    </motion.div>
  );
};
