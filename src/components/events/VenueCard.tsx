import { motion } from "framer-motion";
import { Video, Clock, Wifi, Lock, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { resolveEventLifecycle } from "@/lib/eventLifecycle";
import { preloadRoute } from "@/lib/routePreload";

interface VenueCardProps {
  eventDate: Date;
  eventDurationMinutes?: number;
  eventStatus?: string | null;
  eventEndedAt?: Date | string | number | null;
  eventArchivedAt?: Date | string | number | null;
  eventId?: string;
  isRegistered?: boolean;
  onAccessPress?: () => void;
  accessLabel?: string;
  accessDisabled?: boolean;
}

const VenueCard = ({ 
  eventDate, 
  eventDurationMinutes = 60,
  eventStatus: rawEventStatus,
  eventEndedAt,
  eventArchivedAt,
  eventId,
  isRegistered = false,
  onAccessPress,
  accessLabel = "Reserve Spot",
  accessDisabled = false,
}: VenueCardProps) => {
  const navigate = useNavigate();
  const [timeUntil, setTimeUntil] = useState("");
  const [lobbyLifecycleStatus, setLobbyLifecycleStatus] = useState<"upcoming" | "live" | "ended">("upcoming");

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const startTime = eventDate.getTime();
      const endTime = startTime + eventDurationMinutes * 60 * 1000;
      const diff = startTime - now.getTime();
      const lifecycle = resolveEventLifecycle({
        status: rawEventStatus,
        eventDate,
        durationMinutes: eventDurationMinutes,
        endedAt: eventEndedAt,
        archivedAt: eventArchivedAt,
        nowMs: now.getTime(),
      });

      if (lifecycle.isArchived || lifecycle.isEnded) {
        setLobbyLifecycleStatus("ended");
        setTimeUntil("Event ended");
        return;
      }

      if (lifecycle.isLive) {
        setLobbyLifecycleStatus("live");
        const remainingMs = endTime - now.getTime();
        const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
        setTimeUntil(`${remainingMinutes}m remaining`);
        return;
      }

      setLobbyLifecycleStatus("upcoming");
      
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
    const interval = setInterval(updateCountdown, 10000);
    return () => clearInterval(interval);
  }, [eventArchivedAt, eventDate, eventDurationMinutes, eventEndedAt, rawEventStatus]);

  const handleEnterLobby = () => {
    if (eventId && lobbyLifecycleStatus === "live") {
      navigate(`/event/${eventId}/lobby`);
    }
  };

  const prefetchLobby = () => preloadRoute("eventLobby");

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

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            {lobbyLifecycleStatus === "live" && isRegistered ? (
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
            ) : lobbyLifecycleStatus === "ended" ? (
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
                  <span className="text-xs">Lobby opens in: {timeUntil}</span>
                </div>
              </>
            ) : (
              <>
                <Lock className="w-6 h-6 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Register to unlock access</span>
              </>
            )}
          </div>

          <div className="absolute inset-0 bg-gradient-radial from-primary/10 via-transparent to-transparent" />
        </div>

        {/* Action Button */}
        {lobbyLifecycleStatus === "live" && isRegistered ? (
          <Button 
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
            onMouseEnter={prefetchLobby}
            onFocus={prefetchLobby}
            onClick={handleEnterLobby}
          >
            <Play className="w-4 h-4 mr-2" />
            Enter Lobby
          </Button>
        ) : lobbyLifecycleStatus === "ended" ? (
          <Button variant="outline" className="w-full" disabled>
            <Video className="w-4 h-4 mr-2" />
            Event Ended
          </Button>
        ) : isRegistered ? (
          <Button variant="outline" className="w-full" disabled>
            <Video className="w-4 h-4 mr-2" />
            Lobby Opens Soon
          </Button>
        ) : (
          onAccessPress ? (
            <Button variant="outline" className="w-full" onClick={onAccessPress} disabled={accessDisabled}>
              <Lock className="w-4 h-4 mr-2" />
              {accessLabel}
            </Button>
          ) : (
            <div className="w-full rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-center text-sm text-muted-foreground">
              <Lock className="w-4 h-4 inline mr-1" />
              Register from event details below
            </div>
          )
        )}
    </motion.div>
  );
};

export default VenueCard;
