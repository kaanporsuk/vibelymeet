import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface MutualVibeToastProps {
  onComplete: () => void;
}

export const MutualVibeToast = ({ onComplete }: MutualVibeToastProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -20 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      onAnimationComplete={() => {
        setTimeout(onComplete, 2200);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
    >
      <div className="relative">
        {/* Glow ring */}
        <motion.div
          className="absolute inset-0 rounded-3xl"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 0.6, 0],
            scale: [1, 1.5, 1.8],
          }}
          transition={{ duration: 1.5 }}
          style={{
            boxShadow: "0 0 80px hsl(var(--primary) / 0.6)",
          }}
        />

        {/* Card */}
        <motion.div
          className="glass-card px-8 py-6 text-center neon-glow-violet"
          animate={{
            boxShadow: [
              "0 0 20px hsl(var(--primary) / 0.4), inset 0 0 20px hsl(var(--primary) / 0.1)",
              "0 0 40px hsl(var(--primary) / 0.6), inset 0 0 30px hsl(var(--primary) / 0.2)",
              "0 0 20px hsl(var(--primary) / 0.4), inset 0 0 20px hsl(var(--primary) / 0.1)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <Sparkles className="w-10 h-10 text-primary mx-auto mb-3" />
          </motion.div>
          <h2 className="text-xl font-display font-bold text-foreground mb-1">
            You both vibed! 💚
          </h2>
          <p className="text-sm text-muted-foreground">
            Enjoy your date — 5 minutes on the clock
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
};
