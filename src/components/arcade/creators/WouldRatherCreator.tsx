import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { WOULD_RATHER_OPTIONS } from "@/types/games";
import { cn } from "@/lib/utils";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";

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
    <ArcadeCreatorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Would You Rather?"
      icon="⚡"
      accentClassName="border-amber-500/30"
      contentClassName="space-y-4"
      headerAction={
        <button
          type="button"
          onClick={shufflePair}
          aria-label="Shuffle would you rather options"
          className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      }
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!myVote}
          className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          Send Challenge
        </button>
      }
    >
      <p className="text-center text-sm text-muted-foreground">
        Pick your preference, then see if they match!
      </p>

      <div className="space-y-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => setMyVote('A')}
          aria-pressed={myVote === 'A'}
          className={cn(
            "w-full rounded-xl border p-4 text-left transition-all",
            myVote === 'A'
              ? "border-amber-500/50 bg-amber-500/20"
              : "border-border/50 bg-secondary/50 hover:border-amber-500/30",
          )}
        >
          <span className="font-medium text-foreground">{currentPair.optionA}</span>
        </motion.button>

        <div className="text-center text-sm text-muted-foreground">or</div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => setMyVote('B')}
          aria-pressed={myVote === 'B'}
          className={cn(
            "w-full rounded-xl border p-4 text-left transition-all",
            myVote === 'B'
              ? "border-amber-500/50 bg-amber-500/20"
              : "border-border/50 bg-secondary/50 hover:border-amber-500/30",
          )}
        >
          <span className="font-medium text-foreground">{currentPair.optionB}</span>
        </motion.button>
      </div>
    </ArcadeCreatorShell>
  );
};
