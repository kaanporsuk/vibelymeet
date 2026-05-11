import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  labelForDateType,
  labelForTimeChoice,
  labelForPlaceMode,
  buildShareDateText,
  DATE_SAFETY_NOTE,
} from "@/lib/dateSuggestionCopy";
import type { DateSuggestionWithRelations } from "@/hooks/useDateSuggestionData";
import { dateSuggestionApply, DateSuggestionDomainError } from "@/hooks/useDateSuggestionActions";
import { useSharedPartnerSchedule } from "@/hooks/useSharedPartnerSchedule";
import { useCallerScheduleShareGrant } from "@/hooks/useCallerScheduleShareGrant";
import { format } from "date-fns";
import { toast } from "sonner";
import { Calendar, Check, Loader2, Pencil, Sparkles, Share2, X } from "lucide-react";
import type { DateCardThreadUi } from "../../../shared/chat/threadPresentation";
import { getDateSuggestionActionPolicy } from "../../../shared/dateSuggestions/actionPolicy";
import { intersectSlotKeys } from "../../../shared/dateSuggestions/scheduleShare";
import { ExactTimePinSheet } from "./ExactTimePinSheet";
import { ChooseSharedBlockSheet, type OfferedBlock } from "./ChooseSharedBlockSheet";

const TIME_BLOCK_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

function dayLabel(slotDate: string): string {
  try {
    return format(new Date(`${slotDate}T00:00:00`), "EEE MMM d");
  } catch {
    return slotDate;
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  proposed: "Proposed",
  viewed: "Seen",
  countered: "Countered",
  accepted: "Accepted",
  declined: "Declined",
  not_now: "Not now",
  expired: "Expired",
  cancelled: "Cancelled",
  completed: "Completed",
};

function formatWhen(r: {
  time_choice_key: string;
  starts_at: string | null;
  ends_at: string | null;
  time_block: string | null;
}): string {
  if (r.starts_at) {
    try {
      return format(new Date(r.starts_at), "MMM d, h:mm a");
    } catch {
      return r.time_choice_key;
    }
  }
  return labelForTimeChoice(r.time_choice_key);
}

function placeLine(r: { place_mode_key: string; venue_text: string | null }): string {
  if (r.place_mode_key === "custom_venue" && r.venue_text) return tidyDateDisplayText(r.venue_text);
  return labelForPlaceMode(r.place_mode_key);
}

function tidyDateDisplayText(value: string): string {
  return value.replace(/^\[(?:fresh|smoke|test|debug|bootstrap)[^\]]*]\s*/i, "").trim();
}

type Props = {
  suggestion: DateSuggestionWithRelations;
  currentUserId: string;
  partnerName: string;
  partnerUserId: string;
  onOpenComposer: (opts: {
    mode: "new" | "counter" | "editDraft";
    draftId?: string;
    draftPayload?: Record<string, unknown> | null;
    counter?: { suggestionId: string; previousRevision: DateSuggestionWithRelations["revisions"][0] };
  }) => void;
  /** Open the schedule-share picker as a counter response. */
  onShareMyScheduleAsCounter?: (suggestionId: string, previousRevision: DateSuggestionWithRelations["revisions"][0]) => void;
  /**
   * Sender-only entry point: open the picker preloaded with the current
   * actor's selected blocks to edit the SAME active suggestion.
   * Implemented in the parent (Chat.tsx) so the sheet can mount above the
   * thread without remounting the card.
   */
  onEditScheduleShareSlots?: (suggestionId: string) => void;
  onUpdated: () => void;
  /** Thread presentation: older terminal rows render quieter. */
  threadUi?: DateCardThreadUi;
  /**
   * When this token changes, the card briefly pulses to draw attention
   * (used by Chat.tsx to focus the existing card after active_suggestion_exists).
   */
  highlightToken?: number;
};

