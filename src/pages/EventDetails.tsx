import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
  Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLanguageLabel } from "@/lib/eventLanguages";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { format } from "date-fns";
import VenueCard from "@/components/events/VenueCard";
import RegistrationStub from "@/components/events/RegistrationStub";
import GuestListTeaser from "@/components/events/GuestListTeaser";
import GuestListRoster, { type GuestListRosterAttendee } from "@/components/events/GuestListRoster";
import PricingBar from "@/components/events/PricingBar";
import PaymentModal from "@/components/events/PaymentModal";
import ManageRegistrationModal from "@/components/events/ManageRegistrationModal";
import CancelRegistrationModal from "@/components/events/CancelRegistrationModal";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventDetails, useIsRegisteredForEvent } from "@/hooks/useEventDetails";
import { useEventAttendeePreview } from "@/hooks/useEventAttendees";
import { useRegisterForEvent } from "@/hooks/useRegistrations";
import { useRealtimeEvents } from "@/hooks/useEvents";
import { useEventVibes } from "@/hooks/useEventVibes";
import { MutualVibesSection } from "@/components/events/MutualVibesSection";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";
import { useEntitlements } from "@/hooks/useEntitlements";
import { trackEvent } from "@/lib/analytics";
import { PremiumUpsellDialog } from "@/components/premium/PremiumUpsellDialog";
import { PREMIUM_ENTRY_SURFACE } from "@shared/premiumFunnel";
import { buildEventShareUrl } from "@/lib/inviteLinks";
import { captureBrowserReferral } from "@/lib/referrals";
import { isWebShareAbortError } from "@/lib/webShare";
import { resolveEventLifecycle } from "@/lib/eventLifecycle";
import { resolveEventBookingEditability } from "@clientShared/eventBookingEditability";

const EVENT_DETAILS_CLOCK_REFRESH_MS = 30_000;
const EVENT_DETAILS_CUTOFF_TICK_GRACE_MS = 250;
const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

