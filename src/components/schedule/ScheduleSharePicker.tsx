import { useState, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { format, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Check, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeBlockCell } from "./TimeBlockCell";
import { useSchedule, TimeBlock, getTimeBlockInfo } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";

const TIME_BLOCKS: TimeBlock[] = ["morning", "afternoon", "evening", "night"];

const slotKeyFor = (date: Date, block: TimeBlock): string =>
  `${format(date, "yyyy-MM-dd")}_${block}`;

interface ScheduleSharePickerProps {
  initialSelection?: string[];
  onSelectionChange?: (slotKeys: string[]) => void;
}

/**
 * Reusable 14-day × 4-block availability picker for schedule sharing.
 * Reads/writes the user's own availability via useSchedule (so adding open
 * blocks here also updates /schedule). Selection is local-only state — the
 * caller submits it through dateSuggestionApply.
 *
 * Visual model:
 *   - open + selected: cyan cell with a check ring overlay
 *   - open + unselected: cyan cell, tap to select
 *   - busy: muted, non-tappable
 *   - event (locked by another date): purple/lock, non-tappable
 *   - unset: muted with + icon, tap to mark open and auto-select
 */
export const ScheduleSharePicker = ({
  initialSelection = [],
  onSelectionChange,
}: ScheduleSharePickerProps) => {
  const {
    dateRange,
    toggleSlot,
    getSlotStatus,
    isLoading,
    isSlotPending,
  } = useSchedule();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));

  const emit = useCallback(
    (next: Set<string>) => {
      setSelected(next);
      onSelectionChange?.(Array.from(next));
    },
    [onSelectionChange],
  );

  const totalOpen = useMemo(() => {
    let n = 0;
    for (const date of dateRange) {
      for (const block of TIME_BLOCKS) {
        if (getSlotStatus(date, block)?.status === "open") n += 1;
      }
    }
    return n;
  }, [dateRange, getSlotStatus]);

  const handleScroll = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollBy({
      left: direction === "left" ? -200 : 200,
      behavior: "smooth",
    });
  };

  const handleCellTap = useCallback(
    async (date: Date, block: TimeBlock) => {
      const key = slotKeyFor(date, block);
      const slot = getSlotStatus(date, block);
      const status = slot?.status ?? null;

      // Locked or busy: do nothing
      if (status === "event" || status === "busy") return;

      // Open: toggle selection
      if (status === "open") {
        const next = new Set(selected);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        emit(next);
        return;
      }

      // Unset: mark open in user_schedules, then auto-select
      try {
        await toggleSlot(date, block);
        const next = new Set(selected);
        next.add(key);
        emit(next);
      } catch {
        // toggleSlot logs/throws on its own; UI state already optimistically updated
      }
    },
    [emit, getSlotStatus, selected, toggleSlot],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAnyOpen = totalOpen > 0;

  return (
    <div className="flex flex-col">
      {!hasAnyOpen && (
        <div className="px-4 pb-3 pt-1">
          <p className="text-sm text-foreground font-medium">
            Add open blocks to your Vibely Schedule
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Tap a block when you'd be open to meet. Added blocks save to your
            Vibely Schedule and you can choose which ones to share before sending.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between px-2 py-2 border-b border-border/30">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleScroll("left")}
          aria-label="Scroll earlier"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-xs text-muted-foreground font-medium">
          {format(dateRange[0], "MMM d")} – {format(dateRange[dateRange.length - 1], "MMM d")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleScroll("right")}
          aria-label="Scroll later"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex">
        <div className="shrink-0 w-16 border-r border-border/30 py-3">
          <div className="h-10" />
          {TIME_BLOCKS.map((block) => (
            <div key={block} className="h-16 flex items-center px-2">
              <div>
                <p className="text-[11px] font-medium text-foreground">
                  {getTimeBlockInfo(block).label}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto scrollbar-hide"
        >
          <div className="inline-flex min-w-full py-3 px-1">
            {dateRange.map((date) => {
              const today = isToday(date);
              return (
                <div key={date.toISOString()} className="flex-shrink-0 w-20 px-1">
                  <div
                    className={cn(
                      "h-10 flex flex-col items-center justify-center rounded-lg mb-1",
                      today && "bg-primary/15",
                    )}
                  >
                    <span className="text-[10px] uppercase text-muted-foreground font-medium">
                      {format(date, "EEE")}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        today ? "text-primary" : "text-foreground",
                      )}
                    >
                      {format(date, "d")}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {TIME_BLOCKS.map((block) => {
                      const key = slotKeyFor(date, block);
                      const slot = getSlotStatus(date, block);
                      const status = slot?.status ?? null;
                      const isSelected = selected.has(key);
                      const isPending = isSlotPending(date, block);
                      const isUnset = status === null;

                      return (
                        <div key={key} className="relative">
                          {isUnset && !isPending ? (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => void handleCellTap(date, block)}
                              className="h-16 w-full rounded-xl border border-dashed border-border/60 bg-muted/20 hover:bg-muted/40 transition-all flex items-center justify-center"
                              aria-label={`Add open block ${format(date, "EEE d")} ${block}`}
                            >
                              <Plus className="w-4 h-4 text-muted-foreground" />
                            </motion.button>
                          ) : (
                            <TimeBlockCell
                              block={block}
                              status={status}
                              eventName={slot?.eventName}
                              isOwner
                              onClick={() => void handleCellTap(date, block)}
                              isPending={isPending}
                            />
                          )}

                          {isSelected && status === "open" && !isPending && (
                            <motion.div
                              initial={{ scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="absolute inset-0 rounded-xl ring-2 ring-primary pointer-events-none flex items-start justify-end p-1"
                            >
                              <span className="rounded-full bg-primary text-primary-foreground p-0.5">
                                <Check className="w-3 h-3" strokeWidth={3} />
                              </span>
                            </motion.div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 py-2 text-[11px] text-muted-foreground">
        {selected.size > 0 ? (
          <span>
            {selected.size} block{selected.size === 1 ? "" : "s"} selected
          </span>
        ) : (
          <span>Tap open blocks to share with your match.</span>
        )}
      </div>
    </div>
  );
};
