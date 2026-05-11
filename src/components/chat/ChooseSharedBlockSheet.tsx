import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TIME_BLOCK_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

const BLOCK_ORDER: Record<string, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  night: 3,
};

function dayLabel(slotDate: string): string {
  try {
    return format(new Date(`${slotDate}T00:00:00`), "EEE MMM d");
  } catch {
    return slotDate;
  }
}

export type OfferedBlock = {
  slot_key: string;
  slot_date: string;
  time_block: string;
  mutual?: boolean;
};

interface ChooseSharedBlockSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Blocks the sender already offered on this card. The user is constrained
   * to picking exactly one of these; busy/unset/event/non-offered blocks are
   * never exposed.
   */
  offeredBlocks: OfferedBlock[];
  isLoading?: boolean;
  /** When true, the loaded grant is missing/expired (still render the empty/expired state). */
  isError?: boolean;
  partnerName: string;
  /** Called once the user picks one and taps Continue. */
  onContinue: (slotKey: string) => void;
}

/**
 * Step 1 of the Accept flow on a shared Vibely Schedule card:
 * choose exactly one of the blocks the sender already shared.
 * After Continue the parent opens ExactTimePinSheet with the chosen key.
 *
 * Visual model is intentionally minimal — chips grouped by day, same TIME_BLOCK
 * labels and grouping conventions as ScheduleShareOfferedBlocks on the card.
 */
export const ChooseSharedBlockSheet = ({
  isOpen,
  onClose,
  offeredBlocks,
  isLoading = false,
  isError = false,
  partnerName,
  onContinue,
}: ChooseSharedBlockSheetProps) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Single-offered-block case: preselect for one-tap Continue. The user still
  // passes through the block-confirmation step for consistency.
  useEffect(() => {
    if (!isOpen) return;
    if (offeredBlocks.length === 1) {
      setSelectedKey(offeredBlocks[0].slot_key);
    } else {
      setSelectedKey(null);
    }
  }, [isOpen, offeredBlocks]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, OfferedBlock[]>();
    for (const slot of offeredBlocks) {
      const arr = byDay.get(slot.slot_date) ?? [];
      arr.push(slot);
      byDay.set(slot.slot_date, arr);
    }
    for (const arr of byDay.values()) {
      arr.sort(
        (a, b) =>
          (BLOCK_ORDER[a.time_block] ?? 9) - (BLOCK_ORDER[b.time_block] ?? 9),
      );
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [offeredBlocks]);

  const handleContinue = () => {
    if (!selectedKey) return;
    onContinue(selectedKey);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Choose a shared block"
        >
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="relative w-full sm:max-w-md max-h-[80vh] bg-background border-t sm:border border-border/50 sm:rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-neon-cyan/15 p-2 mt-0.5">
                  <CalendarIcon className="w-5 h-5 text-neon-cyan" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-foreground">
                    Choose a shared block
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Pick one of the blocks {partnerName} shared.
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading shared blocks…
                </div>
              ) : isError || grouped.length === 0 ? (
                <div className="rounded-xl border border-border/40 bg-muted/10 px-3 py-4 text-sm text-muted-foreground">
                  {isError
                    ? "Schedule access expired — ask them to share again."
                    : `${partnerName} doesn’t have any visible open blocks right now.`}
                </div>
              ) : (
                <div className="space-y-3">
                  {grouped.map(([day, slots]) => (
                    <div key={day}>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        {dayLabel(day)}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {slots.map((slot) => {
                          const isSelected = slot.slot_key === selectedKey;
                          return (
                            <button
                              key={slot.slot_key}
                              type="button"
                              onClick={() => setSelectedKey(slot.slot_key)}
                              className={cn(
                                "rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                                isSelected
                                  ? "border-primary bg-primary/15 text-primary"
                                  : slot.mutual
                                  ? "bg-amber-500/15 border-amber-400/60 text-amber-700 dark:text-amber-300 hover:border-primary/60"
                                  : "bg-cyan-500/10 border-cyan-400/50 text-cyan-700 dark:text-cyan-300 hover:border-primary/60",
                              )}
                              aria-pressed={isSelected}
                            >
                              {TIME_BLOCK_LABEL[slot.time_block] ?? slot.time_block}
                              {slot.mutual && (
                                <span className="ml-1 text-[10px] uppercase tracking-wide opacity-80">
                                  · Both open
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border/40 px-5 py-4">
              <Button
                onClick={handleContinue}
                disabled={!selectedKey || isLoading || isError}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Continue
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
