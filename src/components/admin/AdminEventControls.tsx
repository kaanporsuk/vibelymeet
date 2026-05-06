import { useState } from "react";
import { motion } from "framer-motion";
import { StopCircle, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendNotification } from "@/lib/notifications";
import AdminConfirmDialog from "./AdminConfirmDialog";

interface AdminEventControlsProps {
  eventId: string;
  eventTitle: string;
  rawStatus: string | null;
  computedStatus: string;
  endedAt?: string | null;
  archivedAt?: string | null;
  durationMinutes: number | null;
}

type PendingEventControlAction =
  | { kind: "go-live" }
  | { kind: "end" }
  | { kind: "extend"; minutes: number }
  | { kind: "reminder" }
  | null;

const AdminEventControls = ({
  eventId,
  eventTitle,
  rawStatus,
  computedStatus,
  endedAt,
  archivedAt,
  durationMinutes,
}: AdminEventControlsProps) => {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<PendingEventControlAction>(null);
  const [reminderSentAt, setReminderSentAt] = useState<number | null>(null);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);

  /** Confirmed seats only (lobby-eligible). Waitlist excluded. */
  const notifyRegistrantsConfirmedOnly = async (category: string, title: string, body: string) => {
    const { data: registrations } = await supabase
      .from("event_registrations")
      .select("profile_id")
      .eq("event_id", eventId)
      .eq("admission_status", "confirmed");

    if (registrations) {
      await Promise.allSettled(
        registrations.filter((r) => Boolean(r.profile_id)).map((r) =>
          sendNotification({
            user_id: r.profile_id,
            category,
            title,
            body,
            data: { url: `/event/${eventId}/lobby`, event_id: eventId, admission_status: "confirmed" },
          })
        )
      );
    }
    return registrations?.length || 0;
  };

  /** Confirmed + waitlisted (everyone on the guest list except canceled/other statuses). */
  const notifyRegistrantsConfirmedAndWaitlist = async (
    category: string,
    title: string,
    confirmedBody: string,
    waitlistedBody: string
  ) => {
    const { data: registrations } = await supabase
      .from("event_registrations")
      .select("profile_id, admission_status")
      .eq("event_id", eventId)
      .in("admission_status", ["confirmed", "waitlisted"]);

    if (registrations) {
      await Promise.allSettled(
        registrations.filter((r) => Boolean(r.profile_id)).map((r) =>
          sendNotification({
            user_id: r.profile_id,
            category,
            title,
            body: r.admission_status === "waitlisted" ? waitlistedBody : confirmedBody,
            data: {
              event_id: eventId,
              admission_status: r.admission_status,
            },
          })
        )
      );
    }
    return registrations?.length || 0;
  };

  const endEvent = useMutation({
    mutationFn: async () => {
      const endedAt = new Date().toISOString();
      const { error } = await supabase
        .from("events")
        .update({ status: "ended", ended_at: endedAt })
        .eq("id", eventId);
      if (error) throw error;

      const channel = supabase.channel(`event-status-${eventId}`);
      await channel.send({
        type: "broadcast",
        event: "event_ended",
        payload: { eventId },
      });
      supabase.removeChannel(channel);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["visible-events"] });
      toast.success(`"${eventTitle}" has been ended`);
    },
    onError: () => toast.error("Failed to end event"),
  });

  const extendEvent = useMutation({
    mutationFn: async (extraMinutes: number) => {
      const newDuration = (durationMinutes || 60) + extraMinutes;
      const { error } = await supabase
        .from("events")
        .update({ duration_minutes: newDuration })
        .eq("id", eventId);
      if (error) throw error;
      return extraMinutes;
    },
    onSuccess: (extraMinutes) => {
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Extended "${eventTitle}" by ${extraMinutes} minutes`);
    },
    onError: () => toast.error("Failed to extend event"),
  });

  const normalizedRawStatus = rawStatus?.toLowerCase() || "";
  const normalizedComputedStatus = computedStatus.toLowerCase();
  const isArchived = Boolean(archivedAt);
  const isDraft = normalizedRawStatus === "draft";
  const isCancelled = normalizedRawStatus === "cancelled";
  const isCompleted = normalizedRawStatus === "completed";
  const isComputedEnded = normalizedComputedStatus === "ended";
  const showGoLive = normalizedComputedStatus === "live" && normalizedRawStatus !== "live";
  const reminderCooldown = reminderSentAt && Date.now() - reminderSentAt < 15 * 60 * 1000;

  const handleGoLive = async () => {
    setIsGoingLive(true);
    try {
      const { error } = await supabase
        .from("events")
        .update({ status: "live" })
        .eq("id", eventId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      const count = await notifyRegistrantsConfirmedOnly(
        "event_live",
        `${eventTitle} is live! 🎉`,
        "Join now and start meeting people"
      );
      toast.success(
        `"${eventTitle}" is live — notified ${count} confirmed attendee${count === 1 ? "" : "s"} (waitlist not notified)`
      );
    } catch (error) {
      toast.error("Failed to set event live");
      throw error;
    } finally {
      setIsGoingLive(false);
    }
  };

  const handleSendReminder = async () => {
    setIsSendingReminder(true);
    try {
      const count = await notifyRegistrantsConfirmedAndWaitlist(
        "event_reminder",
        `${eventTitle} starts soon! ⏰`,
        "Get ready — starting in 15 minutes",
        "You’re still on the waitlist. Keep an eye on the event page for status updates."
      );
      setReminderSentAt(Date.now());
      toast.success(
        `Reminder sent to ${count} user${count === 1 ? "" : "s"} (confirmed + waitlist)`
      );
    } catch {
      toast.error("Failed to send reminder");
      throw new Error("Failed to send reminder");
    } finally {
      setIsSendingReminder(false);
    }
  };

  if (isArchived || isDraft || isCancelled || isCompleted || endedAt) return null;

  const getPendingActionCopy = () => {
    switch (pendingAction?.kind) {
      case "go-live":
        return {
          title: `Set "${eventTitle}" live?`,
          description:
            "This immediately writes events.status = live for this event and sends a live notification to confirmed attendees only. Waitlisted users are not notified by this action. The lobby still depends on the scheduled event window.",
          confirmLabel: "Go Live",
        };
      case "end":
        return {
          title: `End "${eventTitle}"?`,
          description:
            "This immediately writes events.status = ended and ended_at, then broadcasts that the event ended. This is a production lifecycle change and is not a reminder or archive action.",
          confirmLabel: "End Event",
        };
      case "extend":
        return {
          title: `Extend "${eventTitle}" by ${pendingAction.minutes} minutes?`,
          description:
            "This immediately updates events.duration_minutes. It can keep the event window active longer, but it does not notify users by itself.",
          confirmLabel: `Extend +${pendingAction.minutes}`,
        };
      case "reminder":
        return {
          title: `Send reminder for "${eventTitle}"?`,
          description:
            "This sends push notifications to confirmed attendees and waitlisted users with separate copy. It does not change the event status or duration.",
          confirmLabel: "Send Reminder",
        };
      default:
        return { title: "", description: "", confirmLabel: "Confirm" };
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.kind === "go-live") return handleGoLive();
    if (pendingAction.kind === "end") return endEvent.mutateAsync();
    if (pendingAction.kind === "extend") return extendEvent.mutateAsync(pendingAction.minutes);
    return handleSendReminder();
  };

  const pendingCopy = getPendingActionCopy();
  const isActionPending = endEvent.isPending || extendEvent.isPending || isSendingReminder || isGoingLive;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        className="flex items-center gap-2 flex-wrap"
      >
        {showGoLive && (
          <Button
            size="sm"
            variant="default"
            className="gap-1.5"
            onClick={() => setPendingAction({ kind: "go-live" })}
            disabled={isGoingLive}
            title="Sets the event live during its scheduled window and notifies confirmed attendees only. Waitlisted users do not get a live push."
          >
            Go Live
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          onClick={() => setPendingAction({ kind: "end" })}
          disabled={endEvent.isPending}
        >
          <StopCircle className="w-3.5 h-3.5" />
          End Event
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setPendingAction({ kind: "extend", minutes: 15 })}
          disabled={extendEvent.isPending}
        >
          <Plus className="w-3.5 h-3.5" />
          +15 min
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setPendingAction({ kind: "extend", minutes: 30 })}
          disabled={extendEvent.isPending}
        >
          <Plus className="w-3.5 h-3.5" />
          +30 min
        </Button>
        {!isComputedEnded && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setPendingAction({ kind: "reminder" })}
            disabled={isSendingReminder || !!reminderCooldown}
            title="Notifies confirmed attendees with lobby access copy and waitlisted users with status-only copy."
          >
            <Bell className="w-3.5 h-3.5" />
            {reminderCooldown ? "Sent" : "Reminder (confirmed + waitlist)"}
          </Button>
        )}
      </motion.div>
      <AdminConfirmDialog
        open={!!pendingAction}
        title={pendingCopy.title}
        description={pendingCopy.description}
        confirmLabel={pendingCopy.confirmLabel}
        variant={pendingAction?.kind === "go-live" || pendingAction?.kind === "extend" || pendingAction?.kind === "reminder" ? "default" : "destructive"}
        isPending={isActionPending}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        onConfirm={handleConfirmAction}
      />
    </>
  );
};

export default AdminEventControls;
