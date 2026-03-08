import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  Sparkles, 
  Share2,
  Loader2,
  MapPin,
  Globe,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { format } from "date-fns";
import VenueCard from "@/components/events/VenueCard";
import MiniProfileModal from "@/components/events/MiniProfileModal";
import TicketStub from "@/components/events/TicketStub";
import GuestListTeaser from "@/components/events/GuestListTeaser";
import GuestListRoster from "@/components/events/GuestListRoster";
import PricingBar from "@/components/events/PricingBar";
import PaymentModal from "@/components/events/PaymentModal";
import ManageBookingModal from "@/components/events/ManageBookingModal";
import CancelBookingModal from "@/components/events/CancelBookingModal";
import { ProfileDetailDrawer } from "@/components/ProfileDetailDrawer";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { useAuth } from "@/contexts/AuthContext";
import { useEventDetails, useEventAttendees, useIsRegisteredForEvent, EventAttendee } from "@/hooks/useEventDetails";
import { useRegisterForEvent } from "@/hooks/useRegistrations";
import { useRealtimeEvents } from "@/hooks/useEvents";
import { useEventVibes } from "@/hooks/useEventVibes";
import { MutualVibesSection } from "@/components/events/MutualVibesSection";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";

const EventDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { registerForEvent, unregisterFromEvent } = useRegisterForEvent();
  
  // Enable realtime updates
  useRealtimeEvents();
  
  // Fetch real event data
  const { data: event, isLoading: eventLoading, error: eventError } = useEventDetails(id);
  const { data: attendees = [] } = useEventAttendees(id);
  const { data: isRegistered = false, refetch: refetchRegistration } = useIsRegisteredForEvent(id, user?.id);
  
  // Event vibes hook for pre-event interest expressions
  const eventVibes = useEventVibes(id || "");

  // Next event in series (for recurring indicator)
  const { data: nextInSeries } = useQuery({
    queryKey: ['next-in-series', event?.parentEventId],
    enabled: !!event?.parentEventId,
    queryFn: async () => {
      if (!event?.parentEventId) return null;
      const { data } = await supabase
        .from('events')
        .select('id, event_date, occurrence_number')
        .eq('parent_event_id', event.parentEventId)
        .gt('event_date', event.eventDate.toISOString())
        .is('archived_at', null)
        .order('event_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  
  // Fetch current user's profile for gender-based pricing
  const [userProfile, setUserProfile] = useState<{ gender: string } | null>(null);
  
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("profiles")
        .select("gender")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setUserProfile(data);
    };
    fetchProfile();
  }, [user?.id]);
  
  // UI state
  const [scrollY, setScrollY] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState<EventAttendee | null>(null);
  const [fullProfileAttendee, setFullProfileAttendee] = useState<EventAttendee | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showManageBooking, setShowManageBooking] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [showEventPhoneNudge, setShowEventPhoneNudge] = useState(false);

  // Check phone verification for event nudge
  useEffect(() => {
    if (!user?.id) return;
    const dismissed = localStorage.getItem("vibely_phone_nudge_event_dismissed");
    if (dismissed) return;

    const check = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("phone_verified")
        .eq("id", user.id)
        .maybeSingle();
      if (data && !data.phone_verified) {
        setShowEventPhoneNudge(true);
      }
    };
    check();
  }, [user?.id]);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Handler for Register to Match from mini profile modal - MUST be before early returns
  const handleRegisterFromProfile = useCallback(() => {
    setShowPaymentModal(true);
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  // Loading state
  if (eventLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (eventError || !event) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <h1 className="text-xl font-bold text-foreground mb-2">Event not found</h1>
        <p className="text-muted-foreground mb-4">This event may have been removed or doesn't exist.</p>
        <Button onClick={() => navigate("/events")}>Back to Events</Button>
      </div>
    );
  }

  // Calculate capacity status
  const getCapacityStatus = () => {
    const userGender = userProfile?.gender?.toLowerCase() || "male";
    const spotsLeft = userGender === "female" || userGender === "woman"
      ? event.maxWomen - event.currentWomen 
      : event.maxMen - event.currentMen;
    
    if (spotsLeft <= 2) return { status: "almostFull" as const, spotsLeft };
    if (spotsLeft <= 5) return { status: "filling" as const, spotsLeft };
    return { status: "available" as const, spotsLeft };
  };

  const capacityInfo = getCapacityStatus();
  const userGender = userProfile?.gender?.toLowerCase() || "male";
  const isFemale = userGender === "female" || userGender === "woman";
  const userPrice = event.isFree ? 0 : (isFemale ? event.priceFemale : event.priceMale);
  const genderLabel = isFemale ? "Female" : "Male";

  const handlePaymentSuccess = async () => {
    setShowPaymentModal(false);

    if (event.isFree) {
      // Free events: register directly (no Stripe involved)
      const success = await registerForEvent(event.id);
      if (!success) {
        toast.error("Failed to register. Please try again.");
        return;
      }
    }
    // Paid events: webhook already created the registration via Stripe redirect.
    // The onSuccess callback won't fire for paid events (user is redirected),
    // but we handle it defensively here anyway.

    await refetchRegistration();
    queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
    queryClient.invalidateQueries({ queryKey: ["event-attendees", id] });

    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#a855f7", "#ec4899", "#06b6d4"],
    });

    toast.success("You're on the list! 🎉", {
      description: event.isVirtual
        ? "You'll be able to join when the event goes live"
        : "Check your email for confirmation",
    });

    setTimeout(() => setShowTicket(true), 800);
  };

  const handleCancelConfirm = async () => {
    const success = await unregisterFromEvent(event.id);
    
    if (success) {
      await refetchRegistration();
      queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["event-attendees", id] });
      
      setShowCancelModal(false);
      setShowManageBooking(false);
      
      toast.success("Spot cancelled", {
        description: "Your spot has been released to the waitlist",
      });
    } else {
      toast.error("Failed to cancel. Please try again.");
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: event.title,
        text: `Join me at ${event.title} on Vibely!`,
        url: window.location.href,
      });
    } catch {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard!");
    }
  };

  // Transform attendees for teaser view (before registration)
  const teaserAttendees = attendees.slice(0, 6).map(a => ({
    id: a.id,
    name: "???",
    avatar: a.avatar,
    vibeTags: a.vibeTags || [a.vibeTag],
  }));

  // Transform attendees for roster view (after registration)
  const rosterAttendees = attendees.map(a => ({
    id: a.id,
    name: a.name,
    age: a.age,
    avatar: a.avatar,
    vibeTag: a.vibeTag,
    matchPercent: a.matchPercent,
    bio: a.bio,
    photos: a.photos,
    photoVerified: a.photoVerified,
  }));

  return (
    <div className="min-h-screen bg-background pb-28 overflow-y-auto">
      {/* Parallax Hero */}
      <div className="relative w-full aspect-[16/9] max-h-[50vh] overflow-hidden">
        <motion.div
          style={{ y: scrollY * 0.5 }}
          className="absolute inset-0"
        >
          <img
            src={event.coverImage}
            alt={event.title}
            className="w-full h-full object-cover scale-110"
          />
        </motion.div>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

        {/* Top Bar */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10">
          <Button
            variant="glass"
            size="icon"
            onClick={() => navigate("/events")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Button variant="glass" size="icon" onClick={handleShare}>
            <Share2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Hero Content */}
        <div className="absolute bottom-0 left-0 right-0 p-6 space-y-3">
          {/* Category & Match */}
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-secondary text-sm font-medium text-foreground">
              {event.category}
            </span>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="px-3 py-1 rounded-full bg-gradient-to-r from-primary to-accent flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-primary-foreground" />
              <span className="text-xs font-bold text-primary-foreground">
                {event.vibeMatch}% Match
              </span>
            </motion.div>
          </div>

          <h1 className="text-2xl font-bold text-foreground leading-tight">
            {event.title}
          </h1>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(event.eventDate)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{event.time}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-6 space-y-6">

        {/* Phone verification nudge for events */}
        {showEventPhoneNudge && !isRegistered && (
          <PhoneVerificationNudge
            variant="event"
            onDismiss={() => {
              localStorage.setItem("vibely_phone_nudge_event_dismissed", "true");
              setShowEventPhoneNudge(false);
            }}
            onVerified={() => setShowEventPhoneNudge(false)}
          />
        )}

        {/* Location context */}
        {event.scope === 'local' && event.city && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground -mt-2">
            <MapPin className="w-4 h-4 shrink-0 text-primary" />
            <span>{event.city}{event.country ? `, ${event.country}` : ''}</span>
          </div>
        )}
        {event.scope === 'global' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground -mt-2">
            <Globe className="w-4 h-4 shrink-0 text-primary" />
            <span>Global Event — open to everyone</span>
          </div>
        )}

        {/* Recurring series indicator */}
        {event.parentEventId && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-xl bg-muted/40 px-3 py-2 -mt-2">
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>Part of a recurring series</span>
            {nextInSeries && (
              <>
                <span>·</span>
                <button
                  onClick={() => navigate(`/events/${nextInSeries.id}`)}
                  className="text-primary font-medium hover:underline"
                >
                  Next: {format(new Date(nextInSeries.event_date), 'MMM d')}
                </button>
              </>
            )}
          </div>
        )}

        {/* Tags */}
        <div className="flex gap-2 flex-wrap">
          {event.tags.map((tag) => (
            <span
              key={tag}
              className="px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-sm font-medium text-primary"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">About This Event</h2>
          <p className="text-muted-foreground leading-relaxed">
            {event.description || "Join us for an exciting video speed dating event! Meet new people in a fun, safe environment."}
          </p>
        </div>

        {/* Guest List - Conditional Rendering */}
        <AnimatePresence mode="wait">
          {isRegistered ? (
            <motion.div
              key="roster"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <GuestListRoster
                attendees={rosterAttendees}
                totalCount={attendees.length}
                onAttendeeClick={(attendee) => navigate(`/user/${attendee.id}`)}
                onTicketClick={() => setShowManageBooking(true)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="teaser"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <GuestListTeaser
                attendees={teaserAttendees}
                totalCount={attendees.length}
              />
          </motion.div>
        )}
      </AnimatePresence>

        {/* Mutual Vibes Section - Only show for registered users with mutual vibes */}
        {isRegistered && eventVibes.mutualVibes.length > 0 && (
          <MutualVibesSection
            mutualVibes={eventVibes.mutualVibes}
            onProfileClick={(profileId) => navigate(`/user/${profileId}`)}
          />
        )}

        {/* Venue */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">The Venue</h2>
          <VenueCard
            isVirtual={event.isVirtual}
            venueName={event.venue}
            address={event.address}
            eventDate={event.eventDate}
            eventDurationMinutes={event.durationMinutes}
            eventId={event.id}
            isRegistered={isRegistered}
          />
        </div>
      </div>

      {/* Sticky Bottom Bar - Only show when not registered */}
      {!isRegistered && (
        <PricingBar
          price={userPrice}
          capacityStatus={capacityInfo.status}
          spotsLeft={capacityInfo.spotsLeft}
          genderLabel={genderLabel}
          onPurchase={() => setShowPaymentModal(true)}
        />
      )}

      {/* Registered Bottom Bar */}
      {isRegistered && (
        <div className="fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-border/50 rounded-none">
          <div className="max-w-lg mx-auto p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-10 h-10 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center"
              >
                <Sparkles className="w-5 h-5 text-white" />
              </motion.div>
              <div>
                <p className="font-semibold text-foreground">You're In!</p>
                <p className="text-xs text-muted-foreground">See you there</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => setShowManageBooking(true)}>
              Manage Booking
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={handlePaymentSuccess}
        eventId={event.id}
        eventTitle={event.title}
        eventDate={formatDate(event.eventDate)}
        userGender={genderLabel}
        priceMale={event.priceMale}
        priceFemale={event.priceFemale}
      />

      <ManageBookingModal
        isOpen={showManageBooking}
        onClose={() => setShowManageBooking(false)}
        onCancel={() => {
          setShowManageBooking(false);
          setShowCancelModal(true);
        }}
        eventTitle={event.title}
        eventDate={formatDate(event.eventDate)}
        eventTime={event.time}
        venue={event.venue}
        ticketNumber={`VBL-${event.id.slice(0, 8).toUpperCase()}`}
        price={userPrice}
      />

      <CancelBookingModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancelConfirm}
        eventTitle={event.title}
      />

      {/* Mini Profile Modal */}
      <MiniProfileModal
        profile={selectedProfile}
        isOpen={!!selectedProfile}
        onClose={() => setSelectedProfile(null)}
        onRegister={handleRegisterFromProfile}
        onViewFullProfile={(profileId) => {
          const attendee = attendees.find(a => a.id === profileId);
          if (attendee) {
            setFullProfileAttendee(attendee);
          }
        }}
        onSendVibe={(profileId) => eventVibes.sendVibe(profileId)}
        onRemoveVibe={(profileId) => eventVibes.removeVibe(profileId)}
        isViewerRegistered={isRegistered}
        hasSentVibe={selectedProfile ? eventVibes.hasSentVibe(selectedProfile.id) : false}
        hasReceivedVibe={selectedProfile ? eventVibes.hasReceivedVibe(selectedProfile.id) : false}
        isSendingVibe={eventVibes.isSendingVibe}
        eventStatus={
          new Date() >= event.eventDate
            ? new Date() < new Date(event.eventDate.getTime() + event.durationMinutes * 60000)
              ? "live"
              : "ended"
            : "upcoming"
        }
      />

      {/* Full Profile Drawer */}
      <ProfileDetailDrawer
        match={{
          id: fullProfileAttendee?.id || "",
          name: fullProfileAttendee?.name || "",
          age: fullProfileAttendee?.age || 0,
          image: resolvePhotoUrl(fullProfileAttendee?.avatar) || "",
          vibes: fullProfileAttendee?.vibeTags || [fullProfileAttendee?.vibeTag || ""],
          compatibility: fullProfileAttendee?.matchPercent,
          photos: (fullProfileAttendee?.photos || []).map(p => resolvePhotoUrl(p)).filter(Boolean) as string[],
          bio: fullProfileAttendee?.bio,
        }}
        open={!!fullProfileAttendee}
        onOpenChange={(open) => {
          if (!open) setFullProfileAttendee(null);
        }}
        showActions={false}
        mode="discovery"
      />

      {/* Ticket Stub */}
      <AnimatePresence>
        {showTicket && (
          <TicketStub
            eventTitle={event.title}
            eventDate={formatDate(event.eventDate)}
            eventTime={event.time}
            isVirtual={event.isVirtual}
            venue={event.venue}
            ticketNumber={`VBL-${event.id.slice(0, 8).toUpperCase()}`}
            onClose={() => setShowTicket(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default EventDetails;
