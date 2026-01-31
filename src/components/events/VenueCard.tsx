import { motion } from "framer-motion";
import { MapPin, Video, ExternalLink, Clock, Wifi, Lock, Play, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useVideoMatching } from "@/hooks/useVideoMatching";

interface VenueCardProps {
  isVirtual: boolean;
  venueName?: string;
  address?: string;
  eventDate: Date;
  eventDurationMinutes?: number;
  eventId?: string;
  isRegistered?: boolean;
}

const VenueCard = ({ 
  isVirtual, 
  venueName, 
  address, 
  eventDate, 
  eventDurationMinutes = 60,
  eventId,
  isRegistered = false 
}: VenueCardProps) => {
  const [timeUntil, setTimeUntil] = useState("");
  const [eventStatus, setEventStatus] = useState<"upcoming" | "live" | "ended">("upcoming");
  
  // Video matching hook - only active during live events for registered users
  const matching = useVideoMatching({ 
    eventId: eventId || "", 
    autoNavigate: true 
  });

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const startTime = eventDate.getTime();
      const endTime = startTime + eventDurationMinutes * 60 * 1000;
      const diff = startTime - now.getTime();

      // Check if event has ended
      if (now.getTime() >= endTime) {
        setEventStatus("ended");
        setTimeUntil("Event ended");
        return;
      }

      // Check if event is live (between start and end)
      if (now.getTime() >= startTime && now.getTime() < endTime) {
        setEventStatus("live");
        const remainingMs = endTime - now.getTime();
        const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
        setTimeUntil(`${remainingMinutes}m remaining`);
        return;
      }

      // Event is upcoming
      setEventStatus("upcoming");
      
      if (diff <= 0) {
        setTimeUntil("Starting now!");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setTimeUntil(`${days}d ${hours % 24}h`);
      } else if (hours > 0) {
        setTimeUntil(`${hours}h ${minutes}m`);
      } else {
        setTimeUntil(`${minutes}m`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 10000); // Update every 10 seconds for accuracy
    return () => clearInterval(interval);
  }, [eventDate, eventDurationMinutes]);

  const handleJoinEvent = () => {
    if (eventId && eventStatus === "live") {
      // Use the matching system to find a partner
      matching.joinQueue();
    }
  };

  const isSearching = matching.status === "searching";
  const isMatched = matching.status === "matched";

  if (isVirtual) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-5 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Video className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Digital Lobby</h3>
            <p className="text-sm text-muted-foreground">Video Speed Dating</p>
          </div>
        </div>

        {/* Animated Digital Grid */}
        <div className="relative h-32 rounded-xl bg-gradient-to-br from-secondary to-background overflow-hidden border border-border">
          {/* Grid Pattern */}
          <div className="absolute inset-0 opacity-20">
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-px h-full bg-primary"
                style={{ left: `${(i + 1) * 8}%` }}
                animate={{ opacity: [0.2, 0.6, 0.2] }}
                transition={{ duration: 2, delay: i * 0.1, repeat: Infinity }}
              />
            ))}
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-full h-px bg-primary"
                style={{ top: `${(i + 1) * 16}%` }}
                animate={{ opacity: [0.2, 0.6, 0.2] }}
                transition={{ duration: 2, delay: i * 0.15, repeat: Infinity }}
              />
            ))}
          </div>

          {/* Center Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            {isSearching && isRegistered ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="flex items-center gap-2"
                >
                  <Users className="w-6 h-6 text-primary" />
                </motion.div>
                <span className="text-sm font-bold text-primary">Finding your match...</span>
                <Button variant="ghost" size="sm" onClick={() => matching.leaveQueue()}>
                  Cancel
                </Button>
              </>
            ) : isMatched && isRegistered ? (
              <>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, repeat: 3 }}
                  className="flex items-center gap-2"
                >
                  <div className="w-4 h-4 rounded-full bg-green-500" />
                  <span className="text-sm font-bold text-green-500">Match Found!</span>
                </motion.div>
                <span className="text-xs text-muted-foreground">Connecting...</span>
              </>
            ) : eventStatus === "live" && isRegistered ? (
              <>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="flex items-center gap-2"
                >
                  <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-bold text-green-500">LIVE NOW</span>
                </motion.div>
                <span className="text-xs text-muted-foreground">{timeUntil}</span>
              </>
            ) : eventStatus === "ended" ? (
              <>
                <Lock className="w-6 h-6 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Event has ended</span>
              </>
            ) : isRegistered ? (
              <>
                <motion.div
                  animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="flex items-center gap-2"
                >
                  <Wifi className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium text-primary">Ready to connect</span>
                </motion.div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">Link unlocks in: {timeUntil}</span>
                </div>
              </>
            ) : (
              <>
                <Lock className="w-6 h-6 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Register to unlock access</span>
              </>
            )}
          </div>

          {/* Glow Effect */}
          <div className="absolute inset-0 bg-gradient-radial from-primary/10 via-transparent to-transparent" />
        </div>

        {/* Action Button - changes based on event and matching status */}
        {isSearching && isRegistered ? (
          <Button variant="outline" className="w-full" disabled>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Finding Match...
          </Button>
        ) : isMatched && isRegistered ? (
          <Button className="w-full bg-green-500 hover:bg-green-600 text-white" disabled>
            <Video className="w-4 h-4 mr-2" />
            Connecting to Date...
          </Button>
        ) : eventStatus === "live" && isRegistered ? (
          <Button 
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
            onClick={handleJoinEvent}
            disabled={matching.isLoading}
          >
            {matching.isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Join Event Now
          </Button>
        ) : eventStatus === "ended" ? (
          <Button variant="outline" className="w-full" disabled>
            <Video className="w-4 h-4 mr-2" />
            Event Ended
          </Button>
        ) : isRegistered ? (
          <Button variant="outline" className="w-full" disabled>
            <Video className="w-4 h-4 mr-2" />
            Join Link Available Soon
          </Button>
        ) : (
          <Button variant="ghost" className="w-full text-muted-foreground" disabled>
            <Lock className="w-4 h-4 mr-2" />
            Register to Access
          </Button>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
          <MapPin className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">{venueName || "Secret Location"}</h3>
          <p className="text-sm text-muted-foreground">{address || "Address revealed after registration"}</p>
        </div>
      </div>

      {/* Mock Map */}
      <div className="relative h-40 rounded-xl overflow-hidden border border-border">
        <div className="absolute inset-0 bg-secondary">
          {/* Stylized Map Grid */}
          <svg className="absolute inset-0 w-full h-full opacity-30">
            <defs>
              <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--border))" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mapGrid)" />
          </svg>

          {/* Map Lines */}
          <svg className="absolute inset-0 w-full h-full">
            <path
              d="M 20 80 Q 80 60 120 90 T 200 70 T 280 85"
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="2"
              opacity="0.3"
            />
            <path
              d="M 30 120 Q 100 100 160 130 T 260 110"
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="2"
              opacity="0.2"
            />
          </svg>

          {/* Location Pin */}
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div className="relative">
              <MapPin className="w-8 h-8 text-accent drop-shadow-lg" fill="hsl(var(--accent))" />
              <motion.div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full bg-accent/40"
                animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0.2, 0.4] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
          </motion.div>
        </div>

        {/* Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background to-transparent h-16" />
      </div>

      <Button variant="outline" className="w-full">
        <ExternalLink className="w-4 h-4 mr-2" />
        Get Directions
      </Button>
    </motion.div>
  );
};

export default VenueCard;
