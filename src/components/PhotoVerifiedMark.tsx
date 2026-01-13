import { motion } from "framer-motion";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PhotoVerifiedMarkProps {
  verified: boolean;
  className?: string;
  size?: "sm" | "md";
  animate?: boolean;
  showTooltip?: boolean;
}

export function PhotoVerifiedMark({ 
  verified, 
  className, 
  size = "sm",
  animate = true,
  showTooltip = true,
}: PhotoVerifiedMarkProps) {
  if (!verified) return null;

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const wrapSize = size === "sm" ? "w-5 h-5" : "w-6 h-6";

  const badge = (
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
        "inline-flex items-center justify-center rounded-full cursor-help",
        "bg-background/70 backdrop-blur border border-border/60",
        "text-neon-cyan",
        wrapSize,
        className
      )}
      aria-label="Photo verified"
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

  if (!showTooltip) return badge;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="max-w-[200px] p-3 bg-card border-border"
          sideOffset={5}
        >
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-neon-cyan shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">Verified Profile</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                This person completed a live selfie check to prove they match their photos.
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
