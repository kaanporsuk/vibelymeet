import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface VibeProgressRingProps {
  timeLeft: number;
  totalTime: number;
}

export const VibeProgressRing = ({ timeLeft, totalTime }: VibeProgressRingProps) => {
  const [isUrgent, setIsUrgent] = useState(false);
  
  const progress = timeLeft / totalTime;
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference * (1 - progress);
  
  // Calculate color based on progress
  const getGradientColors = () => {
    if (timeLeft <= 10) {
      return { start: "#EC4899", end: "#EF4444" }; // Pink to Red - urgent
    }
    if (timeLeft <= 30) {
      return { start: "#EC4899", end: "#F472B6" }; // Hot Pink
    }
    if (progress <= 0.5) {
      return { start: "#8B5CF6", end: "#EC4899" }; // Violet to Pink
    }
    return { start: "#06B6D4", end: "#8B5CF6" }; // Cyan to Violet
  };

  const colors = getGradientColors();

  useEffect(() => {
    setIsUrgent(timeLeft <= 10);
  }, [timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <motion.div 
      className="relative"
      animate={isUrgent ? { 
        scale: [1, 1.05, 1],
      } : {}}
      transition={isUrgent ? { 
        duration: 0.5, 
        repeat: Infinity,
        ease: "easeInOut"
      } : {}}
    >
      <svg width="100" height="100" viewBox="0 0 100 100" className="transform -rotate-90">
        <defs>
          <linearGradient id="vibeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.start} />
            <stop offset="100%" stopColor={colors.end} />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        {/* Background ring */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="6"
          opacity="0.3"
        />
        
        {/* Progress ring */}
        <motion.circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="url(#vibeGradient)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          filter="url(#glow)"
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </svg>
      
      {/* Timer text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span 
          className={`text-2xl font-display font-bold ${
            isUrgent ? 'text-accent' : 'text-foreground'
          }`}
          animate={isUrgent ? { 
            color: ["hsl(var(--accent))", "hsl(var(--destructive))", "hsl(var(--accent))"]
          } : {}}
          transition={isUrgent ? { duration: 0.5, repeat: Infinity } : {}}
        >
          {formatTime(timeLeft)}
        </motion.span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {isUrgent ? "Last chance!" : "Vibe time"}
        </span>
      </div>

      {/* Urgent glow effect */}
      {isUrgent && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: "0 0 30px hsl(var(--accent) / 0.5), 0 0 60px hsl(var(--destructive) / 0.3)"
          }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.5, repeat: Infinity }}
        />
      )}
    </motion.div>
  );
};