export function DateSuggestionCard({
  suggestion,
  currentUserId,
  partnerName,
  partnerUserId,
  onOpenComposer,
  onShareMyScheduleAsCounter,
  onEditScheduleShareSlots,
  onUpdated,
  threadUi = "normal",
  highlightToken,
}: Props) {
  const queryClient = useQueryClient();
  const cancelInFlightRef = useRef(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"accept" | "decline" | "not_now" | "share" | "complete" | "cancel_plan" | null>(null);
  const [pendingChosenSlotKey, setPendingChosenSlotKey] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const markedRef = useRef(false);

  useEffect(() => {
    if (highlightToken === undefined) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1500);
    return () => clearTimeout(t);
  }, [highlightToken]);
  const revs = suggestion.revisions;
  const current = useMemo(() => {
    if (suggestion.current_revision_id) {
      return revs.find((r) => r.id === suggestion.current_revision_id) ?? revs[revs.length - 1];
    }
    return revs[revs.length - 1];
  }, [revs, suggestion.current_revision_id]);

  const actionPolicy = getDateSuggestionActionPolicy({
    status: suggestion.status,
    currentUserId,
    proposerId: suggestion.proposer_id,
    recipientId: suggestion.recipient_id,
    currentRevisionProposedBy: current?.proposed_by,
    hasCurrentRevision: Boolean(current),
  });
  const authorOfCurrent = actionPolicy.isAuthorOfCurrent;
  const showAgreedChips =
    revs.length > 1 &&
    current &&
    current.agreed_field_flags &&
    typeof current.agreed_field_flags === "object" &&
    Object.keys(current.agreed_field_flags as object).length > 0;
  const status = suggestion.status;

  useEffect(() => {
    if (!current || markedRef.current) return;
    if (status !== "proposed" && status !== "countered") return;
    if (authorOfCurrent) return;
    markedRef.current = true;
    dateSuggestionApply("mark_viewed", { suggestion_id: suggestion.id }).catch(() => {
      markedRef.current = false;
    });
  }, [suggestion.id, status, authorOfCurrent, current]);

  const agreed = current?.agreed_field_flags as Record<string, boolean> | undefined;
  const optionalNote = current?.optional_message ? tidyDateDisplayText(current.optional_message) : "";
  const actionBusy = cancelBusy || busyAction !== null;

  const isScheduleShare = current?.time_choice_key === "share_schedule";
  const offerAuthorId = current?.proposed_by ?? null;

  // For the Accept-button-driven chooser. React Query dedupes with the same
  // hook call inside ScheduleShareOfferedBlocks, so this does NOT trigger a
  // second network request.
  const accepterOffer = useSharedPartnerSchedule(
    suggestion.match_id,
    offerAuthorId,
    Boolean(
      isScheduleShare &&
        current &&
        status !== "accepted" &&
        status !== "completed" &&
        actionPolicy.canAccept,
    ),
  );

  // Grant-backed Edit gate: the sender-side "Edit selected blocks" affordance
  // only shows when the current user actually owns an active
  // schedule_share_grants row attached to THIS suggestion (as subject). This
  // mirrors the server-side grant-owner authorization for
  // edit_schedule_share_slots, so the UI cannot show Edit when the RPC would
  // refuse it. Deliberately NOT gated on actionPolicy.isAuthorOfCurrent —
  // after the partner counters/shares back, each side must still be able to
  // edit their own grant independently of who authored the current revision.
  const callerGrant = useCallerScheduleShareGrant(
    suggestion.match_id,
    suggestion.id,
    currentUserId,
    Boolean(
      isScheduleShare &&
        current &&
        ["draft", "proposed", "viewed", "countered"].includes(status),
    ),
  );
  const callerHasGrant = callerGrant.data?.hasGrant === true;

  const canEditScheduleShareSlots = Boolean(
    isScheduleShare &&
      current &&
      callerHasGrant &&
      ["draft", "proposed", "viewed", "countered"].includes(status),
  );

  const chooserOfferedBlocks: OfferedBlock[] = useMemo(() => {
    const slots = accepterOffer.data ?? [];
    return slots.map((slot) => ({
      slot_key: slot.slot_key,
      slot_date: slot.slot_date,
      time_block: slot.time_block,
    }));
  }, [accepterOffer.data]);

  const handleAccept = async () => {
    if (actionBusy) return;
    // Schedule-share Accept always follows: Accept → choose block → pin exact
    // time → confirm. Even with a single offered block we still surface the
    // choose-block step so the user explicitly confirms the block.
    if (isScheduleShare) {
      setChooserOpen(true);
      return;
    }
    setBusyAction("accept");
    try {
      await dateSuggestionApply("accept", { suggestion_id: suggestion.id });
      toast.success("It's a date!");
      onUpdated();
    } catch {
      toast.error("Could not accept");
    } finally {
      setBusyAction(null);
    }
  };

  const handleChooserContinue = (slotKey: string) => {
    setChooserOpen(false);
    setPendingChosenSlotKey(slotKey);
  };

  const handleAcceptWithSlot = async (
    slotKey: string,
    startsAtIso: string,
    localStartHour: number,
  ) => {
    if (actionBusy) return;
    setBusyAction("accept");
    try {
      // Start-time-only accept payload. ends_at is deliberately omitted:
      // date duration is not part of the commitment, and the server stores
      // date_plans.ends_at as NULL for schedule-share accepts. The product
      // source of truth for the locked block is chosen_slot_key + starts_at.
      //
      // local_timezone is the IANA zone of the caller's browser at accept
      // time. The server derives local date/hour from
      // `starts_at AT TIME ZONE local_timezone` and enforces:
      //   (a) local date of starts_at == date embedded in chosen_slot_key
      //   (b) local hour falls inside the chosen_slot_key block
      // local_start_hour is kept as a defense-in-depth cross-check; the
      // timezone-derived hour is the server-side authority.
      const localTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!localTimezone) {
        toast.error("Could not read your timezone. Check browser settings and try again.");
        return;
      }
      await dateSuggestionApply("accept", {
        suggestion_id: suggestion.id,
        chosen_slot_key: slotKey,
        starts_at: startsAtIso,
        local_timezone: localTimezone,
        local_start_hour: localStartHour,
      });
      toast.success("It's a date!");
      setPendingChosenSlotKey(null);
      onUpdated();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError) {
        if (e.code === "slot_already_locked") {
          toast.error("That time was just taken by another date.");
        } else if (e.code === "slot_user_busy") {
          toast.error("One of you marked that block busy. Pick another.");
        } else if (e.code === "exact_time_outside_block") {
          toast.error("Pick a time inside the chosen block.");
        } else if (e.code === "slot_not_in_share_grant") {
          toast.error("That time is no longer available. Pick another.");
        } else if (
          e.code === "exact_time_required" ||
          e.code === "invalid_slot_key" ||
          e.code === "local_date_mismatch" ||
          e.code === "local_timezone_required" ||
          e.code === "invalid_local_timezone" ||
          e.code === "local_start_hour_mismatch"
        ) {
          toast.error("Pick a time inside the chosen block.");
        } else {
          toast.error(e.message || "Could not accept");
        }
      } else {
        toast.error("Could not accept");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelPlan = useCallback(async () => {
    if (actionBusy) return;
    const planId = suggestion.date_plan_id;
    if (!planId) {
      toast.message("This date plan is still syncing.");
      return;
    }
    setBusyAction("cancel_plan");
    try {
      await dateSuggestionApply("cancel_plan", { plan_id: planId });
      toast.message("Date cancelled");
      onUpdated();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError && e.code === "invalid_plan_status") {
        toast.message("This date can no longer be cancelled.");
        onUpdated();
      } else {
        toast.error("Could not cancel the date.");
      }
    } finally {
      setBusyAction(null);
    }
  }, [actionBusy, onUpdated, suggestion.date_plan_id]);

  const handleDecline = async () => {
    if (actionBusy) return;
    setBusyAction("decline");
    try {
      await dateSuggestionApply("decline", { suggestion_id: suggestion.id });
      toast.info("Declined");
      onUpdated();
    } catch {
      toast.error("Could not decline");
    } finally {
      setBusyAction(null);
    }
  };

  const handleNotNow = async () => {
    if (actionBusy) return;
    setBusyAction("not_now");
    try {
      await dateSuggestionApply("not_now", { suggestion_id: suggestion.id });
      onUpdated();
    } catch {
      toast.error("Could not update");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = useCallback(async () => {
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setCancelBusy(true);
    try {
      await dateSuggestionApply("cancel", { suggestion_id: suggestion.id });
      onUpdated();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError) {
        const { code } = e;
        if (code === "invalid_status") {
          await queryClient.refetchQueries({ queryKey: ["date-suggestions", suggestion.match_id] });
          const list = queryClient.getQueryData<DateSuggestionWithRelations[]>([
            "date-suggestions",
            suggestion.match_id,
          ]);
          const row = list?.find((s) => s.id === suggestion.id);
          if (row?.status === "cancelled") {
            toast.message("Already cancelled.");
            onUpdated();
            return;
          }
          toast.message("This suggestion can no longer be cancelled.");
          onUpdated();
          return;
        }
        if (code === "forbidden") {
          toast.message("You can only cancel your own suggestions.");
          return;
        }
        if (code === "suggestion_id_required") {
          toast.message("Something went wrong. Try again.");
          return;
        }
        if (code === "not_found") {
          toast.message("This suggestion is no longer available.");
          onUpdated();
          return;
        }
      }
      toast.error("Could not cancel. Try again.");
    } finally {
      cancelInFlightRef.current = false;
      setCancelBusy(false);
    }
  }, [onUpdated, queryClient, suggestion.id, suggestion.match_id]);

  const handleShare = async () => {
    if (actionBusy) return;
    if (!current) return;
    setBusyAction("share");
    const first = partnerName.split(/\s+/)[0] || "Match";
    const body = buildShareDateText({
      partnerFirstName: first,
      dateTypeLabel: labelForDateType(current.date_type_key),
      placeLabel: placeLine(current),
      timeLabel: formatWhen(current),
      optionalMessage: current.optional_message,
    });
    try {
      if (navigator.share) {
        await navigator.share({ title: "Vibely date", text: body });
      } else {
        await navigator.clipboard.writeText(body);
        toast.success("Copied to clipboard");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(body);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Could not share this date");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleMarkComplete = async () => {
    if (actionBusy) return;
    const planId = suggestion.date_plan_id;
    if (!planId) {
      toast.message("This date plan is still syncing.");
      return;
    }
    setBusyAction("complete");
    try {
      await dateSuggestionApply("plan_mark_complete", { plan_id: planId });
      toast.success("Thanks for letting us know");
      onUpdated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("awaiting_partner_confirm")) {
        toast.message("Waiting for your match to confirm");
      } else {
        toast.error("Could not update");
      }
    } finally {
      setBusyAction(null);
    }
  };

  if (!current && status !== "draft") {
    return (
      <div className="rounded-2xl border border-border/50 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        Loading suggestion…
      </div>
    );
  }

  const staleTerminal = ["declined", "expired", "cancelled", "not_now"].includes(status);
  if (staleTerminal) {
    const summary =
      current != null
        ? `${labelForDateType(current.date_type_key)} · ${formatWhen(current)}`
        : "";
    if (threadUi === "quiet_stale") {
      return (
        <div className="w-full rounded-md border border-border/15 bg-muted/[0.04] px-2 py-1 text-[10px] leading-snug text-muted-foreground/70">
          <span className="font-medium text-muted-foreground/80">{STATUS_LABEL[status] ?? status}</span>
          {summary ? <span className="text-muted-foreground/60"> · {summary}</span> : null}
        </div>
      );
    }
    return (
      <div className="w-full rounded-xl border border-border/40 bg-muted/10 px-2.5 py-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground font-medium shrink-0">{STATUS_LABEL[status] ?? status}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto py-0 px-1 text-[10px] shrink-0 text-primary"
            onClick={() => onOpenComposer({ mode: "new" })}
            aria-label="Create a new date suggestion"
            title="Create a new date suggestion"
          >
            New
          </Button>
        </div>
        {summary ? (
          <p className="text-[11px] text-muted-foreground/90 mt-1 leading-snug line-clamp-2">{summary}</p>
        ) : null}
      </div>
    );
  }

  if (status === "completed") {
    if (threadUi === "quiet_completed") {
      const when =
        current != null
          ? `${labelForDateType(current.date_type_key)} · ${formatWhen(current)}`
          : "";
      return (
        <div className="w-full rounded-md border border-border/15 bg-muted/[0.04] px-2 py-1 text-[10px] text-muted-foreground/70 flex items-center gap-1.5">
          <Check className="h-3 w-3 text-emerald-600/70 shrink-0" />
          <span className="truncate">
            Date marked complete
            {when ? <span className="text-muted-foreground/55"> · {when}</span> : null}
          </span>
        </div>
      );
    }
    return (
      <div className="w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-muted-foreground min-w-0 text-[12px]">
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span className="truncate">Date marked complete</span>
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto py-0 px-1 text-[10px] shrink-0 text-primary"
            onClick={() => onOpenComposer({ mode: "new" })}
            aria-label="Create a new date suggestion"
            title="Create a new date suggestion"
          >
            New
          </Button>
        </div>
      </div>
    );
  }

  const showCelebration = status === "accepted";
  const plan = suggestion.date_plan;
  const myParticipant = plan?.participants?.find((p) => p.user_id === currentUserId);

  return (
    <div
      data-suggestion-id={suggestion.id}
      className={cn(
        "w-full rounded-xl border px-3 py-2 text-sm shadow-sm transition-all duration-300",
        showCelebration
          ? "border-primary/40 bg-gradient-to-br from-primary/15 to-transparent"
          : "border-border/60 bg-card/80 backdrop-blur-sm",
        pulse && "ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse",
      )}
    >
      {showCelebration && (
        <div className="flex items-center gap-1.5 mb-1 text-primary">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="text-sm font-semibold leading-tight">It&apos;s a date!</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-medium text-muted-foreground/90">
          Date idea
        </span>
        <span
          className={cn(
            "text-[10px] px-2 py-0.5 rounded-full border",
            status === "accepted" && "border-primary/50 text-primary",
            status === "completed" && "border-emerald-500/50 text-emerald-600",
            ["expired", "declined", "cancelled", "not_now"].includes(status) &&
              "border-muted-foreground/40 text-muted-foreground",
          )}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {current && (
        <>
          <div className="space-y-0.5 text-[13px] leading-snug">
            <p>
              <span className="text-muted-foreground text-xs">Type</span>{" "}
              {showAgreedChips && agreed?.date_type ? (
                <span>
                  <AgreedChip /> {labelForDateType(current.date_type_key)}
                </span>
              ) : (
                labelForDateType(current.date_type_key)
              )}
            </p>
            <p>
              <span className="text-muted-foreground text-xs">When</span>{" "}
              {showAgreedChips && agreed?.time ? (
                <span>
                  <AgreedChip /> {formatWhen(current)}
                </span>
              ) : (
                formatWhen(current)
              )}
            </p>
            {current.schedule_share_enabled && (
              <p className="text-xs text-cyan-600/90 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Vibely Schedule shared (48h live windows)
              </p>
            )}
            <p>
              <span className="text-muted-foreground text-xs">Place</span>{" "}
              {showAgreedChips && agreed?.place ? (
                <span>
                  <AgreedChip /> {placeLine(current)}
                </span>
              ) : (
                placeLine(current)
              )}
            </p>
            {optionalNote.length > 0 && (
              <p>
                <span className="text-muted-foreground text-xs">Note</span>{" "}
                {showAgreedChips && agreed?.optional_message ? (
                  <span>
                    <AgreedChip /> {optionalNote}
                  </span>
                ) : (
                  optionalNote
                )}
              </p>
            )}
          </div>
        </>
      )}

      {isScheduleShare && current && status !== "accepted" && status !== "completed" && (
        <ScheduleShareOfferedBlocks
          matchId={suggestion.match_id}
          currentUserId={currentUserId}
          offerAuthorId={current.proposed_by}
          otherSideId={
            current.proposed_by === suggestion.proposer_id
              ? suggestion.recipient_id
              : suggestion.proposer_id
          }
          partnerName={partnerName}
          canPick={actionPolicy.canAccept && !actionBusy}
          onPickSlot={(slotKey) => setPendingChosenSlotKey(slotKey)}
        />
      )}

      {status === "accepted" && plan && (
        <div className="mt-2 rounded-lg border border-border/50 bg-background/50 p-1.5 space-y-0.5">
          <p className="text-xs font-medium flex items-center gap-1 text-emerald-600">
            <Check className="h-3.5 w-3.5" />
            In your Vibely Calendar
          </p>
          {myParticipant && (
            <p className="text-xs text-muted-foreground">{myParticipant.calendar_title}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{DATE_SAFETY_NOTE}</p>
        </div>
      )}

      <ChooseSharedBlockSheet
        isOpen={chooserOpen}
        onClose={() => setChooserOpen(false)}
        offeredBlocks={chooserOfferedBlocks}
        isLoading={accepterOffer.isLoading}
        isError={accepterOffer.isError}
        partnerName={partnerName}
        onContinue={handleChooserContinue}
      />

      <ExactTimePinSheet
        isOpen={pendingChosenSlotKey !== null}
        chosenSlotKey={pendingChosenSlotKey ?? ""}
        onClose={() => setPendingChosenSlotKey(null)}
        onConfirm={(startsAt, localHour) =>
          pendingChosenSlotKey
            ? handleAcceptWithSlot(pendingChosenSlotKey, startsAt, localHour)
            : Promise.resolve()
        }
        isSubmitting={busyAction === "accept"}
      />

      <div className="mt-2.5 flex flex-wrap gap-2">
        {actionPolicy.canEditDraft && (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={actionBusy}
              onClick={() =>
                onOpenComposer({
                  mode: "editDraft",
                  draftId: suggestion.id,
                  draftPayload: suggestion.draft_payload,
                })
              }
              aria-label="Continue date draft"
              title="Continue date draft"
            >
              Continue draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={actionBusy}
              aria-label="Discard date draft"
              title="Discard date draft"
            >
              {cancelBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Discard
            </Button>
          </>
        )}

        {actionPolicy.canRespondToCurrent && (
          <>
            {actionPolicy.canAccept && (
              <Button
                type="button"
                size="sm"
                onClick={handleAccept}
                disabled={actionBusy}
                aria-label="Accept date suggestion"
                title="Accept date suggestion"
              >
                {busyAction === "accept" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Accept
              </Button>
            )}
            {actionPolicy.canCounter && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={actionBusy}
                onClick={() =>
                  current &&
                  onOpenComposer({
                    mode: "counter",
                    counter: { suggestionId: suggestion.id, previousRevision: current },
                  })
                }
                aria-label="Counter date suggestion"
                title="Counter date suggestion"
              >
                Counter
              </Button>
            )}
            {actionPolicy.canNotNow && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleNotNow}
                disabled={actionBusy}
                aria-label="Respond not now"
                title="Not now"
              >
                {busyAction === "not_now" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Not now
              </Button>
            )}
            {actionPolicy.canDecline && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleDecline}
                disabled={actionBusy}
                aria-label="Decline date suggestion"
                title="Decline date suggestion"
              >
                {busyAction === "decline" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Decline
              </Button>
            )}
          </>
        )}

        {canEditScheduleShareSlots && onEditScheduleShareSlots && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEditScheduleShareSlots(suggestion.id)}
            disabled={actionBusy}
            aria-label="Edit selected blocks"
            title="Edit selected blocks"
            className="gap-1"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit selected blocks
          </Button>
        )}

        {actionPolicy.canCancel && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={actionBusy}
            aria-label="Cancel date suggestion"
            title="Cancel date suggestion"
          >
            {cancelBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Cancel
          </Button>
        )}

        {status === "accepted" && (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleShare}
              disabled={actionBusy}
              className="gap-1"
              aria-label="Share the accepted date"
              title="Share the date"
            >
              {busyAction === "share" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
              Share the date
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleMarkComplete}
              disabled={actionBusy}
              aria-label="Mark date complete"
              title="Mark complete"
            >
              {busyAction === "complete" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Mark complete
            </Button>
            {suggestion.date_plan_id && plan?.status === "active" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCancelPlan}
                disabled={actionBusy}
                className="gap-1 text-muted-foreground hover:text-destructive"
                aria-label="Cancel the date"
                title="Cancel the date"
              >
                {busyAction === "cancel_plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Cancel date
              </Button>
            )}
          </>
        )}

        {isScheduleShare && actionPolicy.canRespondToCurrent && onShareMyScheduleAsCounter && current && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actionBusy}
            onClick={() => onShareMyScheduleAsCounter(suggestion.id, current)}
            aria-label="Share my Vibely Schedule"
            title="Share my Vibely Schedule"
            className="gap-1"
          >
            <Calendar className="h-3.5 w-3.5" />
            Share my Vibely Schedule
          </Button>
        )}

      </div>
    </div>
  );
}

