import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DATE_TYPE_OPTIONS,
  TIME_CHOICE_OPTIONS,
  PLACE_MODE_OPTIONS,
  OPTIONAL_MESSAGE_VARIANTS,
  type DateTypeKey,
  type TimeChoiceKey,
  type PlaceModeKey,
} from "@/lib/dateSuggestionCopy";
import { slotDateBlockToStartsAt } from "@/lib/dateSuggestionTime";
import { useSharedPartnerSchedule } from "@/hooks/useSharedPartnerSchedule";
import { dateSuggestionApply, DateSuggestionDomainError } from "@/hooks/useDateSuggestionActions";
import type { DateSuggestionRevisionRow } from "@/hooks/useDateSuggestionData";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const STEPS = ["Type", "When", "Place", "Message", "Review"] as const;

export type WizardState = {
  dateTypeKey: DateTypeKey;
  timeChoiceKey: TimeChoiceKey;
  placeModeKey: PlaceModeKey;
  venueText: string;
  optionalMessage: string;
  variantIndex: number;
  scheduleShareEnabled: boolean;
  pickStartIso: string | null;
  pickEndIso: string | null;
  pickSlotDate: string | null;
  pickTimeBlock: string | null;
};

const defaultWizard = (): WizardState => ({
  dateTypeKey: "coffee",
  timeChoiceKey: "tomorrow",
  placeModeKey: "decide_together",
  venueText: "",
  optionalMessage: "",
  variantIndex: 0,
  scheduleShareEnabled: false,
  pickStartIso: null,
  pickEndIso: null,
  pickSlotDate: null,
  pickTimeBlock: null,
});

