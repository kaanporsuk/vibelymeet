import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CancelBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  eventTitle: string;
}

const CancelBookingModal = ({
  isOpen,
  onClose,
  onConfirm,
  eventTitle,
}: CancelBookingModalProps) => {
  const [isCancelling, setIsCancelling] = useState(false);

  const handleConfirm = async () => {
    setIsCancelling(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsCancelling(false);
    onConfirm();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-background/80 backdrop-blur-md"
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-sm"
        >
          <div className="glass-card rounded-3xl p-6 text-center space-y-4 border border-border/50">
            {/* Warning Icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.1 }}
              className="mx-auto w-16 h-16 rounded-full bg-destructive/10 border-2 border-destructive/30 flex items-center justify-center"
            >
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </motion.div>

            {/* Content */}
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-foreground">Are you sure?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                You are about to give up your spot at{" "}
                <span className="font-medium text-foreground">{eventTitle}</span>.
                This spot will be released to someone on the waitlist.
              </p>
            </div>

            {/* Policy Reminder */}
            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20">
              <p className="text-xs text-destructive font-medium">
                Tickets are non-refundable. You will not receive a refund for this cancellation.
              </p>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <Button
                variant="gradient"
                size="lg"
                className="w-full"
                onClick={onClose}
              >
                Keep My Spot
              </Button>

              <Button
                variant="ghost"
                size="lg"
                className="w-full text-muted-foreground hover:text-destructive"
                onClick={handleConfirm}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cancelling...
                  </span>
                ) : (
                  "Confirm Cancellation"
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
