import { cn } from "@/lib/utils";

interface PremiumBadgeProps {
  className?: string;
  size?: "sm" | "md";
  /** Other user's tier from `subscription_tier` (via `getUserBadge`). */
  variant?: "premium" | "vip";
}

export const PremiumBadge = ({ className, size = "sm", variant = "premium" }: PremiumBadgeProps) => {
  const isVip = variant === "vip";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold rounded-full",
        isVip
          ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-amber-950"
          : "bg-gradient-to-r from-primary to-accent text-primary-foreground",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
        className
      )}
    >
      {isVip ? "✦ VIP" : "✦ Premium"}
    </span>
  );
};
