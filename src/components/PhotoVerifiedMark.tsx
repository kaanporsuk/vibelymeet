import { motion } from "framer-motion";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoVerifiedMarkProps {
  verified: boolean;
  className?: string;
  size?: "sm" | "md";
  animate?: boolean;
}

export function PhotoVerifiedMark({ 
  verified, 
  className, 
  size = "sm",
  animate = true 
}: PhotoVerifiedMarkProps) {
  if (!verified) return null;

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const wrapSize = size === "sm" ? "w-5 h-5" : "w-6 h-6";

  return (
    <motion.span
      initial={animate ? { scale: 0, rotate: -180 } : false}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ 
        type: "spring", 
        stiffness: 260, 
        damping: 20,
        delay: 0.2 
      }}
      whileHover={{ scale: 1.15 }}
      className={cn(
        "inline-flex items-center justify-center rounded-full",
        "bg-background/70 backdrop-blur border border-border/60",
        "text-neon-cyan",
        wrapSize,
        className
      )}
      aria-label="Photo verified"
      title="Photo verified"
    >
      <motion.div
        animate={{ 
          boxShadow: [
            "0 0 0 0 hsl(var(--neon-cyan) / 0)",
            "0 0 0 4px hsl(var(--neon-cyan) / 0.3)",
            "0 0 0 0 hsl(var(--neon-cyan) / 0)"
          ]
        }}
        transition={{ 
          duration: 2, 
          repeat: 2,
          delay: 0.5 
        }}
        className="rounded-full flex items-center justify-center"
      >
        <BadgeCheck className={iconSize} fill="hsl(var(--neon-cyan))" strokeWidth={2} />
      </motion.div>
    </motion.span>
  );
}