const EventDetails = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useUserProfile();
  const { registerForEvent, unregisterFromEvent } = useRegisterForEvent();
  const { canAccessPremiumEvents, canAccessVipEvents } = useEntitlements();

  // Enable realtime updates
  useRealtimeEvents();

  // Fetch real event data
  const { data: event, isLoading: eventLoading, error: eventError } = useEventDetails(id);
  const { data: attendeePreview, isLoading: attendeePreviewLoading } = useEventAttendeePreview(id);
  const { data: regSnapshot, refetch: refetchRegistration } = useIsRegisteredForEvent(id, user?.id);
  const isConfirmed = regSnapshot?.isConfirmed ?? false;
  const isWaitlisted = regSnapshot?.isWaitlisted ?? false;
  const hasEventAdmission = isConfirmed || isWaitlisted;

  // Event vibes hook for pre-event interest expressions
  const eventVibes = useEventVibes(id || "");

  // Shared links like /events/:id?ref= — keep referral for signup (Auth also reads ?ref= on /auth).
  useEffect(() => {
    captureBrowserReferral(searchParams);
  }, [searchParams]);

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
        .not('status', 'in', '(draft,cancelled,archived)')
        .order('event_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // UI state
  const [scrollY, setScrollY] = useState(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showManageRegistration, setShowManageRegistration] = useState(false);
  const [showCancelRegistrationModal, setShowCancelRegistrationModal] = useState(false);
  const [showRegistrationStub, setShowRegistrationStub] = useState(false);
  const [showEventPhoneNudge, setShowEventPhoneNudge] = useState(false);
  const [freeRegisterBusy, setFreeRegisterBusy] = useState(false);
  const [visibilityUpsell, setVisibilityUpsell] = useState<"premium" | "vip" | null>(null);
  const [eventClockMs, setEventClockMs] = useState(() => Date.now());
  /** Wired after purchase handler exists — lets MiniProfile use the same guarded funnel. */
  const purchasePressRef = useRef<() => void>(() => {});

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

  const trackedEventId = event?.id ?? null;
  const trackedEventTitle = event?.title ?? null;

  // Track event view
  useEffect(() => {
    if (trackedEventId && id) {
      trackEvent('event_viewed', { event_id: id, event_title: trackedEventTitle ?? '' });
    }
  }, [trackedEventId, trackedEventTitle, id]);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!event?.eventDate) {
      setEventClockMs(Date.now());
      return;
    }

    const refreshClock = () => setEventClockMs(Date.now());
    const timeoutIds: number[] = [];
    const eventStartMs = event.eventDate.getTime();
    const durationMinutes =
      typeof event.durationMinutes === "number" && Number.isFinite(event.durationMinutes)
        ? event.durationMinutes
        : 60;
    const eventEndMs = eventStartMs + durationMinutes * 60_000;

    const scheduleRefreshAt = (targetMs: number) => {
      const delayMs = targetMs - Date.now();
      if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_BROWSER_TIMEOUT_MS) return;
      timeoutIds.push(window.setTimeout(refreshClock, delayMs + EVENT_DETAILS_CUTOFF_TICK_GRACE_MS));
    };

    refreshClock();
    scheduleRefreshAt(eventStartMs);
    scheduleRefreshAt(eventEndMs);

    const intervalId = window.setInterval(refreshClock, EVENT_DETAILS_CLOCK_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [event?.durationMinutes, event?.eventDate, event?.endedAt, event?.status]);

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

  /** Aggregate capacity only (matches server admission — no synthetic per-gender occupancy). */
  const getCapacityStatus = () => {
    const cap = event.maxAttendees;
    const cur = event.currentAttendees;
    const spotsLeft = Math.max(0, cap - cur);
    if (spotsLeft <= 2) return { status: "almostFull" as const, spotsLeft };
    if (spotsLeft <= 5) return { status: "filling" as const, spotsLeft };
    return { status: "available" as const, spotsLeft };
  };

  const capacityInfo = getCapacityStatus();
  const userPrice = event.isFree ? 0 : event.price;
  const soldOut = capacityInfo.spotsLeft <= 0;
  const eventLifecycle = resolveEventLifecycle({
    status: event.status,
    eventDate: event.eventDate,
    durationMinutes: event.durationMinutes,
    endedAt: event.endedAt,
    nowMs: eventClockMs,
  });
  const bookingEditability = resolveEventBookingEditability({
    status: event.status,
    eventDate: event.eventDate,
    durationMinutes: event.durationMinutes,
    endedAt: event.endedAt,
    archivedAt: event.archivedAt,
    nowMs: eventClockMs,
  });
  const eventEnded = eventLifecycle.isEnded;
  const canSelfCancelRegistration = bookingEditability.canSelfCancel;
  const eventClosedForBookingCopy =
    eventEnded || bookingEditability.closedReason === "ended" || bookingEditability.closedReason === "completed";
  const bookingChangesClosed = !canSelfCancelRegistration;
  const confirmedAdmissionLooksClosed =
    eventClosedForBookingCopy || (bookingChangesClosed && !eventLifecycle.isLive);
  const canViewRegistration =
    hasEventAdmission &&
    (canSelfCancelRegistration || (isConfirmed && eventLifecycle.isLive && !eventClosedForBookingCopy));
  const eventStatus = (event.status ?? "").toLowerCase();
  const isCancelled = eventStatus === "cancelled";
  const isUnavailableStatus =
    isCancelled ||
    eventStatus === "draft" ||
    eventStatus === "archived" ||
    Boolean(event.archivedAt);
  const unavailableEventTitle = isCancelled ? "This event was cancelled" : "This event is not available";
  const unavailableEventBody = isCancelled
    ? "Registration, cancellation, and lobby access are closed. Your registration record stays on file for support and attendance history."
    : "Registration and lobby access are closed while this event is not published.";
  const purchaseCtaDisabled = soldOut || eventEnded || freeRegisterBusy || isUnavailableStatus;

  const handlePaymentSuccess = async () => {
    setShowPaymentModal(false);

    if (isUnavailableStatus) {
      toast.error(unavailableEventTitle);
      return;
    }

    if (event.isFree) {
      if (soldOut || eventEnded) return;
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

    const { data: freshSnap } = await refetchRegistration();
    queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
    queryClient.invalidateQueries({ queryKey: ["event-attendees", id] });

    const nowConfirmed = freshSnap?.isConfirmed ?? false;
    const nowWaitlisted = (freshSnap?.isWaitlisted ?? false) && !nowConfirmed;

    if (nowWaitlisted) {
      trackEvent('event_waitlisted', { event_id: id ?? '', event_title: event.title });
      toast.success("You're on the waitlist", {
        description:
          "The event was full when you joined — we'll confirm you if a spot opens. Check the event page for your status.",
      });
    } else if (nowConfirmed) {
      trackEvent('event_registered', { event_id: id ?? '', event_title: event.title });
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#a855f7", "#ec4899", "#06b6d4"],
      });
      toast.success("You're on the list! 🎉", {
        description: "You'll be able to join when the event goes live",
      });
    } else {
      toast.success("Registration received", {
        description: "Open the event page if your registration or status doesn’t update right away.",
      });
    }

    if (nowConfirmed || nowWaitlisted) {
      setTimeout(() => setShowRegistrationStub(true), 800);
    }
  };

  const handlePurchasePress = async () => {
    if (isUnavailableStatus) {
      toast.error(unavailableEventTitle);
      return;
    }
    if (soldOut || eventEnded || freeRegisterBusy) return;
    if (hasEventAdmission) return;
    if (showPaymentModal) return;

    if (event.isFree || userPrice === 0) {
      setFreeRegisterBusy(true);
      try {
        await handlePaymentSuccess();
      } finally {
        setFreeRegisterBusy(false);
      }
      return;
    }
    if (event.visibility === "premium" && !canAccessPremiumEvents) {
      trackEvent("premium_entry_tapped", {
        entry_surface: PREMIUM_ENTRY_SURFACE.PREMIUM_EVENT_REGISTER,
        feature: "canAccessPremiumEvents",
        source_context: event.id,
        platform: "web",
      });
      setVisibilityUpsell("premium");
      return;
    }
    if (event.visibility === "vip" && !canAccessVipEvents) {
      trackEvent("premium_entry_tapped", {
        entry_surface: PREMIUM_ENTRY_SURFACE.VIP_EVENT_REGISTER,
        feature: "canAccessVipEvents",
        source_context: event.id,
        platform: "web",
      });
      setVisibilityUpsell("vip");
      return;
    }
    setShowPaymentModal(true);
  };

  purchasePressRef.current = () => {
    void handlePurchasePress();
  };

  const handleCancelConfirm = async () => {
    if (!canSelfCancelRegistration) {
      setShowCancelRegistrationModal(false);
      setShowManageRegistration(false);
      toast.info("Registration changes are closed for this event.");
      return;
    }

    const wasConfirmed = isConfirmed;
    const wasWaitlisted = isWaitlisted;
    const success = await unregisterFromEvent(event.id);

    if (success) {
      await refetchRegistration();
      queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["event-attendee-preview", id] });

      setShowCancelRegistrationModal(false);
      setShowManageRegistration(false);

      if (wasWaitlisted) {
        toast.success("Left the waitlist", {
          description: "You’re no longer on the waitlist for this event.",
        });
      } else if (wasConfirmed) {
        toast.success("Spot released", {
          description:
            "Your confirmed spot is cancelled for this event. If a waitlist is in use, the next person may be offered the spot according to usual rules. Refund exceptions are handled manually by support.",
        });
      } else {
        toast.success("Registration updated", {
          description: "Your registration for this event has been removed.",
        });
      }
    } else {
      toast.error("Failed to cancel. Please try again.");
    }
  };

  const handleShare = async () => {
    if (!event || !id) return;
    const url = buildEventShareUrl(id, user?.id);
    try {
      await navigator.share({
        title: event.title,
        text: `Join me at ${event.title} on Vibely!`,
        url,
      });
      trackEvent("invite_link_shared", { surface: "event_details", channel: "system_share" });
    } catch (error) {
      if (isWebShareAbortError(error)) return;
      try {
        await navigator.clipboard.writeText(url);
        trackEvent("invite_link_copied", { surface: "event_details", channel: "clipboard" });
        toast.success("Link copied to clipboard!");
      } catch {
        toast.error("Could not copy link. Try again.");
      }
    }
  };

  const preview = attendeePreview?.success === true ? attendeePreview : null;
  const headlineVisibleOtherCount = preview?.visible_other_count ?? 0;

  const rosterRevealed: GuestListRosterAttendee[] = preview
    ? preview.revealed.map((r) => ({
        id: r.id,
        name: r.name,
        age: r.age,
        avatar: resolvePhotoUrl(r.avatar_path || ""),
        vibeTag: r.vibe_label || "Vibing",
        matchPercent: Math.min(99, 42 + r.shared_vibe_count * 9),
        sharedVibeCount: r.shared_vibe_count,
        superVibeTowardViewer: r.super_vibe_toward_viewer,
      }))
    : [];

  const confirmedAdmissionTitle = eventClosedForBookingCopy
    ? "Event ended"
    : eventLifecycle.isLive
      ? "Event is live"
      : bookingChangesClosed
        ? "Registration closed"
        : "You're In!";
  const confirmedAdmissionSubtitle = eventClosedForBookingCopy
    ? "Your registration is now closed"
    : eventLifecycle.isLive
      ? "Join from the online lobby section"
      : bookingChangesClosed
        ? "Registration changes are closed for this event"
        : "See you there";
  const waitlistAdmissionSubtitle = eventClosedForBookingCopy
    ? "This waitlist is now closed"
    : eventLifecycle.isLive || bookingChangesClosed
      ? "Waitlist changes are closed"
      : "We'll confirm you if a spot opens";

  return (
    <div className="min-h-screen bg-background pb-[100px] overflow-y-auto">
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

        {isUnavailableStatus && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-semibold text-destructive">{unavailableEventTitle}</p>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              {unavailableEventBody}
            </p>
          </div>
        )}

        {/* Phone verification nudge for events */}
        {showEventPhoneNudge && !hasEventAdmission && !isUnavailableStatus && (
          <PhoneVerificationNudge
            variant="event"
            userId={user?.id ?? null}
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

        {(() => {
          const lang = getLanguageLabel(event.language);
          return lang ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground -mt-2">
              <Languages className="w-4 h-4 shrink-0 text-primary" />
              <span>Language: {lang.flag} {lang.label}</span>
            </div>
          ) : null;
        })()}

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

        {/* Categories */}
        <div className="flex gap-2 flex-wrap">
          {(event.categories.length > 0
            ? event.categories.map((category) => `${category.emoji} ${category.label}`)
            : event.tags
          ).map((tag) => (
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
          {isConfirmed ? (
            <motion.div
              key="roster"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {attendeePreviewLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : preview ? (
                <GuestListRoster
                  revealed={rosterRevealed}
                  obscuredRemaining={preview.obscured_remaining}
                  visibleCohortCount={preview.visible_cohort_count}
                  visibleOtherCount={preview.visible_other_count}
                  onAttendeeClick={(attendee) => navigate(`/user/${attendee.id}`)}
                  onRegistrationClick={
                    canSelfCancelRegistration
                      ? () => setShowManageRegistration(true)
                      : canViewRegistration
                        ? () => setShowRegistrationStub(true)
                        : undefined
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Could not load guest preview. Pull to refresh or try again shortly.
                </p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="teaser"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <GuestListTeaser
                viewerAdmission={isWaitlisted ? "waitlisted" : "none"}
                visibleOtherCount={headlineVisibleOtherCount}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mutual Vibes Section - Only show for registered users with mutual vibes */}
        {isConfirmed && eventVibes.mutualVibes.length > 0 && (
          <MutualVibesSection
            mutualVibes={eventVibes.mutualVibes}
            onProfileClick={(profileId) => navigate(`/user/${profileId}`)}
          />
        )}

        {/* Online lobby */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Online Lobby</h2>
          <VenueCard
            eventDate={event.eventDate}
            eventDurationMinutes={event.durationMinutes}
            eventStatus={event.status}
            eventEndedAt={event.endedAt}
            eventId={event.id}
            isRegistered={isConfirmed}
            onAccessPress={!isConfirmed && !isUnavailableStatus ? () => void handlePurchasePress() : undefined}
            accessLabel={event.isFree || userPrice === 0 ? "Register" : "Reserve Spot"}
            accessDisabled={purchaseCtaDisabled}
          />
        </div>
      </div>

      {/* Sticky Bottom Bar - Only show when not registered */}
      {!hasEventAdmission && !isUnavailableStatus && (
        <PricingBar
          price={userPrice}
          capacityStatus={capacityInfo.status}
          spotsLeft={capacityInfo.spotsLeft}
          onPurchase={() => void handlePurchasePress()}
          isPurchasing={freeRegisterBusy}
          soldOut={soldOut}
          eventEnded={eventEnded}
        />
      )}

      {isUnavailableStatus && hasEventAdmission && (
        <div className="fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-destructive/30 rounded-none">
          <div className="max-w-lg mx-auto p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-destructive">{isCancelled ? "Event cancelled" : "Event unavailable"}</p>
              <p className="text-xs text-muted-foreground">Registration changes are closed for this event</p>
            </div>
          </div>
        </div>
      )}

      {/* Confirmed admission bottom bar */}
      {isConfirmed && !isUnavailableStatus && (
        <div className="fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-border/50 rounded-none">
          <div className="max-w-lg mx-auto p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                animate={confirmedAdmissionLooksClosed ? undefined : { scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className={
                  confirmedAdmissionLooksClosed
                    ? "w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center"
                    : "w-10 h-10 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center"
                }
              >
                {confirmedAdmissionLooksClosed ? (
                  <Clock className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <Sparkles className="w-5 h-5 text-white" />
                )}
              </motion.div>
              <div>
                <p className="font-semibold text-foreground">{confirmedAdmissionTitle}</p>
                <p className="text-xs text-muted-foreground">{confirmedAdmissionSubtitle}</p>
              </div>
            </div>
            {canSelfCancelRegistration ? (
              <Button variant="outline" onClick={() => setShowManageRegistration(true)}>
                Manage Registration
              </Button>
            ) : canViewRegistration ? (
              <Button variant="outline" onClick={() => setShowRegistrationStub(true)}>
                View Registration
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Paid waitlist: show truthful status without implying a confirmed spot */}
      {isWaitlisted && !isConfirmed && !isUnavailableStatus && (
        <div className="fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-border/50 rounded-none">
          <div className="max-w-lg mx-auto p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">You're on the paid waitlist</p>
              <p className="text-xs text-muted-foreground">{waitlistAdmissionSubtitle}</p>
            </div>
            {canSelfCancelRegistration ? (
              <Button variant="outline" onClick={() => setShowManageRegistration(true)}>
                Manage Registration
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Modals */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        eventId={event.id}
        eventTitle={event.title}
        eventDate={formatDate(event.eventDate)}
        price={userPrice}
      />

      <ManageRegistrationModal
        isOpen={showManageRegistration && canSelfCancelRegistration}
        onClose={() => setShowManageRegistration(false)}
        onCancel={() => {
          if (!canSelfCancelRegistration) {
            setShowManageRegistration(false);
            toast.info("Registration changes are closed for this event.");
            return;
          }
          setShowManageRegistration(false);
          setShowCancelRegistrationModal(true);
        }}
        eventId={event.id}
        referrerUserId={user?.id}
        eventTitle={event.title}
        eventDate={formatDate(event.eventDate)}
        eventTime={event.time}
        registrationNumber={`VBL-${event.id.slice(0, 8).toUpperCase()}`}
        price={userPrice}
        admissionStatus={isConfirmed ? "confirmed" : "waitlisted"}
        canCancel={canSelfCancelRegistration}
      />

      <CancelRegistrationModal
        isOpen={showCancelRegistrationModal && canSelfCancelRegistration}
        onClose={() => setShowCancelRegistrationModal(false)}
        onConfirm={handleCancelConfirm}
        eventTitle={event.title}
        admissionStatus={isConfirmed ? "confirmed" : "waitlisted"}
      />

      <PremiumUpsellDialog
        open={visibilityUpsell !== null}
        onOpenChange={(o) => {
          if (!o) setVisibilityUpsell(null);
        }}
        navigate={navigate}
        title={
          visibilityUpsell === "vip"
            ? "This event needs VIP access"
            : "This event is Premium-only"
        }
        description={
          visibilityUpsell === "vip"
            ? "Your current membership tier does not include VIP-tier events. Upgrade or change plans to match what this experience requires."
            : "Premium members can register for Premium-tier events on Vibely. Upgrade to unlock this registration path."
        }
        funnel={
          visibilityUpsell === "vip"
            ? {
                entry_surface: PREMIUM_ENTRY_SURFACE.VIP_EVENT_REGISTER,
                feature: "canAccessVipEvents",
                source_context: id ?? undefined,
              }
            : {
                entry_surface: PREMIUM_ENTRY_SURFACE.PREMIUM_EVENT_REGISTER,
                feature: "canAccessPremiumEvents",
                source_context: id ?? undefined,
              }
        }
        continueLabel="View membership options"
      />

      {/* Registration Stub */}
      <AnimatePresence>
        {showRegistrationStub && canViewRegistration && (
          <RegistrationStub
            eventTitle={event.title}
            eventDate={formatDate(event.eventDate)}
            eventTime={event.time}
            registrationNumber={`VBL-${event.id.slice(0, 8).toUpperCase()}`}
            onClose={() => setShowRegistrationStub(false)}
            admissionStatus={isConfirmed ? "confirmed" : "waitlisted"}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default EventDetails;
