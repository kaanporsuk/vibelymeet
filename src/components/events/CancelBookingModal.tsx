import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookingAdmissionStatus } from "@/components/events/ManageBookingModal";

interface CancelBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  eventTitle: string;
  admissionStatus?: BookingAdmissionStatus;
}

const CancelBookingModal = ({
  isOpen,
  onClose,
  onConfirm,
  eventTitle,
  admissionStatus = "confirmed",
}: CancelBookingModalProps) => {
  const [isCancelling, setIsCancelling] = useState(false);
  const isWaitlisted = admissionStatus === "waitlisted";

  const handleConfirm = async () => {
    setIsCancelling(true);
    try {
      await onConfirm();
    } finally {
      setIsCancelling(false);
    }
  };

  if (!isOpen) return null;

  const title = isWaitlisted ? "Leave the waitlist?" : "Release your spot?";
  const body = isWaitlisted ? (
    <>
      You’ll leave the paid waitlist for{" "}
      <span className="font-medium text-foreground">{eventTitle}</span>. You can join again later if the event still has
      capacity.
    </>
  ) : (
    <>
      You’re about to release your <span className="font-medium text-foreground">confirmed</span> spot for{" "}
      <span className="font-medium text-foreground">{eventTitle}</span>. If this event uses a waitlist, the next person may
      be offered your seat according to Vibely’s usual rules.
    </>
  );
  const confirmLabel = isWaitlisted ? "Leave waitlist" : "Release spot";
  const keepLabel = isWaitlisted ? "Stay on waitlist" : "Keep my spot";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-background/80 backdrop-blur-md"
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-sm"
        >
          <div className="glass-card rounded-3xl p-6 text-center space-y-4 border border-border/50">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.1 }}
              className="mx-auto w-16 h-16 rounded-full bg-destructive/10 border-2 border-destructive/30 flex items-center justify-center"
            >
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </motion.div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>

            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Refunds aren’t handled in this app. Check your payment confirmation or reach out to support if you think
                you’re eligible for one.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <Button variant="gradient" size="lg" className="w-full" onClick={onClose}>
                {keepLabel}
              </Button>

              <Button
                variant="ghost"
                size="lg"
                className="w-full text-muted-foreground hover:text-destructive"
                onClick={() => void handleConfirm()}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Working…
                  </span>
                ) : (
                  confirmLabel
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CancelBookingModal;
