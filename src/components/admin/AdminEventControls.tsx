import { useState } from "react";
import { motion } from "framer-motion";
import { StopCircle, Clock, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendNotification } from "@/lib/notifications";

interface AdminEventControlsProps {
  eventId: string;
  eventTitle: string;
  eventStatus: string | null;
  durationMinutes: number | null;
}

const AdminEventControls = ({
  eventId,
  eventTitle,
  eventStatus,
  durationMinutes,
}: AdminEventControlsProps) => {
  const queryClient = useQueryClient();
  const [isEnding, setIsEnding] = useState(false);
  const [reminderSentAt, setReminderSentAt] = useState<number | null>(null);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

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
      const { error } = await supabase
        .from("events")
        .update({ status: "ended" })
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
      toast.success(`"${eventTitle}" has been ended`);
      setIsEnding(false);
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

  const isLive = eventStatus === "live" || eventStatus === "upcoming";
  const isEnded =
    eventStatus === "ended" ||
    eventStatus === "completed" ||
    eventStatus === "cancelled";
  const reminderCooldown = reminderSentAt && Date.now() - reminderSentAt < 15 * 60 * 1000;

  const handleGoLive = async () => {
    const { error } = await supabase
      .from("events")
      .update({ status: "live" })
      .eq("id", eventId);
    if (error) {
      toast.error("Failed to set event live");
      return;
    }
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
    } finally {
      setIsSendingReminder(false);
    }
  };

  if (isEnded) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="flex items-center gap-2 flex-wrap"
    >
      {isEnding ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-destructive">End this event?</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => endEvent.mutate()}
            disabled={endEvent.isPending}
          >
            {endEvent.isPending ? "Ending..." : "Confirm"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsEnding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {eventStatus === "upcoming" && (
            <Button
              size="sm"
              variant="default"
              className="gap-1.5"
              onClick={handleGoLive}
              title="Sets the event live and notifies confirmed attendees only. Waitlisted users do not get a live push."
            >
              Go Live
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => setIsEnding(true)}
          >
            <StopCircle className="w-3.5 h-3.5" />
            End Event
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => extendEvent.mutate(15)}
            disabled={extendEvent.isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            +15 min
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => extendEvent.mutate(30)}
            disabled={extendEvent.isPending}
          >
            <Plus className="w-3.5 h-3.5" />
            +30 min
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleSendReminder}
            disabled={isSendingReminder || !!reminderCooldown}
            title="Notifies confirmed attendees with lobby access copy and waitlisted users with status-only copy."
          >
            <Bell className="w-3.5 h-3.5" />
            {reminderCooldown ? "Sent" : "Reminder (confirmed + waitlist)"}
          </Button>
        </>
      )}
    </motion.div>
  );
};

export default AdminEventControls;
