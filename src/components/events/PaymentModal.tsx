import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CreditCard, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  userGender: "Male" | "Female";
  priceMale: number;
  priceFemale: number;
}

const PaymentModal = ({
  isOpen,
  onClose,
  onSuccess,
  eventId,
  eventTitle,
  eventDate,
  userGender,
  priceMale,
  priceFemale,
}: PaymentModalProps) => {
  const [agreed, setAgreed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const price = userGender === "Male" ? priceMale : priceFemale;

  const handlePay = async () => {
    if (!agreed) return;
    setIsProcessing(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Please sign in to continue");
      setIsProcessing(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke("create-event-checkout", {
      body: {
        eventId,
        eventTitle,
        price,
        currency: "eur",
      },
    });

    if (error || !data?.success) {
      toast.error(data?.error || "Payment failed. Please try again.");
      setIsProcessing(false);
      return;
    }

    // Redirect to Stripe Checkout
    window.location.href = data.url;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
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
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md mx-4 mb-4 sm:mb-0"
        >
          <div className="glass-card rounded-3xl overflow-hidden border border-border/50">
            {/* Header */}
            <div className="relative p-6 pb-4 border-b border-border/30">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <Shield className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Secure Checkout</h3>
                  <p className="text-sm text-muted-foreground">Complete your reservation</p>
                </div>
              </div>
            </div>

            {/* Order Summary */}
            <div className="p-6 space-y-4">
              <div className="glass-card p-4 rounded-2xl space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-foreground">{eventTitle}</p>
                    <p className="text-sm text-muted-foreground">{eventDate}</p>
                  </div>
                </div>
                
                <div className="h-px bg-border/50" />
                
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Ticket ({userGender})</span>
                  </div>
                  <span className="text-xl font-bold text-foreground">
                    €{price.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Payment Method - Credit Card only */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Payment Method</p>
                
                <div className="w-full p-4 rounded-2xl border-2 border-primary bg-primary/5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-foreground">Credit Card</p>
                    <p className="text-xs text-muted-foreground">Visa, Mastercard, Amex</p>
                  </div>
                </div>
              </div>

              {/* Policy Agreement */}
              <div className="glass-card p-4 rounded-2xl">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={agreed}
                    onCheckedChange={(checked) => setAgreed(checked as boolean)}
                    className="mt-0.5 border-primary data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm text-muted-foreground leading-relaxed">
                    I understand that this ticket secures my spot and is{" "}
                    <span className="text-destructive font-medium">non-refundable</span>.
                    Cancellation will forfeit the ticket and release my spot to the waitlist.
                  </span>
                </label>
              </div>

              {/* Pay Button */}
              <Button
                variant="gradient"
                size="xl"
                className="w-full relative overflow-hidden"
                disabled={!agreed || isProcessing}
                onClick={handlePay}
              >
                <AnimatePresence mode="wait">
                  {isProcessing ? (
                    <motion.div
                      key="processing"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Redirecting to Stripe...</span>
                    </motion.div>
                  ) : (
                    <motion.span
                      key="pay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      Pay €{price.toFixed(2)} & Join Event
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>

              {/* Security Badge */}
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Shield className="w-3 h-3" />
                <span>Secure payment powered by Stripe</span>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PaymentModal;