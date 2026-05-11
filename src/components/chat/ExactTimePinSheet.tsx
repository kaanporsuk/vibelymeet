import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { getTimeBlockInfo } from "@/hooks/useSchedule";
import {
  BLOCK_HOUR_RANGES as BLOCK_RANGES,
  parseSlotKey as parseSlotKeyShared,
  type TimeBlock,
} from "../../../shared/dateSuggestions/scheduleShare";

const parseSlotKey = (slotKey: string): { date: Date; block: TimeBlock } | null => {
  const parsed = parseSlotKeyShared(slotKey);
  if (!parsed) return null;
  const date = new Date(`${parsed.slotDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return { date, block: parsed.timeBlock };
};

const halfHourSlots = (block: TimeBlock): { hour: number; minute: number; label: string }[] => {
  const { startHour, endHour } = BLOCK_RANGES[block];
  const slots: { hour: number; minute: number; label: string }[] = [];
  for (let h = startHour; h < endHour; h += 1) {
    for (const m of [0, 30]) {
      // Last slot of the block: don't go past end - 30 min so the 90-min default still fits visually.
      // But the lower bound check is what the server enforces; we just pre-render half-hour ticks here.
      const displayHour = h === 24 ? 0 : h;
      const meridiem = h < 12 ? "AM" : h === 12 ? "PM" : h === 24 ? "AM" : "PM";
      const display12 = displayHour === 0 ? 12 : displayHour > 12 ? displayHour - 12 : displayHour;
      const label = `${display12}:${m.toString().padStart(2, "0")} ${meridiem}`;
      slots.push({ hour: h, minute: m, label });
    }
  }
  return slots;
};

interface ExactTimePinSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** slot_key in YYYY-MM-DD_<block> format. */
  chosenSlotKey: string;
  /**
   * Called with ISO starts_at and the user's wall-clock start hour (0-23).
   * The hour is sent explicitly because EXTRACT(HOUR ...) on the server-side
   * timestamp doesn't recover the user's local hour reliably.
   *
   * NOTE: This sheet pins the meeting START TIME ONLY. End time / duration is
   * deliberately NOT productized — physical-date length is not part of the
   * commitment. The product source of truth for which Vibely Schedule block
   * to lock is chosen_slot_key + starts_at (never starts_at + ends_at).
   */
  onConfirm: (
    startsAtIso: string,
    localStartHour: number,
  ) => void | Promise<void>;
  isSubmitting?: boolean;
}

/**
 * Constrains the user to picking an exact start time inside the chosen block's
 * hour range. Default is mid-block. Server-side validation
 * (date_suggestion_apply_v2.accept) re-checks local_start_hour falls inside the
 * chosen block; this UI is defense-in-depth and a friendlier picker than a
 * free-form clock.
 *
 * Boundaries are end-exclusive:
 *   Morning   = 08:00 <= start < 12:00
 *   Afternoon = 12:00 <= start < 17:00
 *   Evening   = 17:00 <= start < 21:00
 *   Night     = 21:00 <= start < 00:00
 */
export const ExactTimePinSheet = ({
  isOpen,
  onClose,
  chosenSlotKey,
  onConfirm,
  isSubmitting = false,
}: ExactTimePinSheetProps) => {
  const parsed = useMemo(() => parseSlotKey(chosenSlotKey), [chosenSlotKey]);

  const slots = useMemo(() => {
    if (!parsed) return [];
    return halfHourSlots(parsed.block);
  }, [parsed]);

  const defaultIndex = useMemo(() => {
    if (!parsed) return 0;
    const { startHour, endHour } = BLOCK_RANGES[parsed.block];
    const midHour = Math.floor((startHour + endHour) / 2);
    const idx = slots.findIndex((s) => s.hour === midHour && s.minute === 0);
    return idx >= 0 ? idx : Math.floor(slots.length / 2);
  }, [parsed, slots]);

  const [selectedIndex, setSelectedIndex] = useState<number>(defaultIndex);

  if (!parsed) return null;

  const blockInfo = getTimeBlockInfo(parsed.block);

  const handleConfirm = async () => {
    const slot = slots[selectedIndex];
    if (!slot) return;

    const startsAt = new Date(parsed.date);
    startsAt.setHours(slot.hour, slot.minute, 0, 0);

    await onConfirm(startsAt.toISOString(), slot.hour);
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
                <div className="rounded-xl bg-primary/15 p-2 mt-0.5">
                  <Clock className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-foreground">
                    Pick an exact time
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {format(parsed.date, "EEEE, MMM d")} · {blockInfo.label} ({blockInfo.hours})
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
              <div className="grid grid-cols-3 gap-2">
                {slots.map((slot, i) => (
                  <button
                    key={`${slot.hour}-${slot.minute}`}
                    onClick={() => setSelectedIndex(i)}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                      i === selectedIndex
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border/50 bg-muted/20 text-foreground hover:bg-muted/40"
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-border/40 px-5 py-4">
              <Button
                onClick={() => void handleConfirm()}
                disabled={isSubmitting}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Confirming…
                  </>
                ) : (
                  <>Confirm date</>
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
