import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScheduleSharePicker } from "@/components/schedule/ScheduleSharePicker";
import {
  dateSuggestionApply,
  DateSuggestionDomainError,
} from "@/hooks/useDateSuggestionActions";
import { useSharedPartnerSchedule } from "@/hooks/useSharedPartnerSchedule";
import { toast } from "sonner";

interface ScheduleShareEditSheetProps {
  isOpen: boolean;
  onClose: () => void;
  matchId: string;
  suggestionId: string;
  /** The sender themselves (subject of the existing grant row). */
  currentUserId: string;
  partnerName: string;
  /** Called after successful save so the parent can refresh card/thread state. */
  onSaved?: () => void;
}

/**
 * Sender-side "Edit selected blocks" sheet for a schedule-share card.
 *
 * Persists as an `edit_schedule_share_slots` action on the SAME active
 * suggestion — never `send_proposal`, never creates a second card, never
 * touches the partner's grant row.
 *
 * Initial selection is loaded from the sender's own grant via
 * `get_shared_schedule_for_date_planning` (RPC permits either side to read
 * the subject's grant), so what they originally shared is preselected.
 */
export const ScheduleShareEditSheet = ({
  isOpen,
  onClose,
  matchId,
  suggestionId,
  currentUserId,
  partnerName,
  onSaved,
}: ScheduleShareEditSheetProps) => {
  const senderShare = useSharedPartnerSchedule(matchId, currentUserId, isOpen);
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Preload the current selection once data is available. After the user
  // interacts with the picker we stop syncing from the server so we don't
  // clobber their in-flight edits.
  useEffect(() => {
    if (!isOpen) {
      setTouched(false);
      setSelectedSlotKeys([]);
      return;
    }
    if (touched) return;
    const slots = senderShare.data ?? [];
    setSelectedSlotKeys(slots.map((s) => s.slot_key));
  }, [isOpen, senderShare.data, touched]);

  const initialSelection = useMemo(
    () => (senderShare.data ?? []).map((s) => s.slot_key),
    [senderShare.data],
  );

  const handleSelectionChange = (keys: string[]) => {
    setTouched(true);
    setSelectedSlotKeys(keys);
  };

  const handleSave = async () => {
    if (selectedSlotKeys.length === 0 || isSaving) return;

    setIsSaving(true);
    try {
      await dateSuggestionApply("edit_schedule_share_slots", {
        suggestion_id: suggestionId,
        selected_slot_keys: selectedSlotKeys,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      if (err instanceof DateSuggestionDomainError) {
        if (err.code === "tier_capability_disabled") {
          toast.error("Schedule sharing is not available on your plan yet.");
          return;
        }
        if (err.code === "selected_slots_required") {
          toast.error("Pick at least one open block to share.");
          return;
        }
        if (err.code === "not_a_schedule_share_revision") {
          toast.error("This date is no longer a schedule share.");
          return;
        }
        if (err.code === "invalid_status" || err.code === "not_found") {
          toast.error("This suggestion is no longer editable.");
          return;
        }
        if (err.code === "forbidden") {
          toast.error("You can only edit blocks you shared.");
          return;
        }
        if (err.code === "no_share_grant_to_edit") {
          toast.error("Your shared blocks expired. Share your schedule again.");
          return;
        }
        if (err.code === "selected_slot_not_open") {
          toast.error("One of those blocks is no longer open. Pick open blocks and try again.");
          return;
        }
        toast.error(err.message || "Could not update your shared blocks.");
        return;
      }
      toast.error("Could not update your shared blocks. Please try again.");
    } finally {
      setIsSaving(false);
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
          role="dialog"
          aria-modal="true"
          aria-label="Edit selected blocks"
        >
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="relative w-full sm:max-w-2xl max-h-[92vh] bg-background border-t sm:border border-border/50 sm:rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-neon-cyan/15 p-2 mt-0.5">
                  <Calendar className="w-5 h-5 text-neon-cyan" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-foreground">
                    Edit selected blocks
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Update which open blocks you’re sharing with {partnerName}.
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

            <div className="flex-1 overflow-y-auto">
              {senderShare.isLoading ? (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading your shared blocks…
                </div>
              ) : (
                <ScheduleSharePicker
                  initialSelection={initialSelection}
                  onSelectionChange={handleSelectionChange}
                />
              )}
            </div>

            <div className="shrink-0 border-t border-border/40 px-5 py-4 space-y-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Replaces your current shared selection. Their selection (if any)
                stays as-is.
              </p>
              <Button
                onClick={() => void handleSave()}
                disabled={selectedSlotKeys.length === 0 || isSaving}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    Save selected blocks
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
