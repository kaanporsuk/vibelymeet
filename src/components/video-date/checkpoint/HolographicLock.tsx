import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";

interface HolographicLockProps {
  partnerName: string;
}

export const HolographicLock = ({ partnerName }: HolographicLockProps) => {
  const [phase, setPhase] = useState<"slam" | "glow" | "burst" | "message">("slam");

  useEffect(() => {
    // Phase 1: Lock slams in (0ms)
    const glowTimer = setTimeout(() => setPhase("glow"), 600);
    
    // Phase 2: Glow white-hot (600ms)
    const burstTimer = setTimeout(() => {
      setPhase("burst");
      
      // Trigger particle burst
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.5 },
        colors: ["#8B5CF6", "#EC4899", "#06B6D4", "#ffffff"],
      });
    }, 1200);

    // Phase 3: Show message (1800ms)
    const messageTimer = setTimeout(() => setPhase("message"), 1800);

    return () => {
      clearTimeout(glowTimer);
      clearTimeout(burstTimer);
      clearTimeout(messageTimer);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 flex items-center justify-center"
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-background/95" />

      {/* Lock Animation */}
      {phase !== "message" && (
        <motion.div
          initial={{ scale: 3, opacity: 0, y: -100 }}
          animate={{
            scale: phase === "burst" ? [1, 1.5, 0] : 1,
            opacity: phase === "burst" ? [1, 1, 0] : 1,
            y: 0,
          }}
          transition={{
            duration: phase === "slam" ? 0.5 : 0.3,
            type: phase === "slam" ? "spring" : "tween",
            stiffness: 300,
            damping: 20,
          }}
          className="relative z-10"
        >
          <motion.div
            className="relative"
            animate={
              phase === "glow"
                ? {
                    filter: [
                      "brightness(1) drop-shadow(0 0 20px hsl(var(--primary)))",
                      "brightness(2) drop-shadow(0 0 60px #fff)",
                      "brightness(3) drop-shadow(0 0 100px #fff)",
                    ],
                  }
                : {}
            }
            transition={{ duration: 0.6 }}
          >
            {/* Outer glow ring */}
            <motion.div
              className="absolute inset-0 rounded-full"
              initial={{ scale: 1 }}
              animate={
                phase === "glow"
                  ? {
                      scale: [1, 1.5, 2],
                      opacity: [0.5, 0.3, 0],
                    }
                  : {}
              }
              style={{
                background: "radial-gradient(circle, hsl(var(--primary) / 0.5), transparent 70%)",
              }}
            />

            {/* Lock icon container */}
            <motion.div
              className="w-32 h-32 rounded-full flex items-center justify-center"
              style={{
                background:
                  phase === "glow"
                    ? "linear-gradient(135deg, #fff, #8B5CF6)"
                    : "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
              }}
              animate={
                phase === "slam"
                  ? {
                      boxShadow: [
                        "0 0 0 0 hsl(var(--primary) / 0)",
                        "0 0 60px 20px hsl(var(--primary) / 0.5)",
                      ],
                    }
                  : {}
              }
            >
              <Lock
                className={`w-16 h-16 ${
                  phase === "glow" ? "text-background" : "text-primary-foreground"
                }`}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {/* Particle burst effect */}
      {phase === "burst" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ scale: 1, opacity: 1 }}
              animate={{
                x: Math.cos((i * Math.PI * 2) / 12) * 200,
                y: Math.sin((i * Math.PI * 2) / 12) * 200,
                opacity: 0,
                scale: 0,
              }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="absolute w-3 h-3 rounded-full"
              style={{
                background: i % 2 === 0 ? "hsl(var(--primary))" : "hsl(var(--accent))",
                boxShadow: `0 0 10px ${i % 2 === 0 ? "hsl(var(--primary))" : "hsl(var(--accent))"}`,
              }}
            />
          ))}
        </div>
      )}

      {/* Success Message */}
      {phase === "message" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="relative z-10 text-center"
        >
          <motion.div
            className="flex justify-center mb-4"
            animate={{
              rotate: [0, 10, -10, 0],
            }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Sparkles className="w-12 h-12 text-primary" />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl font-display font-bold gradient-text mb-3"
          >
            Vibe Logged!
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-lg text-muted-foreground"
          >
            Waiting for{" "}
            <span className="text-foreground font-medium">{partnerName}</span>...
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-6 flex justify-center"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 rounded-full border-2 border-transparent border-t-primary border-r-accent"
            />
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
};
