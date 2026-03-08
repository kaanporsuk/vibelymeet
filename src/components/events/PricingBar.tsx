import { motion } from "framer-motion";
import { Flame, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PricingBarProps {
  price: number;
  capacityStatus: "available" | "filling" | "almostFull";
  spotsLeft: number;
  genderLabel: string;
  onPurchase: () => void;
  isPurchasing?: boolean;
}

const PricingBar = ({
  price,
  capacityStatus,
  spotsLeft,
  genderLabel,
  onPurchase,
  isPurchasing = false,
}: PricingBarProps) => {
  const getStatusConfig = () => {
    switch (capacityStatus) {
      case "available":
        return {
          color: "bg-green-500",
          text: "Spots Available",
          icon: null,
        };
      case "filling":
        return {
          color: "bg-orange-500",
          text: "Filling Fast",
          icon: <Flame className="w-3 h-3" />,
        };
      case "almostFull":
        return {
          color: "bg-destructive",
          text: `Only ${spotsLeft} left!`,
          icon: <AlertTriangle className="w-3 h-3" />,
        };
    }
  };

  const status = getStatusConfig();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-border/50 rounded-none">
      <div className="max-w-lg mx-auto p-4">
        <div className="flex items-center justify-between gap-4">
          {/* Price & Status */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-foreground">
                {price === 0 ? "Free" : `€${price.toFixed(2)}`}
              </span>
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white ${status.color}`}
              >
                {status.icon}
                {status.text}
              </motion.span>
            </div>
            <p className="text-xs text-muted-foreground">
              Ticket price for {genderLabel}
            </p>
          </div>

          {/* Purchase Button */}
          <motion.div
            animate={{
              boxShadow: [
                "0 0 20px hsl(var(--primary) / 0.3)",
                "0 0 40px hsl(var(--primary) / 0.5)",
                "0 0 20px hsl(var(--primary) / 0.3)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Button
              variant="gradient"
              size="lg"
              onClick={onPurchase}
              disabled={isPurchasing}
              className="min-w-[160px]"
            >
              {isPurchasing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Purchase Ticket
                </span>
              )}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default PricingBar;
