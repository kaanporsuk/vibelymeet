import { motion } from "framer-motion";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PhoneVerifiedBadgeProps {
  verified: boolean;
  className?: string;
  size?: "sm" | "md";
  showTooltip?: boolean;
}

export function PhoneVerifiedBadge({
  verified,
  className,
  size = "sm",
  showTooltip = true,
}: PhoneVerifiedBadgeProps) {
  if (!verified) return null;

  const iconSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  const wrapSize = size === "sm" ? "w-5 h-5" : "w-6 h-6";

  const badge = (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.3 }}
      className={cn(
        "inline-flex items-center justify-center rounded-full cursor-help",
        "bg-background/70 backdrop-blur border border-border/60",
        "text-neon-yellow",
        wrapSize,
        className
      )}
      aria-label="Phone verified"
    >
      <Phone className={iconSize} />
    </motion.span>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px] p-3 bg-card border-border" sideOffset={5}>
          <div className="flex items-start gap-2">
            <Phone className="w-4 h-4 text-neon-yellow shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">Phone Verified</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                This person verified their phone number for extra trust.
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
