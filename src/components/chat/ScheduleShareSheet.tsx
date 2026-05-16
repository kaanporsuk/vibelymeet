import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScheduleSharePicker } from "@/components/schedule/ScheduleSharePicker";
import {
  dateSuggestionApply,
  DateSuggestionDomainError,
  type RevisionPayload,
} from "@/hooks/useDateSuggestionActions";
import { toast } from "sonner";
import { localTimezoneOrUtc } from "../../../shared/dateSuggestions/localTimezone";

interface ScheduleShareSheetProps {
  isOpen: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
  /** Called with the existing suggestion id when the backend returns active_suggestion_exists. */
  onActiveSuggestionConflict?: (suggestionId: string | null) => void;
  /** Called after a successful send so the parent can refresh the thread / scroll to the new card. */
  onSent?: (suggestionId: string | null) => void;
}

/**
 * + → Schedule entry sheet. Availability-first: the user picks selected open
 * blocks from their existing Vibely Schedule, then sends. Persists through
 * dateSuggestionApply("send_proposal"); no local-only state.
 */
export const ScheduleShareSheet = ({
  isOpen,
  onClose,
  matchId,
  partnerName,
  onActiveSuggestionConflict,
  onSent,
}: ScheduleShareSheetProps) => {
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);

  const handleSelectionChange = useCallback((keys: string[]) => {
    setSelectedSlotKeys(keys);
  }, []);

  const handleSend = async () => {
    if (selectedSlotKeys.length === 0 || isSending) return;

    setIsSending(true);
    try {
      const revision: RevisionPayload = {
        date_type_key: "hangout",
        time_choice_key: "share_schedule",
        place_mode_key: "decide_together",
        schedule_share_enabled: true,
        local_timezone: localTimezoneOrUtc(),
        selected_slot_keys: selectedSlotKeys,
      };

      const result = (await dateSuggestionApply("send_proposal", {
        match_id: matchId,
        revision,
      })) as { suggestion_id?: string | null } | null;

      onSent?.(result?.suggestion_id ?? null);
      onClose();
    } catch (err) {
      if (err instanceof DateSuggestionDomainError) {
        if (err.code === "active_suggestion_exists") {
          onActiveSuggestionConflict?.(err.suggestionId);
          onClose();
          return;
        }
        if (err.code === "tier_capability_disabled") {
          toast.error("Schedule sharing is not available on your plan yet.");
          return;
        }
        if (err.code === "selected_slots_required") {
          toast.error("Pick at least one open block to share.");
          return;
        }
        toast.error(err.message || "Could not share your schedule.");
        return;
      }
      toast.error("Could not share your schedule. Please try again.");
    } finally {
      setIsSending(false);
    }
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
            className="relative w-full sm:max-w-2xl max-h-[92vh] bg-background border-t sm:border border-border/50 sm:rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-neon-cyan/15 p-2 mt-0.5">
                  <Calendar className="w-5 h-5 text-neon-cyan" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-foreground">
                    Share your Vibely Schedule
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Choose the open blocks you want to share with {partnerName}.
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

            {/* Picker */}
            <div className="flex-1 overflow-y-auto">
              <ScheduleSharePicker onSelectionChange={handleSelectionChange} />
            </div>

            {/* Privacy + CTA */}
            <div className="shrink-0 border-t border-border/40 px-5 py-4 space-y-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Only selected open blocks are shared. Busy/private and unselected
                times are never shown. Visible for 48 hours.
              </p>
              <Button
                onClick={() => void handleSend()}
                disabled={selectedSlotKeys.length === 0 || isSending}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sharing…
                  </>
                ) : (
                  <>
                    Share selected blocks
                    {selectedSlotKeys.length > 0 && (
                      <span className="ml-1.5 opacity-80">
                        ({selectedSlotKeys.length})
                      </span>
                    )}
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
