import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WouldRatherPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Zap } from "lucide-react";

interface WouldRatherGameProps {
  payload: WouldRatherPayload;
  isOwn: boolean;
  onVote?: (choice: 'A' | 'B') => void;
}

export const WouldRatherGame = ({ payload, isOwn, onVote }: WouldRatherGameProps) => {
  const [myVote, setMyVote] = useState<'A' | 'B' | null>(
    isOwn ? payload.data.senderVote || null : payload.data.receiverVote || null
  );
  
  const bothVoted = payload.data.senderVote && payload.data.receiverVote;
  const isMatch = payload.data.isMatch;

  const handleVote = (choice: 'A' | 'B') => {
    if (myVote) return;
    setMyVote(choice);
    onVote?.(choice);
  };

  const getOptionState = (option: 'A' | 'B') => {
    if (!myVote) return 'voting';
    if (bothVoted) {
      if (isMatch && payload.data.senderVote === option) return 'match';
      if (payload.data.senderVote === option && payload.data.receiverVote === option) return 'match';
      if (payload.data.senderVote === option) return 'sender';
      if (payload.data.receiverVote === option) return 'receiver';
    }
    if (myVote === option) return 'selected';
    return 'default';
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-[280px] rounded-2xl overflow-hidden",
        "border backdrop-blur-sm",
        isMatch ? "bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border-amber-500/50" : "bg-gradient-to-br from-amber-500/10 to-orange-600/10 border-amber-500/30"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-amber-500/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Would You Rather?</h4>
            <p className="text-xs text-muted-foreground">
              {!myVote ? "Pick one!" : bothVoted ? "Results are in!" : "Waiting for their vote..."}
            </p>
          </div>
        </div>
      </div>

      {/* Split Card */}
      <div className="relative flex">
        {/* Option A */}
        <motion.button
          whileTap={!myVote ? { scale: 0.98 } : undefined}
          onClick={() => handleVote('A')}
          disabled={!!myVote}
          className={cn(
            "flex-1 p-4 text-center transition-all duration-300 border-r border-amber-500/20",
            getOptionState('A') === 'voting' && "hover:bg-amber-500/10",
            getOptionState('A') === 'selected' && "bg-amber-500/20",
            getOptionState('A') === 'match' && "bg-amber-500/30",
            getOptionState('A') === 'sender' && "bg-neon-violet/20",
            getOptionState('A') === 'receiver' && "bg-neon-cyan/20"
          )}
        >
          <p className="text-sm font-medium text-foreground mb-2">{payload.data.optionA}</p>
          <AnimatePresence>
            {bothVoted && payload.data.senderVote === 'A' && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-violet/30 text-neon-violet"
              >
                {isOwn ? 'You' : 'Them'}
              </motion.div>
            )}
            {bothVoted && payload.data.receiverVote === 'A' && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-cyan/30 text-neon-cyan ml-1"
              >
                {isOwn ? 'Them' : 'You'}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Lightning Divider */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="w-8 h-8 rounded-full bg-background border border-amber-500/50 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
        </div>

        {/* Option B */}
        <motion.button
          whileTap={!myVote ? { scale: 0.98 } : undefined}
          onClick={() => handleVote('B')}
          disabled={!!myVote}
          className={cn(
            "flex-1 p-4 text-center transition-all duration-300",
            getOptionState('B') === 'voting' && "hover:bg-amber-500/10",
            getOptionState('B') === 'selected' && "bg-amber-500/20",
            getOptionState('B') === 'match' && "bg-amber-500/30",
            getOptionState('B') === 'sender' && "bg-neon-violet/20",
            getOptionState('B') === 'receiver' && "bg-neon-cyan/20"
          )}
        >
          <p className="text-sm font-medium text-foreground mb-2">{payload.data.optionB}</p>
          <AnimatePresence>
            {bothVoted && payload.data.senderVote === 'B' && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-violet/30 text-neon-violet"
              >
                {isOwn ? 'You' : 'Them'}
              </motion.div>
            )}
            {bothVoted && payload.data.receiverVote === 'B' && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="inline-block text-xs px-2 py-0.5 rounded-full bg-neon-cyan/30 text-neon-cyan ml-1"
              >
                {isOwn ? 'Them' : 'You'}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Match Banner */}
      <AnimatePresence>
        {isMatch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-gradient-to-r from-amber-500/30 to-yellow-500/30 p-2 text-center"
          >
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="text-amber-400 font-semibold text-sm"
            >
              ⭐ It's a Match! ⭐
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
