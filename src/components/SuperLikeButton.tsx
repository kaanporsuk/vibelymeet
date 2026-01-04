import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, Sparkles } from "lucide-react";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";

interface SuperLikeButtonProps {
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}

// Particle component for the burst effect
const SuperLikeParticle = ({ 
  index, 
  total 
}: { 
  index: number; 
  total: number;
}) => {
  const angle = (index / total) * 360;
  const distance = 80 + Math.random() * 40;
  const x = Math.cos((angle * Math.PI) / 180) * distance;
  const y = Math.sin((angle * Math.PI) / 180) * distance;
  const delay = index * 0.02;
  const scale = 0.5 + Math.random() * 0.5;

  return (
    <motion.div
      initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
      animate={{
        x,
        y,
        scale: [0, scale, 0],
        opacity: [1, 1, 0],
      }}
      transition={{
        duration: 0.8,
        delay,
        ease: "easeOut",
      }}
      className="absolute w-2 h-2 rounded-full bg-neon-yellow"
      style={{
        boxShadow: "0 0 8px hsl(var(--neon-yellow))",
      }}
    />
  );
};

// Star burst particle
const StarParticle = ({ index }: { index: number }) => {
  const angle = (index / 8) * 360 + 22.5;
  const distance = 60 + Math.random() * 30;
  const x = Math.cos((angle * Math.PI) / 180) * distance;
  const y = Math.sin((angle * Math.PI) / 180) * distance;

  return (
    <motion.div
      initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
      animate={{
        x,
        y,
        scale: [0, 1.2, 0],
        opacity: [1, 1, 0],
        rotate: 180,
      }}
      transition={{
        duration: 0.7,
        delay: index * 0.03,
        ease: "easeOut",
      }}
      className="absolute text-neon-yellow"
    >
      <Star className="w-4 h-4" fill="currentColor" />
    </motion.div>
  );
};

export const SuperLikeButton = ({
  onClick,
  size = "md",
  className,
  disabled = false,
}: SuperLikeButtonProps) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const { playFeedback, triggerHaptic } = useSoundEffects();

  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const iconSizes = {
    sm: "w-5 h-5",
    md: "w-7 h-7",
    lg: "w-9 h-9",
  };

  const handleClick = () => {
    if (disabled || isAnimating) return;

    setIsAnimating(true);
    playFeedback("success", { volume: 0.7 });
    triggerHaptic("success");
    onClick?.();

    setTimeout(() => setIsAnimating(false), 1000);
  };

  return (
    <div className="relative">
      {/* Particle effects container */}
      <AnimatePresence>
        {isAnimating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Main particle burst */}
            {Array.from({ length: 16 }).map((_, i) => (
              <SuperLikeParticle key={`particle-${i}`} index={i} total={16} />
            ))}
            {/* Star particles */}
            {Array.from({ length: 8 }).map((_, i) => (
              <StarParticle key={`star-${i}`} index={i} />
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Main button */}
      <motion.button
        onClick={handleClick}
        disabled={disabled}
        whileHover={{ scale: disabled ? 1 : 1.1 }}
        whileTap={{ scale: disabled ? 1 : 0.9 }}
        animate={isAnimating ? {
          scale: [1, 1.3, 1],
          rotate: [0, -10, 10, 0],
        } : {}}
        transition={{ duration: 0.4 }}
        className={cn(
          sizeClasses[size],
          "rounded-full flex items-center justify-center relative overflow-visible",
          "bg-gradient-to-br from-neon-yellow via-amber-400 to-orange-500",
          "shadow-lg transition-shadow duration-300",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:shadow-[0_0_30px_hsl(var(--neon-yellow)/0.6)]",
          className
        )}
        style={{
          boxShadow: isAnimating 
            ? "0 0 40px hsl(var(--neon-yellow)), 0 0 80px hsl(var(--neon-yellow) / 0.5)"
            : undefined,
        }}
      >
        {/* Sparkle ring effect */}
        <AnimatePresence>
          {isAnimating && (
            <motion.div
              initial={{ scale: 0.8, opacity: 1 }}
              animate={{ scale: 2.5, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="absolute inset-0 rounded-full border-4 border-neon-yellow"
            />
          )}
        </AnimatePresence>

        {/* Inner glow */}
        <div className="absolute inset-1 rounded-full bg-gradient-to-br from-white/40 to-transparent" />

        {/* Icon */}
        <motion.div
          animate={isAnimating ? { rotate: [0, 360] } : {}}
          transition={{ duration: 0.5 }}
        >
          <Star 
            className={cn(iconSizes[size], "text-white relative z-10")} 
            fill="currentColor"
          />
        </motion.div>

        {/* Floating sparkles around button */}
        <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-white/80" />
      </motion.button>

      {/* Label */}
      <AnimatePresence>
        {isAnimating && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: -60, scale: 1 }}
            exit={{ opacity: 0, y: -80, scale: 0.8 }}
            transition={{ duration: 0.4 }}
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <span className="px-3 py-1.5 rounded-full bg-neon-yellow text-background font-bold text-sm shadow-lg">
              Super Like! ⭐
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
