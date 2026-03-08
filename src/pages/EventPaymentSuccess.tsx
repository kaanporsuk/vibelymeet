import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Ticket, ArrowRight, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import confetti from "canvas-confetti";

const EventPaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("event_id");
  const [eventTitle, setEventTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("title")
        .eq("id", eventId)
        .maybeSingle();
      if (data) setEventTitle(data.title);
    })();
  }, [eventId]);

  useEffect(() => {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ["#a855f7", "#ec4899", "#06b6d4"],
    });
  }, []);

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
        You're on the list! 🎉
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
        Check your email for confirmation
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