function buildRevision(w: WizardState) {
  const share = w.timeChoiceKey === "share_schedule";
  let startsAt: string | null | undefined = w.pickStartIso;
  let endsAt: string | null | undefined = w.pickEndIso;
  let timeBlock: string | null | undefined = w.pickTimeBlock;

  if (w.timeChoiceKey === "pick_a_time" && w.pickStartIso) {
    startsAt = w.pickStartIso;
    endsAt = w.pickEndIso || w.pickStartIso;
  }
  if (share && w.pickSlotDate && w.pickTimeBlock) {
    startsAt = slotDateBlockToStartsAt(w.pickSlotDate, w.pickTimeBlock);
    endsAt = null;
    timeBlock = w.pickTimeBlock;
  }

  return {
    date_type_key: w.dateTypeKey,
    time_choice_key: w.timeChoiceKey,
    place_mode_key: w.placeModeKey,
    venue_text: w.placeModeKey === "custom_venue" ? (w.venueText.trim() || null) : null,
    optional_message: w.optionalMessage.trim() || null,
    schedule_share_enabled: share,
    starts_at: startsAt ?? null,
    ends_at: endsAt ?? null,
    time_block: timeBlock ?? null,
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  matchId: string;
  currentUserId: string;
  partnerUserId: string;
  partnerName: string;
  /** Existing draft suggestion id (optional). */
  draftSuggestionId?: string | null;
  /** Restored from `date_suggestions.draft_payload` (wizard + step). */
  draftFromParent?: { wizard?: Partial<WizardState>; step?: number } | null;
  /** Counter flow: target suggestion + previous revision to prefill. */
  counterContext?: {
    suggestionId: string;
    previousRevision: DateSuggestionRevisionRow;
  } | null;
  onSuccess?: () => void;
};

export function DateSuggestionComposer({
  open,
  onClose,
  matchId,
  currentUserId,
  partnerUserId,
  partnerName,
  draftSuggestionId,
  draftFromParent,
  counterContext,
  onSuccess,
}: Props) {
  const [step, setStep] = useState(0);
  const [w, setW] = useState<WizardState>(defaultWizard);
  const [saving, setSaving] = useState(false);
  const submitInFlightRef = useRef(false);
  const [draftId, setDraftId] = useState<string | null>(draftSuggestionId ?? null);

  const shareEnabled = w.timeChoiceKey === "share_schedule";
  /** Partner grid only when countering (grant exists from their prior share). */
  const { data: partnerSlots = [], isLoading: slotsLoading } = useSharedPartnerSchedule(
    matchId,
    partnerUserId,
    open && shareEnabled && !!counterContext,
  );

  useEffect(() => {
    if (!open) return;
    if (counterContext) {
      const r = counterContext.previousRevision;
      setW({
        dateTypeKey: (r.date_type_key as DateTypeKey) || "coffee",
        timeChoiceKey: (r.time_choice_key as TimeChoiceKey) || "tomorrow",
        placeModeKey: (r.place_mode_key as PlaceModeKey) || "decide_together",
        venueText: r.venue_text || "",
        optionalMessage: r.optional_message || "",
        variantIndex: 0,
        scheduleShareEnabled: r.schedule_share_enabled,
        pickStartIso: r.starts_at,
        pickEndIso: r.ends_at,
        pickSlotDate: null,
        pickTimeBlock: r.time_block,
      });
      setStep(0);
      setDraftId(null);
      return;
    }
    if (draftFromParent?.wizard) {
      setW((prev) => ({ ...defaultWizard(), ...draftFromParent.wizard }));
      if (typeof draftFromParent.step === "number") {
        setStep(Math.min(4, Math.max(0, draftFromParent.step)));
      }
      setDraftId(draftSuggestionId ?? null);
      return;
    }
    setW(defaultWizard());
    setStep(0);
    setDraftId(draftSuggestionId ?? null);
  }, [open, counterContext, draftSuggestionId, draftFromParent]);

  useEffect(() => {
    if (!open) return;
    const v = OPTIONAL_MESSAGE_VARIANTS[w.dateTypeKey] || OPTIONAL_MESSAGE_VARIANTS.custom;
    setW((prev) => ({
      ...prev,
      optionalMessage: v[prev.variantIndex] ?? v[0],
    }));
  }, [open, w.dateTypeKey, w.variantIndex]);

  const submitProposal = async () => {
    if (submitInFlightRef.current || saving) return;
    submitInFlightRef.current = true;
    setSaving(true);
    try {
      const revision = buildRevision(w);
      if (counterContext) {
        await dateSuggestionApply("counter", {
          suggestion_id: counterContext.suggestionId,
          revision,
        });
        toast.success("Counter sent");
      } else {
        const payload: Record<string, unknown> = { revision };
        if (draftId) payload.suggestion_id = draftId;
        else payload.match_id = matchId;
        await dateSuggestionApply("send_proposal", payload);
        toast.success("Date suggestion sent");
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError && e.code === "active_suggestion_exists") {
        if (e.suggestionId) setDraftId(e.suggestionId);
        onSuccess?.();
        onClose();
        toast.message("You already have an active date suggestion in this chat.");
      } else {
        console.error(e);
        toast.error(counterContext ? "Could not send counter" : "Could not send suggestion");
      }
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
    }
  };

  const canNext = () => {
    if (step === 1 && w.timeChoiceKey === "pick_a_time" && !w.pickStartIso) return false;
    if (step === 1 && shareEnabled && counterContext && (!w.pickSlotDate || !w.pickTimeBlock)) {
      return false;
    }
    if (step === 2 && w.placeModeKey === "custom_venue" && !w.venueText.trim()) return false;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md border-border/60 bg-background">
        <DialogHeader>
          <DialogTitle>
            {counterContext ? "Counter proposal" : `Suggest a date with ${partnerName}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 text-xs text-muted-foreground mb-2">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                "px-2 py-0.5 rounded-full",
                i === step ? "bg-primary/20 text-primary font-medium" : "opacity-70",
              )}
            >
              {s}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="grid grid-cols-2 gap-2">
            {DATE_TYPE_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setW((p) => ({ ...p, dateTypeKey: o.key }))}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                  w.dateTypeKey === o.key
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {TIME_CHOICE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() =>
                    setW((p) => ({
                      ...p,
                      timeChoiceKey: o.key,
                      scheduleShareEnabled: o.key === "share_schedule",
                    }))
                  }
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left text-sm",
                    w.timeChoiceKey === o.key
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:bg-muted/50",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {w.timeChoiceKey === "pick_a_time" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Start</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={w.pickStartIso ? w.pickStartIso.slice(0, 16) : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setW((p) => ({
                      ...p,
                      pickStartIso: v ? new Date(v).toISOString() : null,
                    }));
                  }}
                />
              </div>
            )}
            {shareEnabled && !counterContext && (
              <p className="text-xs text-muted-foreground rounded-lg border border-border/50 p-2 bg-muted/20">
                When you send, {partnerName} can view your Vibely Schedule availability for the next
                14 days for 48 hours — live updates, open/busy windows only.
              </p>
            )}
            {shareEnabled && counterContext && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Pick a slot that fits their shared availability (next 14 days).
                </p>
                {slotsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : partnerSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No slots visible yet — try another time option.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border/60 p-2">
                    {partnerSlots.map((s) => (
                      <button
                        key={`${s.slot_key}-${s.time_block}`}
                        type="button"
                        onClick={() =>
                          setW((prev) => ({
                            ...prev,
                            pickSlotDate: s.slot_date,
                            pickTimeBlock: s.time_block,
                          }))
                        }
                        className={cn(
                          "w-full text-left text-xs rounded px-2 py-1",
                          w.pickSlotDate === s.slot_date && w.pickTimeBlock === s.time_block
                            ? "bg-primary/15"
                            : "hover:bg-muted/50",
                        )}
                      >
                        {s.slot_date} · {s.time_block} · {s.status}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 gap-2">
            {PLACE_MODE_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setW((p) => ({ ...p, placeModeKey: o.key }))}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left text-sm",
                  w.placeModeKey === o.key
                    ? "border-primary bg-primary/10"
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                {o.label}
              </button>
            ))}
            {w.placeModeKey === "custom_venue" && (
              <input
                type="text"
                placeholder="Venue name"
                value={w.venueText}
                onChange={(e) => setW((p) => ({ ...p, venueText: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setW((p) => ({ ...p, variantIndex: i }))}
                  className={cn(
                    "text-xs rounded-full px-3 py-1 border",
                    w.variantIndex === i ? "border-primary bg-primary/10" : "border-border/60",
                  )}
                >
                  Variant {i + 1}
                </button>
              ))}
            </div>
            <textarea
              value={w.optionalMessage}
              onChange={(e) => setW((p) => ({ ...p, optionalMessage: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-2 text-sm rounded-xl border border-border/60 p-3 bg-muted/20">
            <p>
              <span className="text-muted-foreground">Type:</span>{" "}
              {DATE_TYPE_OPTIONS.find((x) => x.key === w.dateTypeKey)?.label}
            </p>
            <p>
              <span className="text-muted-foreground">When:</span>{" "}
              {TIME_CHOICE_OPTIONS.find((x) => x.key === w.timeChoiceKey)?.label}
            </p>
            <p>
              <span className="text-muted-foreground">Place:</span>{" "}
              {PLACE_MODE_OPTIONS.find((x) => x.key === w.placeModeKey)?.label}
              {w.placeModeKey === "custom_venue" && w.venueText ? ` — ${w.venueText}` : ""}
            </p>
            <p>
              <span className="text-muted-foreground">Note:</span> {w.optionalMessage}
            </p>
            {shareEnabled && (
              <p className="text-xs text-amber-600/90">
                Your Vibely Schedule will be shared with {partnerName} for 48 hours.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {step < 4 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button type="button" onClick={submitProposal} disabled={saving || !canNext()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : counterContext ? "Send counter" : "Send suggestion"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
