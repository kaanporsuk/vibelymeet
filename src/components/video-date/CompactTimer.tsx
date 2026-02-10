import { motion } from "framer-motion";

interface CompactTimerProps {
  timeLeft: number;
  totalTime: number;
}

export const CompactTimer = ({ timeLeft, totalTime }: CompactTimerProps) => {
  const progress = timeLeft / totalTime;
  const isUrgent = timeLeft <= 30;
  const isCritical = timeLeft <= 10;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  // Ring SVG parameters
  const size = 56;
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  const getColor = () => {
    if (isCritical) return "hsl(0, 84%, 60%)";
    if (isUrgent) return "hsl(330, 81%, 60%)";
    if (progress > 0.5) return "hsl(187, 94%, 43%)";
    return "hsl(263, 70%, 66%)";
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.2 }}
      className="relative flex items-center justify-center"
    >
      {/* Glow behind when urgent */}
      {isCritical && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          style={{
            boxShadow: `0 0 24px hsl(0 84% 60% / 0.5)`,
          }}
        />
      )}

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          opacity={0.3}
        />
        {/* Progress ring */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          style={{
            filter: isCritical
              ? "drop-shadow(0 0 6px hsl(0 84% 60% / 0.6))"
              : isUrgent
              ? "drop-shadow(0 0 4px hsl(330 81% 60% / 0.5))"
              : "none",
          }}
        />
      </svg>

      {/* Timer text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="text-sm font-display font-bold tabular-nums"
          animate={
            isCritical
              ? { color: ["hsl(0,84%,60%)", "hsl(330,81%,60%)", "hsl(0,84%,60%)"] }
              : {}
          }
          transition={isCritical ? { duration: 0.5, repeat: Infinity } : {}}
          style={{ color: isCritical ? undefined : "hsl(var(--foreground))" }}
        >
          {formatTime(timeLeft)}
        </motion.span>
      </div>
    </motion.div>
  );
};
