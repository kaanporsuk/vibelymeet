import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

interface WizardProgressRingProps {
  progress: number;
  isComplete: boolean;
}

const WizardProgressRing = ({ progress, isComplete }: WizardProgressRingProps) => {
  const size = 120;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  // Color gradient based on progress
  const getGradientId = () => {
    if (isComplete) return "gold-gradient";
    if (progress >= 75) return "pink-gradient";
    if (progress >= 50) return "violet-gradient";
    return "cyan-gradient";
  };

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="cyan-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(187, 94%, 43%)" />
            <stop offset="100%" stopColor="hsl(263, 70%, 66%)" />
          </linearGradient>
          <linearGradient id="violet-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(263, 70%, 66%)" />
            <stop offset="100%" stopColor="hsl(330, 81%, 60%)" />
          </linearGradient>
          <linearGradient id="pink-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(330, 81%, 60%)" />
            <stop offset="100%" stopColor="hsl(263, 70%, 66%)" />
          </linearGradient>
          <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(45, 93%, 47%)" />
            <stop offset="100%" stopColor="hsl(36, 100%, 50%)" />
          </linearGradient>
        </defs>

        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={strokeWidth}
        />

        {/* Progress ring */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${getGradientId()})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{
            filter: isComplete ? "drop-shadow(0 0 10px hsl(45, 93%, 47%))" : "drop-shadow(0 0 8px hsl(263, 70%, 66%))",
          }}
        />
      </svg>

      {/* Center content */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center"
        animate={isComplete ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 0.5 }}
      >
        {isComplete ? (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200 }}
          >
            <Sparkles className="w-8 h-8 text-yellow-400" />
          </motion.div>
        ) : (
          <>
            <motion.span
              key={progress}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-3xl font-bold text-foreground"
            >
              {progress}%
            </motion.span>
            <span className="text-xs text-muted-foreground">Complete</span>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default WizardProgressRing;
