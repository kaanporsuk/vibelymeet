import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Clock, MapPin, Check, X, Loader2, MessageCircle, Ban } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  labelForDateType,
  labelForPlaceMode,
  labelForTimeChoice,
} from "@/lib/dateSuggestionCopy";
import { cn } from "@/lib/utils";
import { formatProposedDateTimeSummary } from "../../../shared/dateSuggestions/formatProposedDateTimeSummary";
import type { ScheduleHubItem } from "../../../shared/schedule/planningHub";

interface MyDatesSectionProps {
  pendingItems: ScheduleHubItem[];
  upcomingItems: ScheduleHubItem[];
  historyItems: ScheduleHubItem[];
  isLoading?: boolean;
  onAccept?: (item: ScheduleHubItem) => void;
  onDecline?: (item: ScheduleHubItem) => void;
  onCancel?: (item: ScheduleHubItem) => void;
  onOpenChat?: (item: ScheduleHubItem) => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  proposed: "Waiting on reply",
  viewed: "Seen",
  countered: "Countered",
  accepted: "Confirmed",
  declined: "Declined",
  not_now: "Not now",
  expired: "Expired",
  cancelled: "Cancelled",
  completed: "Completed",
};

function resolveWhenLabel(item: ScheduleHubItem): string {
  if (item.startsAt) {
    return formatProposedDateTimeSummary(item.startsAt.toISOString()) || labelForTimeChoice(item.timeChoiceKey);
  }
  return labelForTimeChoice(item.timeChoiceKey);
}

function resolvePlaceLabel(item: ScheduleHubItem): string {
  if (item.placeModeKey === "custom_venue" && item.venueText) return item.venueText;
  return labelForPlaceMode(item.placeModeKey);
}

export const MyDatesSection = ({
  pendingItems,
  upcomingItems,
  historyItems,
  isLoading = false,
  onAccept,
  onDecline,
  onCancel,
  onOpenChat,
}: MyDatesSectionProps) => {
  const renderCard = (item: ScheduleHubItem) => {
    const statusLabel = STATUS_LABEL[item.status] ?? item.status;
    const whenLabel = resolveWhenLabel(item);
    const placeLabel = resolvePlaceLabel(item);
    const showResponseActions = item.canAccept || item.canDecline;
    const showCancel = item.canCancel;

    return (
      <motion.div
        key={item.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "rounded-2xl border p-4",
          item.bucket === "upcoming" && "border-emerald-500/30 bg-emerald-500/10",
          item.bucket === "pending" && "border-primary/30 bg-primary/10",
          item.bucket === "history" && "border-border/50 bg-muted/10"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="truncate">{item.partnerName}</span>
              <span className="text-muted-foreground">•</span>
              <span className="truncate text-muted-foreground">{labelForDateType(item.dateTypeKey)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {whenLabel}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3" />
              {placeLabel}
            </div>
            {item.optionalMessage ? (
              <p className="line-clamp-2 text-xs italic text-muted-foreground">
                "{item.optionalMessage}"
              </p>
            ) : null}
          </div>
          <div
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
              item.bucket === "upcoming" && "bg-emerald-500/20 text-emerald-400",
              item.bucket === "pending" && "bg-muted text-muted-foreground",
              item.bucket === "history" && "bg-muted/50 text-muted-foreground",
            )}
          >
            {statusLabel}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {showResponseActions ? (
            <>
              <Button size="sm" className="gap-1" onClick={() => onAccept?.(item)}>
                <Check className="h-3.5 w-3.5" />
                Accept
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => onDecline?.(item)}>
                <X className="h-3.5 w-3.5" />
                Decline
              </Button>
            </>
          ) : null}
          {showCancel ? (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onCancel?.(item)}>
              <Ban className="h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => onOpenChat?.(item)}>
            <MessageCircle className="h-3.5 w-3.5" />
            Open chat
          </Button>
        </div>
      </motion.div>
    );
  };

  const EmptyState = ({ message }: { message: string }) => (
    <div className="py-8 text-center text-muted-foreground text-sm">
      <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
      {message}
    </div>
  );

  return (
    <div className="border-t border-border/50 bg-background/50">
      <div className="p-4">
        <h3 className="text-lg font-display font-semibold text-foreground flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-primary" />
          My Dates
        </h3>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="pending" className="text-xs">
              Pending ({pendingItems.length})
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs">
              Upcoming ({upcomingItems.length})
            </TabsTrigger>
            <TabsTrigger value="past" className="text-xs">
              History ({historyItems.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading plans...
              </div>
            ) : pendingItems.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {pendingItems.map((item) => renderCard(item))}
              </AnimatePresence>
            ) : (
              <EmptyState message="No pending plans or proposals yet." />
            )}
          </TabsContent>

          <TabsContent value="upcoming" className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading plans...
              </div>
            ) : upcomingItems.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {upcomingItems.map((item) => renderCard(item))}
              </AnimatePresence>
            ) : (
              <EmptyState message="No upcoming plans yet." />
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading plans...
              </div>
            ) : historyItems.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {historyItems.map((item) => renderCard(item))}
              </AnimatePresence>
            ) : (
              <EmptyState message="No past plans yet." />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
