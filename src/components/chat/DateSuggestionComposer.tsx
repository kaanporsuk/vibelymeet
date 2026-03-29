import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { startOfDay, isBefore } from "date-fns";
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
import { ChevronLeft, ChevronRight, Clock, Loader2, Sparkles } from "lucide-react";
import {
  CLIP_DATE_COMPOSER_PILL,
  CLIP_DATE_COMPOSER_SUBCOPY,
  type DateComposerLaunchSource,
} from "../../../shared/dateSuggestions/dateComposerLaunch";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import { threadBucketFromCount } from "../../../shared/chat/vibeClipAnalytics";
import { formatProposedDateTimeSummary } from "../../../shared/dateSuggestions/formatProposedDateTimeSummary";

const STEPS = ["Type", "When", "Place", "Message", "Review"] as const;

const MINUTE_STEP = 5;
const MINUTE_OPTIONS = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const HOUR12_OPTIONS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

function wallTimePartsFromDate(d: Date): { hour12: number; minute: number; ampm: "AM" | "PM" } {
  const h = d.getHours();
  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const rawMin = d.getMinutes();
  const minute = Math.min(55, Math.round(rawMin / MINUTE_STEP) * MINUTE_STEP);
  return { hour12: h12, minute: minute, ampm };
}

function mergeDayAndWallTime(day: Date, hour12: number, minute: number, ampm: "AM" | "PM"): Date {
  const out = startOfDay(day);
  let h24 = hour12 % 12;
  if (ampm === "PM" && hour12 !== 12) h24 += 12;
  if (ampm === "AM" && hour12 === 12) h24 = 0;
  out.setHours(h24, minute, 0, 0);
  return out;
}

const DATE_TYPE_KEYS = new Set<string>(DATE_TYPE_OPTIONS.map((o) => o.key));

