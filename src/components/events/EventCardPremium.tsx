import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "@/lib/analytics";
import { motion, AnimatePresence } from "framer-motion";
import { Ticket, MapPin, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getLanguageLabel } from "@/lib/eventLanguages";
import { useUserRegistrations } from "@/hooks/useRegistrations";
import { isEventExpired } from "@/utils/eventUtils";
import { eventCoverCardUrl } from "@/utils/imageUrl";

interface EventCardPremiumProps {
  id: string;
  title: string;
  image: string;
  date: string;
  time: string;
  attendees: number;
  tags: string[];
  vibeMatch?: number;
  status?: string;
  scope?: string;
  city?: string | null;
  country?: string | null;
  distanceKm?: number | null;
  eventDateRaw?: string;
  durationMinutes?: number;
  language?: string | null;
}

const tagEmojis: Record<string, string> = {
  "Music": "🎧",
  "Techno": "🎧",
  "Tech": "💻",
  "Gaming": "🎮",
  "Food": "🍕",
  "Art": "🎨",
  "Speed Date": "⚡",
  "Outdoor": "🌳",
  "Wellness": "🧘",
  "Film": "🎬",
  "Books": "📚",
};

export const EventCardPremium = ({
  id,
  title,
  image,
  date,
  time,
  attendees,
  tags,
  vibeMatch = Math.floor(Math.random() * 20) + 80,
  status,
  scope,
  city,
  country,
  distanceKm,
  eventDateRaw,
  durationMinutes,
  language,
}: EventCardPremiumProps) => {
  const isLive = status === "live";
  const pastScheduledEnd = eventDateRaw
    ? isEventExpired({ event_date: eventDateRaw, duration_minutes: durationMinutes })
    : false;
  const showEnded = status === "ended" || pastScheduledEnd;
  const navigate = useNavigate();
  const { data: admission = { confirmedEventIds: [], waitlistedEventIds: [] } } = useUserRegistrations();

  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isWaitlisted, setIsWaitlisted] = useState(false);

  useEffect(() => {
    setIsConfirmed(admission.confirmedEventIds.includes(id));
    setIsWaitlisted(admission.waitlistedEventIds.includes(id));
  }, [admission.confirmedEventIds, admission.waitlistedEventIds, id]);

  const handleOpenDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    trackEvent('event_card_tapped', { event_id: id, title });
    navigate(`/events/${id}`);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      onClick={() => { trackEvent('event_card_tapped', { event_id: id, title }); navigate(`/events/${id}`); }}
      className="relative w-[280px] md:w-[320px] flex-shrink-0 rounded-2xl overflow-hidden bg-card border border-border/50 group cursor-pointer"
    >
      {/* Image */}
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={eventCoverCardUrl(image)}
          alt={title}
          className={cn(
            "w-full h-full object-cover transition-transform duration-500 group-hover:scale-110",
            showEnded && "grayscale-[40%] brightness-75"
          )}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
        
        {/* Event Ended badge */}
        {showEnded && (
          <div
            className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-background/55 border border-border/20 backdrop-blur-md text-muted-foreground"
            style={{ letterSpacing: '0.04em' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ boxShadow: '0 0 6px hsl(var(--accent))' }} />
            Event Ended
          </div>
        )}
        
        {/* LIVE Badge - shown when event is active */}
        {isLive && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/90 backdrop-blur-sm"
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-white"
            />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Live</span>
          </motion.div>
        )}
        
        {/* Vibe Match Badge */}
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className={cn(
            "absolute top-3 right-3 px-3 py-1.5 rounded-full",
            "bg-background/60 backdrop-blur-md border",
            vibeMatch >= 90
              ? "border-neon-pink/50 shadow-[0_0_15px_rgba(236,72,153,0.3)]"
              : "border-neon-violet/50 shadow-[0_0_15px_rgba(139,92,246,0.3)]"
          )}
        >
          <span
            className={cn(
              "text-sm font-bold",
              vibeMatch >= 90 ? "text-neon-pink" : "text-neon-violet"
            )}
          >
            {vibeMatch}% Match
          </span>
        </motion.div>

        {/* Tags */}
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-1 text-xs font-medium rounded-full bg-background/50 backdrop-blur-sm text-foreground border border-white/10"
            >
              {tagEmojis[tag] || "✨"} {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <h3 className="font-display font-semibold text-lg text-foreground line-clamp-1 group-hover:text-primary transition-colors">
          {title}
        </h3>

        {/* Location context */}
        {scope === 'local' && city && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground -mt-1">
            <MapPin className="w-3 h-3 shrink-0" />
            <span>{city}{distanceKm != null ? ` · ${Math.round(distanceKm)}km away` : ''}</span>
          </div>
        )}
        {scope === 'regional' && country && (
          <div className="text-xs text-muted-foreground -mt-1">🏳️ {country}</div>
        )}
        {(scope === 'global' || !scope) && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground -mt-1">
            <Globe className="w-3 h-3" />
            <span>Global Event</span>
          </div>
        )}

        {(() => {
          const lang = getLanguageLabel(language);
          return lang ? (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs text-muted-foreground -mt-0.5 w-fit">
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </div>
          ) : null;
        })()}

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{date} • {time}</span>
          
          {/* Social Proof */}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-5 h-5 rounded-full bg-gradient-to-br from-neon-pink/60 to-neon-violet/60 border border-background"
                />
              ))}
            </div>
            <span className="text-xs">+{attendees}</span>
          </div>
        </div>

        {/* CTA — expired vs normal */}
        {showEnded ? (
          <div className="space-y-2 text-center">
            <p className="text-xs font-medium text-muted-foreground/60">
              This vibe has passed — but more are waiting
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); navigate("/events"); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-primary-foreground transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
                boxShadow: '0 0 16px hsl(var(--primary) / 0.4)',
              }}
            >
              ✦ Discover Upcoming Events
            </button>
          </div>
        ) : (
        <AnimatePresence mode="wait">
          {isConfirmed || isWaitlisted ? (
            <motion.button
              key="registered"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-medium"
            >
              <Ticket className="w-4 h-4" />
              {isConfirmed ? "View Ticket" : "On waitlist"}
            </motion.button>
          ) : (
            <motion.div key="register" whileTap={{ scale: 0.97 }}>
              <Button
                onClick={handleOpenDetails}
                variant="gradient"
                className="w-full relative overflow-hidden"
              >
                <motion.span
                  key="text"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  Get Tickets
                </motion.span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
};
