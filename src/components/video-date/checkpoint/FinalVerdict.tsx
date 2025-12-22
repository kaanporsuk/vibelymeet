import { motion } from "framer-motion";
import { X, Heart, Unlock } from "lucide-react";

interface FinalVerdictProps {
  partnerName: string;
  dateDuration: number;
  onVerdict: (verdict: "pass" | "vibe") => void;
}

export const FinalVerdict = ({
  partnerName,
  dateDuration,
  onVerdict,
}: FinalVerdictProps) => {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins} minute${mins !== 1 ? "s" : ""}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      {/* Header */}
      <div className="text-center">
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xl font-display font-bold gradient-text mb-2"
        >
          The Final Vibe Check
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-sm text-muted-foreground"
        >
          You shared {formatDuration(dateDuration)}. Do you want to unlock the Messaging Hub?
        </motion.p>
      </div>

      {/* Unlock Preview */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex justify-center"
      >
        <motion.div
          className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center border border-primary/30"
          animate={{
            boxShadow: [
              "0 0 20px hsl(var(--primary) / 0.3)",
              "0 0 40px hsl(var(--primary) / 0.5)",
              "0 0 20px hsl(var(--primary) / 0.3)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Unlock className="w-10 h-10 text-primary" />
        </motion.div>
      </motion.div>

      {/* Decision Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-3"
      >
        {/* Pass Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onVerdict("pass")}
          className="w-full py-4 px-6 rounded-xl bg-secondary/30 border border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all flex items-center justify-center gap-3"
        >
          <X className="w-5 h-5" />
          <span className="font-medium">Not a Vibe</span>
        </motion.button>

        {/* Vibe Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onVerdict("vibe")}
          className="relative w-full py-5 px-6 rounded-xl font-semibold text-lg overflow-hidden group"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
          }}
        >
          {/* Animated Glow */}
          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary) / 0.5), hsl(var(--accent) / 0.5))",
              filter: "blur(20px)",
            }}
          />
          
          {/* Pulsing Shadow */}
          <motion.div
            className="absolute inset-0 rounded-xl"
            animate={{
              boxShadow: [
                "0 0 20px hsl(var(--primary) / 0.4), 0 0 40px hsl(var(--accent) / 0.2)",
                "0 0 40px hsl(var(--primary) / 0.6), 0 0 80px hsl(var(--accent) / 0.4)",
                "0 0 20px hsl(var(--primary) / 0.4), 0 0 40px hsl(var(--accent) / 0.2)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />

          <div className="relative flex items-center justify-center gap-3 text-primary-foreground">
            <Heart className="w-6 h-6 fill-current" />
            <span>It's a Vibe Fit</span>
          </div>
        </motion.button>
      </motion.div>

      {/* Disclaimer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-xs text-muted-foreground"
      >
        Your choice is private. They'll only know if you both vibe.
      </motion.p>
    </motion.div>
  );
};
