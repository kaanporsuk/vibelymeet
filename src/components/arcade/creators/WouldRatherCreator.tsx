import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw } from "lucide-react";
import { WOULD_RATHER_OPTIONS } from "@/types/games";
import { cn } from "@/lib/utils";

interface WouldRatherCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (optionA: string, optionB: string, vote: 'A' | 'B') => void;
}

export const WouldRatherCreator = ({ isOpen, onClose, onSubmit }: WouldRatherCreatorProps) => {
  const [currentPair, setCurrentPair] = useState(() => 
    WOULD_RATHER_OPTIONS[Math.floor(Math.random() * WOULD_RATHER_OPTIONS.length)]
  );
  const [myVote, setMyVote] = useState<'A' | 'B' | null>(null);

  const shufflePair = () => {
    const newPair = WOULD_RATHER_OPTIONS[Math.floor(Math.random() * WOULD_RATHER_OPTIONS.length)];
    setCurrentPair(newPair);
    setMyVote(null);
  };

  const handleSubmit = () => {
    if (myVote) {
      onSubmit(currentPair.optionA, currentPair.optionB, myVote);
      setMyVote(null);
      shufflePair();
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
            <div className="glass-card rounded-2xl overflow-hidden border border-amber-500/30">
              {/* Header */}
              <div className="p-4 border-b border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚡</span>
                  <h3 className="font-semibold text-foreground">Would You Rather?</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={shufflePair}
                    className="p-2 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Pick your preference, then see if they match!
                </p>

                <div className="space-y-3">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setMyVote('A')}
                    className={cn(
                      "w-full p-4 rounded-xl text-left transition-all",
                      "border",
                      myVote === 'A' 
                        ? "bg-amber-500/20 border-amber-500/50" 
                        : "bg-secondary/50 border-border/50 hover:border-amber-500/30"
                    )}
                  >
                    <span className="font-medium text-foreground">{currentPair.optionA}</span>
                  </motion.button>

                  <div className="text-center text-muted-foreground text-sm">or</div>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setMyVote('B')}
                    className={cn(
                      "w-full p-4 rounded-xl text-left transition-all",
                      "border",
                      myVote === 'B' 
                        ? "bg-amber-500/20 border-amber-500/50" 
                        : "bg-secondary/50 border-border/50 hover:border-amber-500/30"
                    )}
                  >
                    <span className="font-medium text-foreground">{currentPair.optionB}</span>
                  </motion.button>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-amber-500/20">
                <button
                  onClick={handleSubmit}
                  disabled={!myVote}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold disabled:opacity-50 transition-opacity"
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
