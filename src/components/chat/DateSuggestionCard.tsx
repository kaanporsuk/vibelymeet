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
import { format } from "date-fns";
import { toast } from "sonner";
import { Calendar, Check, Sparkles, Share2 } from "lucide-react";

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
  if (r.place_mode_key === "custom_venue" && r.venue_text) return r.venue_text;
  return labelForPlaceMode(r.place_mode_key);
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
  onUpdated: () => void;
};

export function DateSuggestionCard({
  suggestion,
  currentUserId,
  partnerName,
  partnerUserId,
  onOpenComposer,
  onUpdated,
}: Props) {
  const queryClient = useQueryClient();
  const cancelInFlightRef = useRef(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const markedRef = useRef(false);
  const revs = suggestion.revisions;
  const current = useMemo(() => {
    if (suggestion.current_revision_id) {
      return revs.find((r) => r.id === suggestion.current_revision_id) ?? revs[revs.length - 1];
    }
    return revs[revs.length - 1];
  }, [revs, suggestion.current_revision_id]);

  const isProposer = suggestion.proposer_id === currentUserId;
  const originalRecipient = suggestion.recipient_id === currentUserId;
  const authorOfCurrent = current?.proposed_by === currentUserId;
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
  const optionalNote = current?.optional_message?.trim() ?? "";

  const handleAccept = async () => {
    try {
      await dateSuggestionApply("accept", { suggestion_id: suggestion.id });
      toast.success("It's a date!");
      onUpdated();
    } catch {
      toast.error("Could not accept");
    }
  };

  const handleDecline = async () => {
    try {
      await dateSuggestionApply("decline", { suggestion_id: suggestion.id });
      toast.info("Declined");
      onUpdated();
    } catch {
      toast.error("Could not decline");
    }
  };

  const handleNotNow = async () => {
    try {
      await dateSuggestionApply("not_now", { suggestion_id: suggestion.id });
      onUpdated();
    } catch {
      toast.error("Could not update");
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
    if (!current) return;
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
      await navigator.clipboard.writeText(body);
      toast.success("Copied to clipboard");
    }
  };

  const handleMarkComplete = async () => {
    const planId = suggestion.date_plan_id;
    if (!planId) return;
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
    return (
      <div className="max-w-[92%] rounded-xl border border-border/40 bg-muted/10 px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground font-medium shrink-0">{STATUS_LABEL[status] ?? status}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] shrink-0 text-primary"
            onClick={() => onOpenComposer({ mode: "new" })}
          >
            New suggestion
          </Button>
        </div>
        {summary ? (
          <p className="text-[11px] text-muted-foreground/90 mt-1 leading-snug line-clamp-2">{summary}</p>
        ) : null}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="max-w-[92%] rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-muted-foreground min-w-0 text-[12px]">
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span className="truncate">Date marked complete</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] shrink-0 text-primary"
            onClick={() => onOpenComposer({ mode: "new" })}
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
      className={cn(
        "max-w-[92%] rounded-2xl border px-2.5 py-2.5 text-sm shadow-sm",
        showCelebration
          ? "border-primary/40 bg-gradient-to-br from-primary/15 to-transparent"
          : "border-border/60 bg-card/80 backdrop-blur-sm",
      )}
    >
      {showCelebration && (
        <div className="flex items-center gap-2 mb-1.5 text-primary">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="font-semibold">It&apos;s a date!</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Date
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
          <div className="space-y-1">
            <p>
              <span className="text-muted-foreground">Type:</span>{" "}
              {showAgreedChips && agreed?.date_type ? (
                <span>
                  <AgreedChip /> {labelForDateType(current.date_type_key)}
                </span>
              ) : (
                labelForDateType(current.date_type_key)
              )}
            </p>
            <p>
              <span className="text-muted-foreground">When:</span>{" "}
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
              <span className="text-muted-foreground">Place:</span>{" "}
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
                <span className="text-muted-foreground">Note:</span>{" "}
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

      {status === "accepted" && plan && (
        <div className="mt-3 rounded-xl border border-border/50 bg-background/50 p-2 space-y-1">
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

      <div className="mt-2.5 flex flex-wrap gap-2">
        {status === "draft" && isProposer && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onOpenComposer({
                  mode: "editDraft",
                  draftId: suggestion.id,
                  draftPayload: suggestion.draft_payload,
                })
              }
            >
              Continue draft
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel} disabled={cancelBusy}>
              Discard
            </Button>
          </>
        )}

        {["proposed", "viewed", "countered"].includes(status) && !authorOfCurrent && (
          <>
            <Button size="sm" onClick={handleAccept}>
              Accept
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                current &&
                onOpenComposer({
                  mode: "counter",
                  counter: { suggestionId: suggestion.id, previousRevision: current },
                })
              }
            >
              Counter
            </Button>
            <Button size="sm" variant="outline" onClick={handleNotNow}>
              Not now
            </Button>
            {originalRecipient && (
              <Button size="sm" variant="ghost" onClick={handleDecline}>
                Decline
              </Button>
            )}
          </>
        )}

        {["proposed", "viewed", "countered", "draft"].includes(status) && isProposer && (
          <Button size="sm" variant="outline" onClick={handleCancel} disabled={cancelBusy}>
            Cancel
          </Button>
        )}

        {status === "accepted" && (
          <>
            <Button size="sm" variant="secondary" onClick={handleShare} className="gap-1">
              <Share2 className="h-3.5 w-3.5" />
              Share the date
            </Button>
            <Button size="sm" variant="outline" onClick={handleMarkComplete}>
              Mark complete
            </Button>
          </>
        )}

      </div>
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
