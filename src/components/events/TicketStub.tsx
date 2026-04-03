import { motion } from "framer-motion";
import { Calendar, Clock, MapPin, Ticket, QrCode, Video } from "lucide-react";
import type { BookingAdmissionStatus } from "@/components/events/ManageBookingModal";

interface TicketStubProps {
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  isVirtual: boolean;
  venue?: string;
  ticketNumber: string;
  onClose: () => void;
  admissionStatus?: BookingAdmissionStatus;
}

const TicketStub = ({ 
  eventTitle, 
  eventDate, 
  eventTime, 
  isVirtual, 
  venue,
  ticketNumber,
  onClose,
  admissionStatus = "confirmed",
}: TicketStubProps) => {
  const isWaitlisted = admissionStatus === "waitlisted";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 mb-4"
      >
        {/* Ticket Container */}
        <div className="relative">
          {/* Ticket Punch Holes */}
          <div className="absolute left-0 top-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-background" />
          <div className="absolute right-0 top-1/2 translate-x-1/2 w-6 h-6 rounded-full bg-background" />

          {/* Main Ticket */}
          <div className="bg-gradient-to-br from-card via-card to-secondary rounded-3xl overflow-hidden border border-border">
            {/* Header */}
            <div className="relative px-6 pt-6 pb-4 bg-gradient-to-r from-primary/20 to-accent/20">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <Ticket className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {isWaitlisted
                      ? "Waitlist spot"
                      : isVirtual
                        ? "Vibely Registration"
                        : "Vibely Ticket"}
                  </span>
                  {!isVirtual && (
                    <p className="text-xs text-muted-foreground">
                      #{ticketNumber}
                    </p>
                  )}
                </div>
              </div>
              <h2 className="text-xl font-bold text-foreground">{eventTitle}</h2>
            </div>

            {/* Dashed Separator */}
            <div className="relative h-px">
              <div className="absolute inset-0 border-t-2 border-dashed border-border" />
            </div>

            {/* Details */}
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Date</span>
                    <p className="text-sm font-medium text-foreground">{eventDate}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Time</span>
                    <p className="text-sm font-medium text-foreground">{eventTime}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Location</span>
                  <p className="text-sm font-medium text-foreground">
                    {isVirtual ? "Virtual • Video Speed Dating" : venue}
                  </p>
                </div>
              </div>

              {/* QR Code OR Virtual Join Instructions */}
              {isVirtual ? (
                <div className="flex flex-col items-center gap-3 pt-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <Video className="w-8 h-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">Virtual Event</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">
                      {isWaitlisted
                        ? "Enter Lobby is for confirmed guests. If you’re promoted from the waitlist, use Enter Lobby when the event is live."
                        : 'When the event goes live, tap "Enter Lobby" from the home page to join.'}
                    </p>
                  </div>
                </div>
              ) : isWaitlisted ? (
                <p className="text-center text-xs text-muted-foreground leading-relaxed pt-4 px-1">
                  Waitlist — not a confirmed seat yet. In-person check-in details appear if you’re promoted before the event.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-center pt-4">
                    <div className="p-4 bg-foreground rounded-xl">
                      <QrCode className="w-24 h-24 text-background" />
                    </div>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Show this ticket at entry
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Tap to dismiss */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center text-xs text-muted-foreground mt-4"
          >
            Tap anywhere to dismiss
          </motion.p>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TicketStub;
