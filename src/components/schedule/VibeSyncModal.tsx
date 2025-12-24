import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isToday, isTomorrow } from "date-fns";
import { X, Sparkles, Calendar, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeBlockCell } from "./TimeBlockCell";
import { DateProposalSheet } from "./DateProposalSheet";
import { useMutualAvailability, TimeBlock, getTimeBlockInfo } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";

interface VibeSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  matchName: string;
  matchAvatar: string;
  matchId: string;
  onProposalSent?: (proposal: any) => void;
}

export const VibeSyncModal = ({
  isOpen,
  onClose,
  matchName,
  matchAvatar,
  matchId,
  onProposalSent,
}: VibeSyncModalProps) => {
  const { mutualSlots, dateRange } = useMutualAvailability(matchId);
  const [selectedSlot, setSelectedSlot] = useState<{
    date: Date;
    block: TimeBlock;
    type: "golden" | "available";
  } | null>(null);

  const handleSlotClick = (slot: typeof mutualSlots[0]) => {
    setSelectedSlot(slot);
  };

  const handleProposalClose = () => {
    setSelectedSlot(null);
  };

  const handleProposalSent = (proposal: any) => {
    setSelectedSlot(null);
    onClose();
    onProposalSent?.(proposal);
  };

  // Group slots by date for better display
  const slotsByDate = mutualSlots.reduce((acc, slot) => {
    const dateKey = format(slot.date, "yyyy-MM-dd");
    if (!acc[dateKey]) {
      acc[dateKey] = { date: slot.date, slots: [] };
    }
    acc[dateKey].slots.push(slot);
    return acc;
  }, {} as Record<string, { date: Date; slots: typeof mutualSlots }>);

  const formatDateLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "EEEE, MMM d");
  };

  const goldenCount = mutualSlots.filter(s => s.type === "golden").length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl border border-border/50 overflow-hidden max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative p-6 border-b border-border/50">
              <button
                onClick={onClose}
                className="absolute right-4 top-4 p-2 rounded-full bg-muted/50 hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>

              <div className="flex items-center gap-4">
                <div className="relative">
                  <img
                    src={matchAvatar}
                    alt={matchName}
                    className="w-14 h-14 rounded-full object-cover border-2 border-neon-cyan"
                  />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center">
                    <Star className="w-3 h-3 text-background" fill="currentColor" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-foreground">
                    Vibe Sync
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Find the perfect time with {matchName}
                  </p>
                </div>
              </div>

              {/* Stats */}
              {goldenCount > 0 && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mt-4 p-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/30"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">
                      {goldenCount} Perfect Match{goldenCount > 1 ? "es" : ""} Found!
                    </span>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Content */}
            <div className="overflow-y-auto max-h-[50vh] p-6">
              {Object.keys(slotsByDate).length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h4 className="text-lg font-medium text-foreground mb-2">
                    No Matching Times Yet
                  </h4>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    {matchName} hasn't shared any open times that align with yours. Check back later!
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.values(slotsByDate).map(({ date, slots }) => (
                    <div key={format(date, "yyyy-MM-dd")}>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">
                        {formatDateLabel(date)}
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {slots.map((slot) => (
                          <motion.button
                            key={`${format(slot.date, "yyyy-MM-dd")}-${slot.block}`}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSlotClick(slot)}
                            className={cn(
                              "p-4 rounded-xl transition-all text-left",
                              slot.type === "golden"
                                ? "bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border-2 border-amber-400 hover:border-amber-300"
                                : "bg-primary/10 border-2 border-primary/50 hover:border-primary"
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {slot.type === "golden" ? (
                                <Sparkles className="w-4 h-4 text-amber-400" />
                              ) : (
                                <Calendar className="w-4 h-4 text-primary" />
                              )}
                              <span
                                className={cn(
                                  "text-xs font-medium",
                                  slot.type === "golden" ? "text-amber-400" : "text-primary"
                                )}
                              >
                                {slot.type === "golden" ? "Perfect Match" : "They're Free"}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-foreground">
                              {getTimeBlockInfo(slot.block).label}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {getTimeBlockInfo(slot.block).hours}
                            </p>
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/30">
              <p className="text-xs text-center text-muted-foreground">
                🔒 {matchName}'s busy times are private and never shown
              </p>
            </div>
          </motion.div>

          {/* Proposal Sheet */}
          <DateProposalSheet
            isOpen={!!selectedSlot}
            onClose={handleProposalClose}
            slot={selectedSlot}
            matchName={matchName}
            onSend={handleProposalSent}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
