import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface AudioVisualizerProps {
  isActive: boolean;
}

export const AudioVisualizer = ({ isActive }: AudioVisualizerProps) => {
  const [bars, setBars] = useState<number[]>(Array(12).fill(0.3));

  useEffect(() => {
    if (!isActive) {
      setBars(Array(12).fill(0.3));
      return;
    }

    const interval = setInterval(() => {
      setBars(prev => prev.map(() => 0.2 + Math.random() * 0.8));
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="flex items-end justify-center gap-1 h-8 px-4">
      {bars.map((height, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-gradient-to-t from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-pink))]"
          animate={{ 
            height: `${height * 100}%`,
            opacity: isActive ? 1 : 0.4
          }}
          transition={{ duration: 0.1 }}
        />
      ))}
    </div>
  );
};
