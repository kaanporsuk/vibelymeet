import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Clock, Sparkles, Users, ArrowRight, CalendarCheck, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUserRegistrations } from "@/hooks/useRegistrations";
import { useEventAttendees } from "@/hooks/useEventAttendees";
import { isEventExpired } from "@/utils/eventUtils";

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
}: FeaturedEventCardProps) => {
  const navigate = useNavigate();
  const { data: userRegistrations = [] } = useUserRegistrations();
  const { data: eventAttendees = [] } = useEventAttendees(id, 5);
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [isLive, setIsLive] = useState(status === "live");

  const isRegistered = userRegistrations.includes(id);

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

  // Primary action button handler
  const handlePrimaryAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/events/${id}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate(`/events/${id}`)}
      className="relative w-full h-[420px] md:h-[480px] rounded-3xl overflow-hidden cursor-pointer"
    >
      {/* Background Image */}
      <div className="absolute inset-0">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
        {/* Featured Badge or LIVE Badge */}
        {isLive ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="absolute top-6 left-6 flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/90 backdrop-blur-md"
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="w-2.5 h-2.5 rounded-full bg-white"
            />
            <span className="text-sm font-bold text-white uppercase tracking-wider">Live Now</span>
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
        {!isLive && (
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
                eventAttendees.slice(0, 3).map((attendee) => {
                  const avatarUrl = attendee.avatar_url || attendee.photos?.[0];
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
              <span className="font-medium">+{attendees} going</span>
            </div>
          </div>

          {/* Primary Action Button - Context-aware */}
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            {isRegistered ? (
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
        </motion.div>
      </div>
    </motion.div>
  );
};
