import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CalendarCheck, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { useUserProfile } from "@/contexts/AuthContext";
import { trackEvent } from "@/lib/analytics";
import {
  eventTicketPaymentSuccessCopy,
  fetchEventTicketPaymentStatus,
  resolveEventTicketPaymentViewState,
  type EventTicketPaymentStatus,
} from "@/lib/eventTicketPaymentStatus";

const EventPaymentSuccess = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useUserProfile();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("event_id") ?? searchParams.get("eventId");
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [eventRowStatus, setEventRowStatus] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<EventTicketPaymentStatus | null>(null);
  const analyticsTrackedRef = useRef(false);

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
    const refreshAdmission = async () => {
      const status = await fetchEventTicketPaymentStatus(eventId);
      if (cancelled) return;
      setPaymentStatus(status);
    };

    void refreshAdmission();

    // Webhook settlement may lag redirect; poll briefly so status truth catches up.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let stopPollingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        void refreshAdmission();
      }, 3000);
      stopPollingTimeoutId = setTimeout(() => {
        if (intervalId) clearInterval(intervalId);
      }, 30000);
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (stopPollingTimeoutId) clearTimeout(stopPollingTimeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [eventId, user?.id]);

  const isEventCancelled = eventRowStatus === "cancelled";
  const viewState = resolveEventTicketPaymentViewState(paymentStatus, isEventCancelled);
  const copy = eventTicketPaymentSuccessCopy(viewState);
  const { headline, subline } = copy;

  useEffect(() => {
    if (!eventId || viewState === "pending") return;
    if (analyticsTrackedRef.current) return;
    analyticsTrackedRef.current = true;
    if (viewState === "confirmed") {
      trackEvent("event_registered", { event_id: eventId, source: "stripe" });
    } else if (viewState === "waitlisted") {
      trackEvent("event_waitlisted", { event_id: eventId, source: "stripe" });
    }
  }, [eventId, viewState]);

  useEffect(() => {
    if (!eventId || eventRowStatus === null) return;
    if (eventRowStatus === "cancelled") return;
    if (!copy.celebrate) return;
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ["#a855f7", "#ec4899", "#06b6d4"],
    });
  }, [eventId, eventRowStatus, copy.celebrate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", damping: 12, stiffness: 200 }}
        className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-6"
      >
        <CalendarCheck className="w-10 h-10 text-primary-foreground" />
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
        {eventId && copy.showViewEventAction && (
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
        {copy.showSupportAction && (
          <Button
            variant="secondary"
            size="lg"
            className="w-full gap-2"
            onClick={() => navigate("/settings?drawer=support&primaryType=support&subcategory=Payment%20failed%20or%20refund")}
          >
            <LifeBuoy className="w-4 h-4" />
            Contact Support
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
