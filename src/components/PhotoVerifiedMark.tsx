import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoVerifiedMarkProps {
  verified: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function PhotoVerifiedMark({ verified, className, size = "sm" }: PhotoVerifiedMarkProps) {
  if (!verified) return null;

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const wrapSize = size === "sm" ? "w-5 h-5" : "w-6 h-6";

  return (
    <span
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
      <BadgeCheck className={iconSize} fill="hsl(var(--neon-cyan))" strokeWidth={2} />
    </span>
  );
}
