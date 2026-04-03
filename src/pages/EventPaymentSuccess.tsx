import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Ticket, ArrowRight, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { useUserProfile } from "@/contexts/AuthContext";

const EventPaymentSuccess = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useUserProfile();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("event_id");
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [eventRowStatus, setEventRowStatus] = useState<string | null>(null);
  const [admissionStatus, setAdmissionStatus] = useState<"confirmed" | "waitlisted" | "unknown">(
    "unknown"
  );

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("title, status")
        .eq("id", eventId)
        .maybeSingle();
      if (data) {
        setEventTitle(data.title);
        setEventRowStatus(data.status ?? null);
      }
    })();

    // Invalidate registration queries so UI updates when user navigates back
    queryClient.invalidateQueries({ queryKey: ["event-registration-check", eventId] });
    queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
    queryClient.invalidateQueries({ queryKey: ["event-attendees", eventId] });
    queryClient.invalidateQueries({ queryKey: ["event-attendee-preview", eventId] });
    queryClient.invalidateQueries({ queryKey: ["event-details", eventId] });
  }, [eventId, queryClient]);

  useEffect(() => {
    if (!eventId || !user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("event_registrations")
        .select("admission_status")
        .eq("event_id", eventId)
        .eq("profile_id", user.id)
        .maybeSingle();
      if (cancelled || error) return;
      const s = data?.admission_status;
      if (s === "confirmed" || s === "waitlisted") setAdmissionStatus(s);
      else setAdmissionStatus("unknown");
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, user?.id]);

  useEffect(() => {
    if (!eventId || eventRowStatus === null) return;
    if (eventRowStatus === "cancelled") return;
    if (admissionStatus !== "confirmed") return;
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ["#a855f7", "#ec4899", "#06b6d4"],
    });
  }, [eventId, eventRowStatus, admissionStatus]);

  const isEventCancelled = eventRowStatus === "cancelled";

  const headline = isEventCancelled
    ? "This event was cancelled"
    : admissionStatus === "waitlisted"
      ? "You're on the waitlist"
      : admissionStatus === "confirmed"
        ? "You're on the list! 🎉"
        : "Payment received";

  const subline = isEventCancelled
    ? "Your payment may still show here while things sync — open the event page for the latest status. Refund exceptions are handled manually by support."
    : admissionStatus === "waitlisted"
      ? "The event was full when your payment settled — we'll confirm you if a spot opens."
      : admissionStatus === "confirmed"
        ? "Check your email for confirmation"
        : "Hang tight while we confirm your spot.";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", damping: 12, stiffness: 200 }}
        className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-6"
      >
        <Ticket className="w-10 h-10 text-primary-foreground" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-3xl font-display font-bold text-foreground mb-2"
      >
        {headline}
      </motion.h1>

      {eventTitle && (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="text-lg font-semibold text-primary mb-1"
        >
          {eventTitle}
        </motion.p>
      )}

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
        className="text-muted-foreground mb-8"
      >
        {subline}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="flex flex-col gap-3 w-full max-w-xs"
      >
        {eventId && (
          <Button
            variant="gradient"
            size="lg"
            className="w-full gap-2"
            onClick={() => navigate(`/events/${eventId}`)}
          >
            <CalendarCheck className="w-4 h-4" />
            View Event
          </Button>
        )}
        <Button
          variant="outline"
          size="lg"
          className="w-full gap-2"
          onClick={() => navigate("/events")}
        >
          Back to Events
          <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  );
};

export default EventPaymentSuccess;
