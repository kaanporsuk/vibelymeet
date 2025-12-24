import { motion } from "framer-motion";
import { Lock, Calendar, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimeBlock, SlotStatus, getTimeBlockInfo } from "@/hooks/useSchedule";

interface TimeBlockCellProps {
  block: TimeBlock;
  status: SlotStatus | null;
  eventName?: string;
  isOwner?: boolean;
  onClick?: () => void;
  slotType?: "golden" | "available" | null;
  compact?: boolean;
}

export const TimeBlockCell = ({
  block,
  status,
  eventName,
  isOwner = false,
  onClick,
  slotType,
  compact = false,
}: TimeBlockCellProps) => {
  const blockInfo = getTimeBlockInfo(block);
  const isEvent = status === "event";
  const isOpen = status === "open";
  const isGolden = slotType === "golden";
  const isAvailable = slotType === "available";

  const cellClasses = cn(
    "relative rounded-xl transition-all duration-300 cursor-pointer overflow-hidden",
    compact ? "h-12 px-2" : "h-16 p-3",
    "flex items-center justify-center gap-2",
    {
      // Event state (locked, purple pulse)
      "bg-primary/30 border-2 border-primary animate-glow-pulse cursor-not-allowed": isEvent,
      // Open state (glowing cyan)
      "bg-neon-cyan/20 border-2 border-neon-cyan neon-glow-cyan": isOpen && isOwner && !isEvent,
      // Golden slot (mutual availability)
      "bg-gradient-to-br from-amber-500/30 to-yellow-500/30 border-2 border-amber-400": isGolden,
      // Available slot (match is free)
      "border-2 border-primary bg-primary/10 hover:bg-primary/20": isAvailable,
      // Neutral/busy state (dimmed)
      "bg-muted/30 border border-border/50 hover:bg-muted/50": !isOpen && !isEvent && !isGolden && !isAvailable,
    }
  );

  return (
    <motion.button
      whileTap={isEvent ? {} : { scale: 0.95 }}
      onClick={isEvent ? undefined : onClick}
      disabled={isEvent}
      className={cellClasses}
    >
      {/* Background glow for golden slots */}
      {isGolden && (
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400/20 to-yellow-500/20 animate-glow-pulse" />
      )}

      {/* Content */}
      <div className="relative z-10 flex items-center gap-2">
        {isEvent && (
          <>
            <Lock className="w-3.5 h-3.5 text-primary" />
            {!compact && (
              <div className="text-left">
                <p className="text-xs font-medium text-primary truncate max-w-[80px]">
                  {eventName || "Event"}
                </p>
              </div>
            )}
          </>
        )}

        {isGolden && (
          <>
            <Sparkles className="w-4 h-4 text-amber-400" />
            {!compact && (
              <span className="text-xs font-medium text-amber-400">Perfect Match</span>
            )}
          </>
        )}

        {isAvailable && !isGolden && (
          <>
            <Calendar className="w-4 h-4 text-primary" />
            {!compact && (
              <span className="text-xs font-medium text-primary">They're Free</span>
            )}
          </>
        )}

        {isOpen && isOwner && !isEvent && (
          <span className="text-xs font-medium text-neon-cyan">Open</span>
        )}

        {!isOpen && !isEvent && !isGolden && !isAvailable && !compact && (
          <span className="text-xs text-muted-foreground">{blockInfo.label}</span>
        )}
      </div>
    </motion.button>
  );
};
