import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RoulettePayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Lock, Eye } from "lucide-react";

interface RouletteGameProps {
  payload: RoulettePayload;
  isOwn: boolean;
  onAnswer?: (answer: string) => void;
}

export const RouletteGame = ({ payload, isOwn, onAnswer }: RouletteGameProps) => {
  const [myAnswer, setMyAnswer] = useState(payload.data.receiverAnswer || "");
  const [hasSubmitted, setHasSubmitted] = useState(!!payload.data.receiverAnswer);
  const isUnlocked = payload.data.isUnlocked;

  const handleSubmit = () => {
    if (!myAnswer.trim() || isOwn || hasSubmitted) return;
    setHasSubmitted(true);
    onAnswer?.(myAnswer);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-[280px] rounded-2xl overflow-hidden",
        "bg-gradient-to-br from-cyan-500/20 to-teal-600/20",
        "border border-cyan-500/30 backdrop-blur-sm"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-cyan-500/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎡</span>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Vibe Roulette</h4>
            <p className="text-xs text-muted-foreground">
              {isUnlocked ? "Answers revealed!" : "Answer to unlock"}
            </p>
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="p-4 border-b border-cyan-500/20">
        <p className="text-sm font-medium text-foreground text-center italic">
          "{payload.data.question}"
        </p>
      </div>

      {/* Answers */}
      <div className="p-3 space-y-3">
        {/* Sender's Answer */}
        <div className="relative">
          <div className={cn(
            "p-3 rounded-xl border",
            isUnlocked 
              ? "bg-neon-violet/10 border-neon-violet/30" 
              : "bg-secondary/50 border-border/50"
          )}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-neon-violet font-medium">
                {isOwn ? 'Your answer' : 'Their answer'}
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
          {isUnlocked && hasSubmitted ? (
            <div className="p-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-neon-cyan font-medium">
                  {isOwn ? 'Their answer' : 'Your answer'}
                </span>
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-foreground"
              >
                {payload.data.receiverAnswer || myAnswer}
              </motion.p>
            </div>
          ) : hasSubmitted ? (
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-center">
              <Eye className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
              <p className="text-xs text-cyan-400">Your answer submitted!</p>
              <p className="text-xs text-muted-foreground mt-1">Waiting for reveal...</p>
            </div>
          ) : !isOwn ? (
            <div className="space-y-2">
              <textarea
                value={myAnswer}
                onChange={(e) => setMyAnswer(e.target.value)}
                placeholder="Answer to reveal..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl text-sm bg-secondary/50 border border-border/50 focus:outline-none focus:border-cyan-500/50 resize-none placeholder:text-muted-foreground"
              />
              <button
                onClick={handleSubmit}
                disabled={!myAnswer.trim()}
                className="w-full py-2 rounded-xl bg-cyan-500/30 hover:bg-cyan-500/40 text-cyan-400 text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Lock className="w-4 h-4 inline mr-2" />
                Answer to Unlock
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30 text-center">
              <p className="text-xs text-muted-foreground">Waiting for their answer...</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
