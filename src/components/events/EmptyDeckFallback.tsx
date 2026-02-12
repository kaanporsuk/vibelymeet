import { motion } from "framer-motion";
import { Sparkles, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyDeckFallbackProps {
  onMysteryMatch: () => void;
  onWait: () => void;
  isSearching: boolean;
  isWaiting: boolean;
}

export const EmptyDeckFallback = ({
  onMysteryMatch,
  onWait,
  isSearching,
  isWaiting,
}: EmptyDeckFallbackProps) => {
  if (isWaiting) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card p-8 rounded-3xl text-center space-y-4 max-w-sm mx-auto"
      >
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 3, repeat: Infinity }}
          className="text-5xl"
        >
          ⏳
        </motion.div>
        <h3 className="text-lg font-display font-bold text-foreground">
          Hang tight!
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          New people may join the event! We'll refresh your deck automatically.
        </p>
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex items-center justify-center gap-2 text-xs text-primary"
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking for new arrivals...
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card p-8 rounded-3xl text-center space-y-5 max-w-sm mx-auto"
    >
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="text-5xl"
      >
        🎉
      </motion.div>

      <div className="space-y-2">
        <h3 className="text-lg font-display font-bold text-foreground">
          You've seen everyone!
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Feeling adventurous? Try a Mystery Match — a random 60-second date with
          someone compatible.
        </p>
      </div>

      <Button
        onClick={onMysteryMatch}
        disabled={isSearching}
        className="w-full bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold rounded-2xl h-12"
      >
        {isSearching ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Finding match...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            I'm feeling adventurous ✨
          </>
        )}
      </Button>

      <button
        onClick={onWait}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Clock className="w-3 h-3 inline mr-1" />
        No thanks, I'll wait
      </button>
    </motion.div>
  );
};
