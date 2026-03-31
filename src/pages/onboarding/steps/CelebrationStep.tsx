import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, PartyPopper, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CelebrationStepProps {
  submitting: boolean;
  completed: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  vibeScore: number;
  vibeScoreLabel: string;
  onExploreEvents: () => void;
  onDashboard: () => void;
}

function ConfettiParticle({ delay }: { delay: number }) {
  const colors = ["#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#3B82F6"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const x = Math.random() * 100;
  const duration = 2 + Math.random() * 2;

  return (
    <motion.div
      className="absolute w-2 h-2 rounded-sm"
      style={{ backgroundColor: color, left: `${x}%`, top: 0 }}
      initial={{ y: -10, opacity: 1, rotate: 0 }}
      animate={{
        y: "100vh",
        opacity: [1, 1, 0],
        rotate: Math.random() * 720 - 360,
        x: (Math.random() - 0.5) * 200,
      }}
      transition={{ duration, delay, ease: "easeIn" }}
    />
  );
}

export const CelebrationStep = ({
  submitting,
  completed,
  errorMessage,
  onRetry,
  vibeScore,
  vibeScoreLabel,
  onExploreEvents,
  onDashboard,
}: CelebrationStepProps) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiShown = useRef(false);

  useEffect(() => {
    if (completed && !confettiShown.current) {
      confettiShown.current = true;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    }
  }, [completed]);

  if (submitting) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 pt-24 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <h2 className="text-2xl font-display font-bold text-foreground">
          Finishing your profile...
        </h2>
        <p className="text-muted-foreground">One sec while we lock it in.</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 pt-24 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <RotateCw className="w-7 h-7 text-destructive" />
        </div>
        <h2 className="text-2xl font-display font-bold text-foreground">
          Couldn't save your profile
        </h2>
        <p className="text-muted-foreground text-sm max-w-xs">{errorMessage}</p>
        <Button onClick={onRetry} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 pt-12 text-center relative">
      {/* Confetti */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
          {Array.from({ length: 40 }).map((_, i) => (
            <ConfettiParticle key={i} delay={i * 0.05} />
          ))}
        </div>
      )}

      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
      >
        <span className="text-6xl">🎉</span>
      </motion.div>

      <motion.h1
        className="text-4xl font-display font-bold text-foreground"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        You're in!
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="space-y-2"
      >
        {/* Vibe Score ring */}
        <div className="relative w-28 h-28 mx-auto">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="42"
              fill="none" stroke="currentColor" strokeWidth="6"
              className="text-secondary"
            />
            <motion.circle
              cx="50" cy="50" r="42"
              fill="none" strokeWidth="6" strokeLinecap="round"
              className="text-primary"
              strokeDasharray={264}
              initial={{ strokeDashoffset: 264 }}
              animate={{ strokeDashoffset: 264 - (vibeScore / 100) * 264 }}
              transition={{ duration: 1.5, delay: 0.6, ease: "easeOut" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.span
              className="text-2xl font-bold text-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
            >
              {vibeScore}
            </motion.span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Your Vibe Score · <span className="text-primary font-medium">{vibeScoreLabel}</span>
        </p>
      </motion.div>

      <motion.div
        className="w-full space-y-3 mt-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        <Button
          onClick={onExploreEvents}
          className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
        >
          <PartyPopper className="w-4 h-4 mr-2" />
          Explore events
        </Button>
        <button
          onClick={onDashboard}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-center"
        >
          Go to dashboard
        </button>
      </motion.div>
    </div>
  );
};
