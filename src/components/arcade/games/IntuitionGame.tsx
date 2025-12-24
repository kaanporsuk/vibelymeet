import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IntuitionPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import confetti from "canvas-confetti";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface IntuitionGameProps {
  payload: IntuitionPayload;
  isOwn: boolean;
  matchName?: string;
  onRespond?: (response: 'correct' | 'wrong') => void;
}

export const IntuitionGame = ({ payload, isOwn, matchName = "They", onRespond }: IntuitionGameProps) => {
  const [response, setResponse] = useState<'correct' | 'wrong' | null>(payload.data.receiverResponse || null);
  const prediction = payload.data.options[payload.data.senderChoice];
  const { playFeedback } = useSoundEffects();

  const handleRespond = (res: 'correct' | 'wrong') => {
    setResponse(res);
    
    if (res === 'correct') {
      playFeedback('correct');
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#8B5CF6', '#06B6D4', '#FFD700'],
      });
    } else {
      playFeedback('wrong');
    }
    
    onRespond?.(res);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-[280px] rounded-2xl overflow-hidden",
        "bg-gradient-to-br from-indigo-500/20 to-blue-600/20",
        "border border-indigo-500/30 backdrop-blur-sm"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-indigo-500/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔮</span>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Intuition Test</h4>
            <p className="text-xs text-muted-foreground">
              {response ? (response === 'correct' ? 'Mind reader!' : 'Not quite...') : 'Are they right?'}
            </p>
          </div>
        </div>
      </div>

      {/* Prediction */}
      <div className="p-4 text-center">
        <p className="text-xs text-muted-foreground mb-2">
          {isOwn ? 'You think they prefer...' : `${matchName} thinks you prefer...`}
        </p>
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          className={cn(
            "inline-block px-6 py-3 rounded-xl",
            "bg-gradient-to-r from-indigo-500/30 to-blue-500/30",
            "border border-indigo-500/50"
          )}
        >
          <p className="font-semibold text-lg text-foreground">{prediction}</p>
        </motion.div>
        <p className="text-xs text-muted-foreground mt-2">
          (vs. {payload.data.options[payload.data.senderChoice === 0 ? 1 : 0]})
        </p>
      </div>

      {/* Response Section */}
      <AnimatePresence mode="wait">
        {response ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="px-3 pb-3"
          >
            <div className={cn(
              "p-3 rounded-xl text-center",
              response === 'correct' 
                ? "bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/50" 
                : "bg-red-500/20 border border-red-500/30"
            )}>
              {response === 'correct' ? (
                <div className="flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="font-semibold text-amber-400">Mind Reader!</span>
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
              ) : (
                <p className="text-sm text-red-400">Wrong guess! 😅</p>
              )}
            </div>
          </motion.div>
        ) : !isOwn ? (
          <motion.div
            key="buttons"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-3 flex gap-2"
          >
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRespond('correct')}
              className="flex-1 py-3 rounded-xl bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-medium text-sm transition-colors"
            >
              ✅ Correct!
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleRespond('wrong')}
              className="flex-1 py-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-medium text-sm transition-colors"
            >
              ❌ Wrong!
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-3 pb-3"
          >
            <div className="p-3 rounded-xl bg-secondary/30 text-center">
              <p className="text-xs text-muted-foreground">Waiting for their response...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
