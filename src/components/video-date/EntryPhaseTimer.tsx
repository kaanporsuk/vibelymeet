import { motion } from "framer-motion";

interface EntryPhaseTimerProps {
  timeLeft: number;
  totalTime: number;
  phase: "entry" | "date" | "ended";
}

export const EntryPhaseTimer = ({ timeLeft, totalTime, phase }: EntryPhaseTimerProps) => {
  const progress = Math.max(0, Math.min(1, timeLeft / totalTime));
  const isUrgent = timeLeft <= 10;
  const shouldHeartbeat = phase === "entry" && isUrgent;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `0:${String(secs).padStart(2, "0")}`;
  };

  // Ring SVG parameters
  const size = 64;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  const getColor = () => {
    if (phase === "entry") {
      return isUrgent ? "hsl(330, 81%, 60%)" : "hsl(263, 70%, 66%)";
    }
    if (phase === "date") {
      return isUrgent ? "hsl(330, 81%, 60%)" : "hsl(263, 70%, 66%)";
    }
    return "hsl(var(--muted-foreground))";
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.2 }}
      className="relative flex items-center justify-center rounded-full bg-black/40 p-1 backdrop-blur-xl ring-1 ring-white/10"
      style={{
        boxShadow: shouldHeartbeat
          ? "0 0 28px hsl(330 81% 60% / 0.32), inset 0 0 18px hsl(0 0% 100% / 0.04)"
          : "0 12px 34px rgb(0 0 0 / 0.36), inset 0 0 18px hsl(0 0% 100% / 0.04)",
      }}
    >
      {/* Glow behind when urgent */}
      {shouldHeartbeat && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 0.6, repeat: Infinity }}
          style={{
            boxShadow: `0 0 24px hsl(330 81% 60% / 0.5)`,
          }}
        />
      )}

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--foreground))"
          strokeWidth={strokeWidth}
          opacity={0.14}
        />
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
            filter: shouldHeartbeat
              ? "drop-shadow(0 0 6px hsl(330 81% 60% / 0.6))"
              : "none",
          }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-[15px] font-display font-bold tabular-nums"
          animate={
            shouldHeartbeat
              ? { color: ["hsl(263,70%,66%)", "hsl(330,81%,60%)", "hsl(263,70%,66%)"] }
              : {}
          }
          transition={shouldHeartbeat ? { duration: 0.5, repeat: Infinity } : {}}
          style={{ color: shouldHeartbeat ? undefined : "hsl(var(--foreground))" }}
        >
          {formatTime(timeLeft)}
        </motion.span>
      </div>
    </motion.div>
  );
};
