import { motion } from "framer-motion";

interface VibeScoreProps {
  score: number;
  size?: number;
}

export const VibeScore = ({ score, size = 120 }: VibeScoreProps) => {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Iconic";
    if (score >= 75) return "Fire";
    if (score >= 50) return "Rising";
    if (score >= 25) return "Warming Up";
    return "Ghost Mode";
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return "stroke-neon-pink";
    if (score >= 50) return "stroke-neon-violet";
    return "stroke-neon-cyan";
  };

  return (
    <div className="relative flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Background circle */}
        <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            className="fill-none stroke-secondary"
          />
        </svg>
        
        {/* Progress circle */}
        <svg className="absolute inset-0 -rotate-90" width={size} height={size}>
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            className={`fill-none ${getScoreColor(score)}`}
            strokeLinecap="round"
            style={{
              strokeDasharray: circumference,
              filter: "drop-shadow(0 0 8px currentColor)",
            }}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>

        {/* Score text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span 
            className="text-2xl font-display font-bold gradient-text"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
          >
            {score}%
          </motion.span>
        </div>
      </div>
      
      <motion.span 
        className="text-sm font-medium text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        {getScoreLabel(score)}
      </motion.span>
    </div>
  );
};
