import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import { motion } from "framer-motion";
import { Clock, Sparkles, Users, ArrowRight, CalendarCheck, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUserRegistrations } from "@/hooks/useRegistrations";
import { useEventAttendees } from "@/hooks/useEventAttendees";
import { isEventExpired } from "@/utils/eventUtils";
import { eventCoverHeroUrl, getImageUrl } from "@/utils/imageUrl";
import { getLanguageLabel } from "@/lib/eventLanguages";

interface FeaturedEventCardProps {
  id: string;
  title: string;
  description: string | null;
  image: string;
  eventDate: Date;
  attendees: number;
  tags: string[];
  status?: string;
  durationMinutes?: number;
  language?: string | null;
}

export const FeaturedEventCard = ({
  id,
  title,
  description,
  image,
  eventDate,
  attendees,
  tags,
  status,
  durationMinutes = 60,
  language,
}: FeaturedEventCardProps) => {
  const navigate = useNavigate();
  const { data: admission = { confirmedEventIds: [], waitlistedEventIds: [] } } = useUserRegistrations();
  const { data: eventAttendees = [], preview: attendeePreview } = useEventAttendees(id, 5);
  const goingCount =
    attendeePreview?.success === true ? attendeePreview.total_other_confirmed : attendees;
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [isLive, setIsLive] = useState(status === "live");
  const [imageFailed, setImageFailed] = useState(false);
  const coverSrc = eventCoverHeroUrl(image);
  const pastScheduledEnd = isEventExpired({
    event_date: eventDate.toISOString(),
    duration_minutes: durationMinutes,
  });
  /** Server `ended` includes grace window; early admin end may set ended before scheduled end. */
  const showEnded = status === "ended" || pastScheduledEnd;

  const isConfirmedSeat = admission.confirmedEventIds.includes(id);
  const isWaitlistedSeat = admission.waitlistedEventIds.includes(id);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const startTime = eventDate.getTime();
      const endTime = startTime + durationMinutes * 60 * 1000;
      const diff = startTime - now.getTime();
      
      // Check if event is live
      if (now.getTime() >= startTime && now.getTime() < endTime) {
        setIsLive(true);
        return { hours: 0, minutes: 0, seconds: 0 };
      }
      
      // Check if event ended
      if (now.getTime() >= endTime) {
        setIsLive(false);
        return { hours: 0, minutes: 0, seconds: 0 };
      }
      
      setIsLive(false);
      
      if (diff <= 0) {
        return { hours: 0, minutes: 0, seconds: 0 };
      }

      return {
        hours: Math.floor(diff / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      };
    };

    setTimeLeft(calculateTimeLeft());
    const timer = setInterval(() => setTimeLeft(calculateTimeLeft()), 1000);
    return () => clearInterval(timer);
  }, [eventDate, durationMinutes]);

  useEffect(() => {
    setImageFailed(false);
  }, [coverSrc]);

  // Primary action button handler
  const handlePrimaryAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    trackEvent('event_card_tapped', { event_id: id, title, surface: 'featured' });
    navigate(`/events/${id}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => { trackEvent('event_card_tapped', { event_id: id, title, surface: 'featured' }); navigate(`/events/${id}`); }}
      className="relative w-full h-[420px] md:h-[480px] rounded-3xl overflow-hidden cursor-pointer"
    >
      {/* Background Image */}
      <div className="absolute inset-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(125%_95%_at_8%_14%,hsl(var(--primary)/0.34)_0%,transparent_58%),radial-gradient(120%_105%_at_90%_18%,hsl(var(--accent)/0.26)_0%,transparent_56%),linear-gradient(135deg,hsl(var(--neon-cyan)/0.15)_0%,hsl(var(--background)/0.08)_55%,hsl(var(--background)/0.34)_100%)]" />
        {!imageFailed && (
          <img
            src={coverSrc}
            alt={title}
            onError={() => setImageFailed(true)}
            className={cn("w-full h-full object-cover", showEnded && "grayscale-[40%] brightness-75")}
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(10,12,24,0.06)_0%,rgba(10,12,24,0.26)_58%,rgba(10,12,24,0.45)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,4,12,0.38)_0%,rgba(2,4,12,0.12)_30%,rgba(2,4,12,0)_45%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,4,12,0)_0%,rgba(2,4,12,0.14)_44%,rgba(2,4,12,0.46)_72%,rgba(2,4,12,0.78)_100%)]" />
      </div>

      {/* Content */}
      <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
        {/* Featured Badge, LIVE Badge, or Ended Badge */}
        {showEnded ? (
          <div
            className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 rounded-full bg-background/55 border border-border/20 backdrop-blur-md text-muted-foreground"
            style={{ letterSpacing: '0.04em' }}
          >
            <span className="w-2 h-2 rounded-full bg-accent" style={{ boxShadow: '0 0 8px hsl(var(--accent))' }} />
            <span className="text-sm font-semibold">Event Ended</span>
          </div>
        ) : isLive ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/90 backdrop-blur-md"
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="w-2.5 h-2.5 rounded-full bg-destructive-foreground"
            />
            <span className="text-sm font-bold text-destructive-foreground uppercase tracking-wider">Live Now</span>
          </motion.div>
        ) : (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 backdrop-blur-md border border-primary/30"
          >
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary">Featured Event</span>
          </motion.div>
        )}

        {/* Countdown Timer - Only show if not live */}
        {!isLive && !showEnded && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="absolute top-6 right-6"
          >
            <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-background/40 backdrop-blur-md border border-white/10">
              <Clock className="w-4 h-4 text-neon-cyan" />
              <div className="flex items-center gap-1 font-mono text-lg font-bold">
                <span className="text-foreground">{String(timeLeft.hours).padStart(2, '0')}</span>
                <span className="text-neon-cyan animate-pulse">:</span>
                <span className="text-foreground">{String(timeLeft.minutes).padStart(2, '0')}</span>
                <span className="text-neon-cyan animate-pulse">:</span>
                <span className="text-foreground">{String(timeLeft.seconds).padStart(2, '0')}</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.slice(0, 3).map((tag, index) => (
            <motion.span
              key={tag}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + index * 0.1 }}
              className="px-3 py-1.5 text-sm font-medium rounded-full bg-neon-violet/20 text-neon-violet border border-neon-violet/30 backdrop-blur-sm"
            >
              {tag}
            </motion.span>
          ))}
        </div>

        {(() => {
          const lang = getLanguageLabel(language);
          return lang ? (
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-xs text-white/80 backdrop-blur-sm mb-3 w-fit">
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </div>
          ) : null;
        })()}

        {/* Title & Description */}
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2"
        >
          {title}
        </motion.h2>
        
        {description && (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-muted-foreground text-lg max-w-lg mb-6 line-clamp-2"
          >
            {description}
          </motion.p>
        )}

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex items-center justify-between"
        >
          {/* Attendees - Real avatars */}
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {eventAttendees.length > 0 ? (
                eventAttendees.slice(0, 2).map((attendee) => {
                  const path = attendee.avatar_url || attendee.photos?.[0];
                  const avatarUrl = path ? getImageUrl(path) : null;
                  return (
                    <div
                      key={attendee.id}
                      className="w-8 h-8 rounded-full border-2 border-background overflow-hidden bg-gradient-to-br from-neon-pink to-neon-violet"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={attendee.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-white">
                          {attendee.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                // Fallback placeholder circles when no attendees yet
                [1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-pink to-neon-violet border-2 border-background"
                  />
                ))
              )}
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="w-4 h-4" />
              <span className="font-medium">+{goingCount} going</span>
            </div>
          </div>

          {/* Primary Action Button - Context-aware */}
          {showEnded ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-muted-foreground/60 font-medium">
                This vibe has passed — but more are waiting
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); navigate("/events"); }}
                className="px-6 py-3 rounded-full text-base font-semibold text-primary-foreground transition-all active:scale-95"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                  boxShadow: '0 0 20px hsl(var(--primary) / 0.4)',
                }}
              >
                ✦ Discover Upcoming Events
              </button>
            </div>
          ) : (
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            {isConfirmedSeat ? (
              <Button
                onClick={handlePrimaryAction}
                className={cn(
                  "relative px-6 py-6 text-lg font-semibold rounded-full",
                  "bg-gradient-to-r from-neon-cyan to-primary",
                  "shadow-[0_0_30px_rgba(6,182,212,0.4)]",
                  "hover:shadow-[0_0_40px_rgba(6,182,212,0.6)]",
                  "transition-shadow duration-300"
                )}
              >
                <Ticket className="w-5 h-5 mr-2" />
                View Ticket
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : isWaitlistedSeat ? (
              <Button
                onClick={handlePrimaryAction}
                className={cn(
                  "relative px-6 py-6 text-lg font-semibold rounded-full",
                  "bg-gradient-to-r from-amber-500 to-orange-600",
                  "shadow-[0_0_30px_rgba(245,158,11,0.35)]",
                  "transition-shadow duration-300"
                )}
              >
                <Ticket className="w-5 h-5 mr-2" />
                On waitlist
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handlePrimaryAction}
                className={cn(
                  "relative px-8 py-6 text-lg font-semibold rounded-full",
                  "bg-gradient-to-r from-neon-pink to-neon-violet",
                  "shadow-[0_0_30px_rgba(236,72,153,0.4)]",
                  "hover:shadow-[0_0_40px_rgba(236,72,153,0.6)]",
                  "transition-shadow duration-300"
                )}
              >
                <CalendarCheck className="w-5 h-5 mr-2" />
                Get Tickets
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </motion.div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
};
