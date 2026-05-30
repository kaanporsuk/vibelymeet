import { motion, AnimatePresence } from "framer-motion";
import { X, CalendarCheck, Calendar, Clock, Share2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { buildEventShareUrl } from "@/lib/inviteLinks";
import { trackEvent } from "@/lib/analytics";
import { isWebShareAbortError } from "@/lib/webShare";

export type RegistrationAdmissionStatus = "confirmed" | "waitlisted";

interface ManageRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel: () => void;
  /** Canonical event id for referral-tagged share URL */
  eventId: string;
  /** Logged-in sharer; omit for anonymous */
  referrerUserId?: string | null;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  registrationNumber: string;
  price: number;
  /** Confirmed = lobby-eligible when live; waitlist must not imply lobby access. */
  admissionStatus?: RegistrationAdmissionStatus;
  canCancel?: boolean;
}

const ManageRegistrationModal = ({
  isOpen,
  onClose,
  onCancel,
  eventId,
  referrerUserId,
  eventTitle,
  eventDate,
  eventTime,
  registrationNumber,
  price,
  admissionStatus = "confirmed",
  canCancel = true,
}: ManageRegistrationModalProps) => {
  const isWaitlisted = admissionStatus === "waitlisted";

  const handleShare = async () => {
    const url = buildEventShareUrl(eventId, referrerUserId);
    try {
      await navigator.share({
        title: `My Vibely Registration - ${eventTitle}`,
        text: `I'm going to ${eventTitle}! Join me on Vibely.`,
        url,
      });
      trackEvent("invite_link_shared", { surface: "manage_booking_modal", channel: "system_share" });
    } catch (error) {
      if (isWebShareAbortError(error)) return;
      try {
        await navigator.clipboard.writeText(url);
        trackEvent("invite_link_copied", { surface: "manage_booking_modal", channel: "clipboard" });
        toast.success("Link copied to clipboard!");
      } catch {
        toast.error("Could not copy link. Try again.");
      }
    }
  };

  if (!isOpen) return null;

  const headerTitle = isWaitlisted ? "Your waitlist spot" : "Your Registration";
  const releaseCta = isWaitlisted ? "Leave waitlist" : "Release Spot";

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
            <div className="relative p-6 pb-4 border-b border-border/30 bg-gradient-to-br from-primary/10 to-accent/10">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close registration details"
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center"
                >
                  <CalendarCheck className="w-7 h-7 text-primary-foreground" />
                </motion.div>
                <div>
                  <h3 className="text-xl font-bold text-foreground">{headerTitle}</h3>
                  <p className="text-sm text-muted-foreground">{registrationNumber}</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Event Details */}
              <div className="glass-card p-4 rounded-2xl space-y-3">
                <h4 className="font-semibold text-foreground text-lg">{eventTitle}</h4>

                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span>{eventDate}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 text-primary" />
                    <span>{eventTime}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Video className="w-4 h-4 text-primary" />
                    <span>Digital Lobby</span>
                  </div>
                </div>
              </div>

              {/* Online lobby instructions */}
              <div className="glass-card p-6 rounded-2xl flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                  <Video className="w-8 h-8 text-primary" />
                </div>
                {isWaitlisted ? (
                  <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-[280px]">
                    The live lobby is for <strong>confirmed</strong> guests. On the waitlist, you’ll only use{" "}
                    <strong>Enter Lobby</strong> if you’re promoted to a confirmed spot — we’ll update your status here when
                    that happens.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground text-center">
                    Join via the <strong>Enter Lobby</strong> button when the event is live.
                  </p>
                )}
              </div>

              {/* Price Info */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-secondary/30">
                <span className="text-sm text-muted-foreground">{price <= 0 ? "Price" : "Amount paid"}</span>
                <span className="text-lg font-bold text-foreground">
                  {price <= 0 ? "Free" : `€${price.toFixed(2)}`}
                </span>
              </div>
              {price > 0 ? (
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  Refund exceptions are reviewed manually by support and are not processed automatically in the app.
                </p>
              ) : null}

              {/* Actions */}
              <div className="space-y-3">
                <Button variant="outline" size="lg" className="w-full" onClick={handleShare}>
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Event
                </Button>

                {canCancel ? (
                  <button
                    onClick={onCancel}
                    className="w-full text-center text-sm text-destructive/70 hover:text-destructive transition-colors py-2"
                  >
                    {releaseCta}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ManageRegistrationModal;
