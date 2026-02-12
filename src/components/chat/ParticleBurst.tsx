import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  angle: number;
  distance: number;
}

interface ParticleBurstProps {
  emoji: "❤️" | "🔥" | "🎉" | "💚" | "✨";
  onComplete: () => void;
}

export const ParticleBurst = ({ emoji, onComplete }: ParticleBurstProps) => {
  const [particles] = useState<Particle[]>(() => {
    const colors = emoji === "❤️" 
      ? ["#EC4899", "#F472B6", "#FB7185", "#FDA4AF"]
      : ["#F97316", "#FB923C", "#FBBF24", "#EC4899"];

    return Array.from({ length: 12 }, (_, i) => ({
      id: i,
      x: 0,
      y: 0,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 6 + 4,
      angle: (i / 12) * 360 + Math.random() * 30 - 15,
      distance: Math.random() * 40 + 30,
    }));
  });

  useEffect(() => {
    const timer = setTimeout(onComplete, 800);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-[99]">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {particles.map((particle) => {
          const radians = (particle.angle * Math.PI) / 180;
          const endX = Math.cos(radians) * particle.distance;
          const endY = Math.sin(radians) * particle.distance;

          return (
            <motion.div
              key={particle.id}
              initial={{ 
                x: 0, 
                y: 0, 
                scale: 1, 
                opacity: 1 
              }}
              animate={{ 
                x: endX, 
                y: endY, 
                scale: 0, 
                opacity: 0 
              }}
              transition={{ 
                duration: 0.6, 
                ease: "easeOut",
                delay: Math.random() * 0.1
              }}
              className="absolute rounded-full"
              style={{
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color,
                boxShadow: `0 0 ${particle.size * 2}px ${particle.color}`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
