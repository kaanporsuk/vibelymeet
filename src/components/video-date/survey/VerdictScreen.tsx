import { motion } from "framer-motion";
import { Heart, X, AlertTriangle } from "lucide-react";
import { haptics } from "@/lib/haptics";

interface VerdictScreenProps {
  partnerName: string;
  partnerImage: string;
  onVerdict: (liked: boolean) => void;
  onReport: () => void;
}

export const VerdictScreen = ({
  partnerName,
  partnerImage,
  onVerdict,
  onReport,
}: VerdictScreenProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex flex-col items-center space-y-8 py-4"
    >
      {/* Partner Photo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
        className="relative"
      >
        <img
          src={partnerImage}
          alt={partnerName}
          className="w-24 h-24 rounded-full object-cover border-4 border-primary/40"
        />
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            boxShadow: [
              "0 0 15px hsl(var(--primary) / 0.3)",
              "0 0 30px hsl(var(--primary) / 0.5)",
              "0 0 15px hsl(var(--primary) / 0.3)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.div>

      {/* Title */}
      <div className="text-center">
        <h2 className="text-xl font-display font-bold text-foreground mb-1">
          How was your date with {partnerName}?
        </h2>
      </div>

      {/* Buttons */}
      <div className="w-full space-y-3">
        {/* Vibe Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => { haptics.light(); onVerdict(true); }}
          className="relative w-full py-5 px-6 rounded-xl font-semibold text-lg overflow-hidden group"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
          }}
        >
          <motion.div
            className="absolute inset-0 rounded-xl"
            animate={{
              boxShadow: [
                "0 0 20px hsl(var(--primary) / 0.4)",
                "0 0 40px hsl(var(--primary) / 0.6)",
                "0 0 20px hsl(var(--primary) / 0.4)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <div className="relative flex items-center justify-center gap-3 text-primary-foreground">
            <Heart className="w-6 h-6 fill-current" />
            <span>Vibe 💜</span>
          </div>
        </motion.button>

        {/* Pass Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onVerdict(false)}
          className="w-full py-4 px-6 rounded-xl bg-secondary/30 border border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all flex items-center justify-center gap-3"
        >
          <X className="w-5 h-5" />
          <span className="font-medium">Pass</span>
        </motion.button>
      </div>

      {/* Report link */}
      <button
        onClick={onReport}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Report an issue</span>
      </button>
    </motion.div>
  );
};