/**
 * Renders the latest schedule-share offer's blocks as chips, grouped by day.
 * Marks blocks that the OTHER side also offered (mutual overlap) as "Both open".
 * The non-author of the current revision can tap a chip to start exact-time pin.
 *
 * `offerAuthorId` is the current revision's `proposed_by` — whoever shared most
 * recently. Their slots are the chips. After a counter, this flips correctly.
 */
function ScheduleShareOfferedBlocks({
  matchId,
  currentUserId,
  offerAuthorId,
  otherSideId,
  partnerName,
  canPick,
  onPickSlot,
}: {
  matchId: string;
  currentUserId: string;
  offerAuthorId: string;
  otherSideId: string;
  partnerName: string;
  canPick: boolean;
  onPickSlot: (slotKey: string) => void;
}) {
  const isOwnOffer = offerAuthorId === currentUserId;

  // Chips: whatever the latest offer-author shared (works for either side via
  // get_shared_schedule_for_date_planning's "viewer OR subject" check).
  const chipsOffer = useSharedPartnerSchedule(matchId, offerAuthorId, true);
  // Mutual: the OTHER side's offered blocks (if they shared in any prior revision).
  // Returns grant_required if they haven't shared — handled gracefully (no mutual chips).
  const otherOffer = useSharedPartnerSchedule(matchId, otherSideId, true);

  const chipsSlots = chipsOffer.data ?? [];
  const chipsSlotKeys = useMemo(() => chipsSlots.map((s) => s.slot_key), [chipsSlots]);
  const otherSlotKeys = useMemo(
    () => (otherOffer.data ?? []).map((s) => s.slot_key),
    [otherOffer.data],
  );
  const mutualSet = useMemo(
    () => new Set(intersectSlotKeys(chipsSlotKeys, otherSlotKeys)),
    [chipsSlotKeys, otherSlotKeys],
  );

  const grouped = useMemo(() => {
    const byDay = new Map<string, Array<{ slot_key: string; time_block: string; mutual: boolean }>>();
    for (const slot of chipsSlots) {
      const mutual = mutualSet.has(slot.slot_key);
      const arr = byDay.get(slot.slot_date) ?? [];
      arr.push({ slot_key: slot.slot_key, time_block: slot.time_block, mutual });
      byDay.set(slot.slot_date, arr);
    }
    const blockOrder: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, night: 3 };
    for (const arr of byDay.values()) {
      arr.sort((a, b) => (blockOrder[a.time_block] ?? 9) - (blockOrder[b.time_block] ?? 9));
    }
    return Array.from(byDay.entries())
      .sort(([dateA, slotsA], [dateB, slotsB]) => {
        const aHasMutual = slotsA.some((s) => s.mutual) ? 0 : 1;
        const bHasMutual = slotsB.some((s) => s.mutual) ? 0 : 1;
        if (aHasMutual !== bHasMutual) return aHasMutual - bHasMutual;
        return dateA.localeCompare(dateB);
      });
  }, [chipsSlots, mutualSet]);

  if (chipsOffer.isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading offered blocks…
      </div>
    );
  }

  if (chipsOffer.isError) {
    // The author's grant is missing or expired — only meaningful for the partner
    // (not for the author themselves, who knows they shared).
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        {isOwnOffer
          ? "Your share window has expired. Share again to keep planning."
          : "Schedule access expired — share again to plan."}
      </div>
    );
  }

  if (chipsSlots.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border/40 bg-muted/10 p-2 text-xs text-muted-foreground">
        {isOwnOffer
          ? "No currently-visible blocks. (Some may have changed since you shared.)"
          : `${partnerName} hasn't shared open blocks that align right now.`}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        {isOwnOffer
          ? `You shared these open blocks. Waiting for ${partnerName} to pick or share back.`
          : `${partnerName} shared these open blocks. Tap to pick one or share yours back.`}
      </p>
      <div className="space-y-1">
        {grouped.map(([dayDate, slots]) => (
          <div key={dayDate} className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] font-medium text-muted-foreground w-20 shrink-0">
              {dayLabel(dayDate)}
            </span>
            {slots.map((slot) => {
              const canTap = !isOwnOffer && canPick;
              return (
              <button
                key={slot.slot_key}
                type="button"
                disabled={!canTap}
                onClick={() => canTap && onPickSlot(slot.slot_key)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
                  slot.mutual
                    ? "bg-amber-500/15 border-amber-400/60 text-amber-700 dark:text-amber-300"
                    : "bg-cyan-500/10 border-cyan-400/50 text-cyan-700 dark:text-cyan-300",
                  canTap && "hover:bg-primary/20 hover:border-primary cursor-pointer",
                  !canTap && "cursor-default opacity-90",
                )}
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
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        Only selected open blocks are shared. Visible for 48 hours.
      </p>
    </div>
  );
}

function AgreedChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] px-1.5 py-0 mr-1 font-medium">
      Agreed
    </span>
  );
}
