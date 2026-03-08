import { cn } from "@/lib/utils";

interface PremiumBadgeProps {
  className?: string;
  size?: "sm" | "md";
}

export const PremiumBadge = ({ className, size = "sm" }: PremiumBadgeProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
        className
      )}
    >
      ✦ Premium
    </span>
  );
};
