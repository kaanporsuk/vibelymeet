import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneVerification } from "@/components/PhoneVerification";
import { fetchMyPhoneVerificationProfile, type PhoneVerificationProfile } from "@/lib/phoneVerificationState";

interface PhoneVerificationNudgeProps {
  variant: "wizard" | "match" | "event" | "empty";
  /** If provided, the nudge will reconcile against canonical backend truth post-success. */
  userId?: string | null;
  /** Optional E.164 value to prefill the modal. */
  initialPhoneE164?: string | null;
  onDismiss?: () => void;
  onVerified?: (profile?: PhoneVerificationProfile) => void;
}

const COPY = {
  wizard: {
    emoji: "🔒",
    title: "One more thing — verify your phone to get a trust badge",
    subtitle: "Verified profiles get 2x more matches",
    cta: "Verify phone",
    dismiss: "Maybe Later",
  },
  match: {
    emoji: "💜",
    title: "Congrats on your first match! Boost your profile with phone verification",
    subtitle: "",
    cta: "Verify phone",
    dismiss: "Skip",
  },
  event: {
    emoji: "📱",
    title: "Tip: Verified profiles are shown first in the event lobby",
    subtitle: "",
    cta: "Verify phone",
    dismiss: "",
  },
  empty: {
    emoji: "📱",
    title: "No matches yet — verify your phone to boost your visibility",
    subtitle: "",
    cta: "Verify phone",
    dismiss: "",
  },
};

export function PhoneVerificationNudge({ variant, userId, initialPhoneE164, onDismiss, onVerified }: PhoneVerificationNudgeProps) {
  const [showModal, setShowModal] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const copy = COPY[variant];

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const handleVerified = () => {
    setDismissed(true);
    if (!userId) {
      onVerified?.();
      return;
    }
    void (async () => {
      try {
        const next = await fetchMyPhoneVerificationProfile(userId);
        onVerified?.(next);
      } catch (e) {
        console.error(e);
        onVerified?.();
      }
    })();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="relative p-4 rounded-2xl glass-card border border-primary/20 space-y-2"
      >
        {/* Dismiss X for event variant */}
        {variant === "event" && (
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-secondary/60 flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        )}

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 text-lg">
            {copy.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground leading-snug">
              {copy.title}
            </p>
            {copy.subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{copy.subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="gradient"
            size="sm"
            onClick={() => setShowModal(true)}
            className="flex-1"
          >
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            {copy.cta}
          </Button>
          {copy.dismiss && (
            <button
              onClick={handleDismiss}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              {copy.dismiss}
            </button>
          )}
        </div>
      </motion.div>

      <PhoneVerification
        open={showModal}
        onOpenChange={setShowModal}
        initialPhoneE164={initialPhoneE164}
        onVerified={handleVerified}
      />
    </>
  );
}
