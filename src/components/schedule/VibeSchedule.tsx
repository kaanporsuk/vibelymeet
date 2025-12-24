import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { format, isSameDay, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Copy, Calendar, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeBlockCell } from "./TimeBlockCell";
import { useSchedule, TimeBlock, getTimeBlockInfo } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TIME_BLOCKS: TimeBlock[] = ["morning", "afternoon", "evening", "night"];

interface VibeScheduleProps {
  onClose?: () => void;
}

export const VibeSchedule = ({ onClose }: VibeScheduleProps) => {
  const { mySchedule, dateRange, toggleSlot, getSlotStatus, copyPreviousWeek } = useSchedule();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollIndex, setScrollIndex] = useState(0);

  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: "smooth" });
      setScrollIndex(Math.max(0, scrollIndex - 3));
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: "smooth" });
      setScrollIndex(Math.min(dateRange.length - 7, scrollIndex + 3));
    }
  };

  const handleCopyWeek = () => {
    copyPreviousWeek();
    toast.success("Previous week's schedule copied!");
  };

  const handleToggle = (date: Date, block: TimeBlock) => {
    toggleSlot(date, block);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="shrink-0 p-6 border-b border-border/50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Calendar className="w-6 h-6 text-neon-cyan" />
              My Vibe Schedule
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Tap to mark when you're open for dates
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyWeek}
            className="gap-2 border-primary/50 text-primary hover:bg-primary/10"
          >
            <Copy className="w-4 h-4" />
            Roll Previous Week
          </Button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-neon-cyan/20 border-2 border-neon-cyan" />
            <span className="text-xs text-muted-foreground">Open for Vibe</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-primary/30 border-2 border-primary animate-pulse" />
            <span className="text-xs text-muted-foreground">Event (Locked)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-muted/30 border border-border/50" />
            <span className="text-xs text-muted-foreground">Busy/Neutral</span>
          </div>
        </div>
      </div>

      {/* Scroll Controls */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/30">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleScrollLeft}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-sm text-muted-foreground font-medium">
          {format(dateRange[0], "MMM d")} - {format(dateRange[dateRange.length - 1], "MMM d, yyyy")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleScrollRight}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Time block labels (fixed) */}
          <div className="shrink-0 w-20 border-r border-border/30 py-4">
            <div className="h-12" /> {/* Spacer for date header */}
            {TIME_BLOCKS.map((block) => (
              <div
                key={block}
                className="h-16 flex items-center px-3"
              >
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {getTimeBlockInfo(block).label}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {getTimeBlockInfo(block).hours}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Scrollable days */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-x-auto scrollbar-hide"
          >
            <div className="inline-flex min-w-full py-4 px-2">
              {dateRange.map((date) => {
                const isCurrentDay = isToday(date);
                return (
                  <div
                    key={date.toISOString()}
                    className={cn(
                      "flex-shrink-0 w-20 px-1",
                      isCurrentDay && "relative"
                    )}
                  >
                    {/* Day header */}
                    <div
                      className={cn(
                        "h-12 flex flex-col items-center justify-center rounded-lg mb-1",
                        isCurrentDay && "bg-primary/20"
                      )}
                    >
                      <span className="text-[10px] uppercase text-muted-foreground font-medium">
                        {format(date, "EEE")}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          isCurrentDay ? "text-primary" : "text-foreground"
                        )}
                      >
                        {format(date, "d")}
                      </span>
                    </div>

                    {/* Time blocks for this day */}
                    <div className="space-y-1">
                      {TIME_BLOCKS.map((block) => {
                        const slot = getSlotStatus(date, block);
                        return (
                          <TimeBlockCell
                            key={`${date.toISOString()}-${block}`}
                            block={block}
                            status={slot?.status || null}
                            eventName={slot?.eventName}
                            isOwner={true}
                            onClick={() => handleToggle(date, block)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="shrink-0 p-4 border-t border-border/30 text-center">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Sparkles className="w-3 h-3 text-neon-cyan" />
          Your matches will only see your open slots, never your busy times
        </p>
      </div>
    </div>
  );
};
