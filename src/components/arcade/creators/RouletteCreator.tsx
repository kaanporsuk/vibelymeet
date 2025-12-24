import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw } from "lucide-react";
import { ROULETTE_QUESTIONS } from "@/types/games";
import { cn } from "@/lib/utils";

interface RouletteCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (question: string, answer: string) => void;
}

export const RouletteCreator = ({ isOpen, onClose, onSubmit }: RouletteCreatorProps) => {
  const [question, setQuestion] = useState(() => 
    ROULETTE_QUESTIONS[Math.floor(Math.random() * ROULETTE_QUESTIONS.length)]
  );
  const [answer, setAnswer] = useState("");
  const [isSpinning, setIsSpinning] = useState(false);

  const spinQuestion = () => {
    setIsSpinning(true);
    let spins = 0;
    const interval = setInterval(() => {
      setQuestion(ROULETTE_QUESTIONS[Math.floor(Math.random() * ROULETTE_QUESTIONS.length)]);
      spins++;
      if (spins >= 8) {
        clearInterval(interval);
        setIsSpinning(false);
      }
    }, 120);
  };

  const handleSubmit = () => {
    if (answer.trim()) {
      onSubmit(question, answer);
      setAnswer("");
      spinQuestion();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md"
          >
            <div className="glass-card rounded-2xl overflow-hidden border border-cyan-500/30">
              {/* Header */}
              <div className="p-4 border-b border-cyan-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎡</span>
                  <h3 className="font-semibold text-foreground">Vibe Roulette</h3>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Answer the deep question. They'll have to answer to see yours!
                </p>

                {/* Question Display */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 border border-cyan-500/30">
                  <motion.p
                    key={question}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-medium text-foreground text-center italic"
                  >
                    "{question}"
                  </motion.p>
                </div>

                {/* Spin Button */}
                <button
                  onClick={spinQuestion}
                  disabled={isSpinning}
                  className="w-full py-2 rounded-xl bg-secondary hover:bg-secondary/80 flex items-center justify-center gap-2 transition-colors"
                >
                  <motion.div
                    animate={{ rotate: isSpinning ? 360 : 0 }}
                    transition={{ duration: 0.5, repeat: isSpinning ? Infinity : 0 }}
                  >
                    <RefreshCw className="w-4 h-4 text-cyan-400" />
                  </motion.div>
                  <span className="text-sm text-muted-foreground">
                    {isSpinning ? "Spinning..." : "Different question"}
                  </span>
                </button>

                {/* Answer Input */}
                <div>
                  <label className="text-sm text-muted-foreground block mb-2">
                    Your answer (will be hidden until they respond):
                  </label>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Be honest and vulnerable..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl text-sm bg-secondary/50 border border-border/50 focus:outline-none focus:border-cyan-500/50 resize-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-cyan-500/20">
                <button
                  onClick={handleSubmit}
                  disabled={!answer.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold disabled:opacity-50 transition-opacity"
                >
                  Send Challenge
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