export type WizardState = {
  dateTypeKey: DateTypeKey;
  customDateTypeText: string;
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
  customDateTypeText: "",
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

function resolveDateTypeValue(w: Pick<WizardState, "dateTypeKey" | "customDateTypeText">): string {
  if (w.dateTypeKey !== "custom") return w.dateTypeKey;
  return w.customDateTypeText.trim();
}

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
    date_type_key: resolveDateTypeValue(w),
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
  /** Client-only; does not change persisted suggestion payload. */
  launchSource?: DateComposerLaunchSource;
  onSuccess?: () => void;
  /** For analytics (thread warm/cold bucket). */
  threadMessageCount?: number;
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
  launchSource = "default",
  onSuccess,
  threadMessageCount = 0,
}: Props) {
  const [step, setStep] = useState(0);
  const [w, setW] = useState<WizardState>(defaultWizard);
  const [saving, setSaving] = useState(false);
  const submitInFlightRef = useRef(false);
  const [draftId, setDraftId] = useState<string | null>(draftSuggestionId ?? null);

  /** Inline date → time flow for "Pick a time" (no fragile datetime-local). */
  const [pickFlowOpen, setPickFlowOpen] = useState(false);
  const [pickPhase, setPickPhase] = useState<"date" | "time">("date");
  const [pickDay, setPickDay] = useState<Date>(() => startOfDay(new Date()));
  const [pickHour12, setPickHour12] = useState(7);
  const [pickMinute, setPickMinute] = useState(30);
  const [pickAmPm, setPickAmPm] = useState<"AM" | "PM">("PM");

  const openPickFlow = useCallback(() => {
    const base = w.pickStartIso ? new Date(w.pickStartIso) : new Date();
    const wall = wallTimePartsFromDate(base);
    setPickDay(startOfDay(base));
    setPickHour12(wall.hour12);
    setPickMinute(wall.minute);
    setPickAmPm(wall.ampm);
    setPickPhase("date");
    setPickFlowOpen(true);
  }, [w.pickStartIso]);

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
      const incomingType = (r.date_type_key ?? "").trim();
      const hasKnownType = incomingType.length > 0 && DATE_TYPE_KEYS.has(incomingType);
      setW({
        dateTypeKey: (hasKnownType ? incomingType : "custom") as DateTypeKey,
        customDateTypeText: hasKnownType ? "" : incomingType,
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
      setW(() => {
        const next = { ...defaultWizard(), ...draftFromParent.wizard };
        const incomingType = typeof next.dateTypeKey === "string" ? next.dateTypeKey.trim() : "";
        const incomingCustom =
          typeof next.customDateTypeText === "string" ? next.customDateTypeText : "";
        if (!incomingType) return { ...next, dateTypeKey: "coffee", customDateTypeText: "" };
        if (DATE_TYPE_KEYS.has(incomingType))
          return { ...next, dateTypeKey: incomingType as DateTypeKey };
        return {
          ...next,
          dateTypeKey: "custom",
          customDateTypeText: incomingCustom || incomingType,
        };
      });
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
    if (w.timeChoiceKey !== "pick_a_time") setPickFlowOpen(false);
  }, [w.timeChoiceKey]);

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
      if (launchSource === "vibe_clip" && !counterContext) {
        trackVibeClipEvent("clip_date_submitted_from_clip", {
          thread_bucket: threadBucketFromCount(threadMessageCount),
        });
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
    if (step === 0 && w.dateTypeKey === "custom" && !w.customDateTypeText.trim()) return false;
    if (step === 1 && w.timeChoiceKey === "pick_a_time" && !w.pickStartIso) return false;
    if (step === 1 && shareEnabled && counterContext && (!w.pickSlotDate || !w.pickTimeBlock)) {
      return false;
    }
    if (step === 2 && w.placeModeKey === "custom_venue" && !w.venueText.trim()) return false;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto border-border/60 bg-background shadow-2xl shadow-black/45",
          "w-[min(100vw-1.5rem,100%)]",
          step === 1 ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {counterContext ? "Counter proposal" : `Suggest a date with ${partnerName}`}
          </DialogTitle>
        </DialogHeader>

        {launchSource === "vibe_clip" && !counterContext && (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 mb-3 space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-200/95">
              <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
              {CLIP_DATE_COMPOSER_PILL}
            </div>
            <p className="text-xs text-muted-foreground leading-snug">{CLIP_DATE_COMPOSER_SUBCOPY}</p>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                "rounded-full px-2.5 py-1 transition-colors",
                i === step ? "bg-primary/20 font-medium text-primary" : "opacity-65",
              )}
            >
              {s}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {DATE_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() =>
                    setW((p) => ({
                      ...p,
                      dateTypeKey: o.key,
                      customDateTypeText: o.key === "custom" ? p.customDateTypeText : "",
                      variantIndex: 0,
                    }))
                  }
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
            {w.dateTypeKey === "custom" ? (
              <div className="space-y-1.5 w-full">
                <Input
                  placeholder="What do you have in mind?"
                  value={w.customDateTypeText}
                  onChange={(e) => setW((p) => ({ ...p, customDateTypeText: e.target.value }))}
                  className="rounded-lg text-sm h-auto min-h-10 py-2.5"
                />
                {!w.customDateTypeText.trim() ? (
                  <p className="text-xs text-muted-foreground">Add a custom type to continue.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-2.5">
              {TIME_CHOICE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() =>
                    setW((p) => ({
                      ...p,
                      timeChoiceKey: o.key,
                      scheduleShareEnabled: o.key === "share_schedule",
                      ...(o.key !== "pick_a_time" ? { pickStartIso: null, pickEndIso: null } : {}),
                    }))
                  }
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left text-sm leading-snug transition-colors",
                    w.timeChoiceKey === o.key
                      ? "border-violet-500/45 bg-violet-500/10 text-foreground shadow-[0_0_0_1px_rgba(139,92,246,0.12)]"
                      : "border-border/60 hover:bg-muted/40",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {w.timeChoiceKey === "pick_a_time" && (
              <div
                className={cn(
                  "space-y-4 rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/[0.08] via-muted/5 to-muted/10 p-4 sm:p-5",
                  "ring-1 ring-inset ring-white/[0.04]",
                )}
              >
                {!pickFlowOpen ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
                        <Clock className="h-5 w-5" aria-hidden />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">
                          Proposed time
                        </p>
                        <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-xl">
                          {w.pickStartIso
                            ? formatProposedDateTimeSummary(w.pickStartIso)
                            : "Pick a day, then a time — you’ll preview it here."}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-11 w-full shrink-0 border-violet-500/25 bg-violet-500/10 px-5 text-sm font-semibold text-foreground hover:bg-violet-500/18 sm:w-auto"
                      onClick={openPickFlow}
                    >
                      {w.pickStartIso ? "Edit date & time" : "Choose date & time"}
                    </Button>
                  </div>
                ) : (
                  <>
                    {pickPhase === "date" ? (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Select a date. Past days aren’t available.
                        </p>
                        <div className="flex justify-center rounded-xl border border-border/40 bg-background/40 p-2">
                          <Calendar
                            mode="single"
                            selected={pickDay}
                            onSelect={(d) => {
                              if (!d) return;
                              setPickDay(startOfDay(d));
                              setPickPhase("time");
                            }}
                            disabled={(date) => isBefore(startOfDay(date), startOfDay(new Date()))}
                            initialFocus
                            className="mx-auto"
                          />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                          <Button type="button" variant="ghost" className="order-2 sm:order-1" onClick={() => setPickFlowOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="order-1 border-violet-500/30 sm:order-2"
                            onClick={() => setPickPhase("time")}
                          >
                            Next: time
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">Set the time</p>
                            <p className="text-xs text-muted-foreground">Fine-tune hour and minute for the day you chose.</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 shrink-0 self-start text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 sm:self-center"
                            onClick={() => setPickPhase("date")}
                          >
                            Change date
                          </Button>
                        </div>

                        <div className="rounded-xl border border-violet-500/15 bg-background/50 px-4 py-4 text-center ring-1 ring-inset ring-white/[0.03]">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">Preview</p>
                          <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-primary sm:text-2xl">
                            {formatProposedDateTimeSummary(
                              mergeDayAndWallTime(pickDay, pickHour12, pickMinute, pickAmPm).toISOString(),
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                          <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            Time
                          </p>
                          <div className="grid grid-cols-3 gap-3 sm:gap-4">
                            <div className="space-y-2">
                              <span className="block text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Hour
                              </span>
                              <select
                                className="h-11 w-full rounded-xl border border-violet-500/20 bg-background px-2 text-center text-sm font-medium shadow-sm focus:border-violet-500/45 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                value={pickHour12}
                                onChange={(e) => setPickHour12(Number(e.target.value))}
                                aria-label="Hour"
                              >
                                {HOUR12_OPTIONS.map((h) => (
                                  <option key={h} value={h}>
                                    {h}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <span className="block text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Minute
                              </span>
                              <select
                                className="h-11 w-full rounded-xl border border-violet-500/20 bg-background px-2 text-center text-sm font-medium shadow-sm focus:border-violet-500/45 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                value={pickMinute}
                                onChange={(e) => setPickMinute(Number(e.target.value))}
                                aria-label="Minute"
                              >
                                {MINUTE_OPTIONS.map((m) => (
                                  <option key={m} value={m}>
                                    {m.toString().padStart(2, "0")}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <span className="block text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Period
                              </span>
                              <select
                                className="h-11 w-full rounded-xl border border-violet-500/20 bg-background px-2 text-center text-sm font-medium shadow-sm focus:border-violet-500/45 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                value={pickAmPm}
                                onChange={(e) => setPickAmPm(e.target.value as "AM" | "PM")}
                                aria-label="AM or PM"
                              >
                                <option value="AM">AM</option>
                                <option value="PM">PM</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end sm:gap-3">
                          <Button type="button" variant="outline" className="sm:min-w-[7rem]" onClick={() => setPickFlowOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            className="bg-primary sm:min-w-[7rem]"
                            onClick={() => {
                              const merged = mergeDayAndWallTime(pickDay, pickHour12, pickMinute, pickAmPm);
                              setW((p) => ({
                                ...p,
                                pickStartIso: merged.toISOString(),
                                pickEndIso: merged.toISOString(),
                              }));
                              setPickFlowOpen(false);
                            }}
                          >
                            Save time
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
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
          <div className="space-y-3 rounded-2xl border border-border/50 bg-muted/15 p-4 text-sm ring-1 ring-inset ring-white/[0.03]">
            <p>
              <span className="text-muted-foreground">Type:</span>{" "}
              {w.dateTypeKey === "custom"
                ? w.customDateTypeText.trim() || "Custom"
                : DATE_TYPE_OPTIONS.find((x) => x.key === w.dateTypeKey)?.label}
            </p>
            <p>
              <span className="text-muted-foreground">When:</span>{" "}
              {w.timeChoiceKey === "pick_a_time" && w.pickStartIso
                ? formatProposedDateTimeSummary(w.pickStartIso)
                : TIME_CHOICE_OPTIONS.find((x) => x.key === w.timeChoiceKey)?.label}
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

        <DialogFooter className="mt-2 flex-col gap-3 border-t border-border/40 pt-6 sm:flex-row sm:justify-end">
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
