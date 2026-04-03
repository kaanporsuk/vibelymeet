import { supabase } from "@/integrations/supabase/client";
import { sendNotification } from "@/lib/notifications";

/**
 * After admin_cancel_event: notify confirmed and waitlisted users with explicit copy.
 * Best-effort per user; failures are logged only (cancel already succeeded).
 */
export async function notifyAttendeesOfEventCancellation(eventId: string, eventTitle: string) {
  const { data: rows, error } = await supabase
    .from("event_registrations")
    .select("profile_id, admission_status")
    .eq("event_id", eventId)
    .in("admission_status", ["confirmed", "waitlisted"]);

  if (error || !rows?.length) return { confirmedSent: 0, waitlistSent: 0 };

  const confirmed = [...new Set(rows.filter((r) => r.admission_status === "confirmed").map((r) => r.profile_id))];
  const waitlisted = [...new Set(rows.filter((r) => r.admission_status === "waitlisted").map((r) => r.profile_id))];

  const url = `/events/${eventId}`;

  await Promise.allSettled(
    confirmed.map((user_id) =>
      sendNotification({
        user_id,
        category: "event_cancelled",
        title: `${eventTitle} has been cancelled`,
        body: "This event is no longer running. Open the event page for details — you can manage your booking from there if needed.",
        data: { url, event_id: eventId },
      })
    )
  );

  await Promise.allSettled(
    waitlisted.map((user_id) =>
      sendNotification({
        user_id,
        category: "event_cancelled",
        title: `${eventTitle} has been cancelled`,
        body: "You were on the waitlist — you won’t be promoted into this event. Open the event page for more info.",
        data: { url, event_id: eventId },
      })
    )
  );

  return { confirmedSent: confirmed.length, waitlistSent: waitlisted.length };
}
