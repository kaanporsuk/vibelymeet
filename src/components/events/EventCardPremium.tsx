import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Ticket, Sparkles, MapPin, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUserRegistrations, useRegisterForEvent } from "@/hooks/useRegistrations";
import { useQueryClient } from "@tanstack/react-query";

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
}: EventCardPremiumProps) => {
  const isLive = status === "live";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: userRegistrations = [] } = useUserRegistrations();
  const { registerForEvent } = useRegisterForEvent();
  
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Sync with server registration state
  useEffect(() => {
    setIsRegistered(userRegistrations.includes(id));
  }, [userRegistrations, id]);

  const handleRegister = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLoading(true);
    
    const success = await registerForEvent(id);
    
    if (success) {
      setIsRegistered(true);
      setShowConfetti(true);
      queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      
      toast.success("You're on the list! 🎉", {
        description: `See you at ${title}`,
      });

      setTimeout(() => setShowConfetti(false), 1500);
    } else {
      toast.error("Failed to register. Please try again.");
    }
    
    setIsLoading(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      onClick={() => navigate(`/events/${id}`)}
      className="relative w-[280px] md:w-[320px] flex-shrink-0 rounded-2xl overflow-hidden bg-card border border-border/50 group cursor-pointer"
    >
      {/* Confetti Effect */}
      <AnimatePresence>
        {showConfetti && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 pointer-events-none"
          >
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={i}
                initial={{
                  x: "50%",
                  y: "50%",
                  scale: 0,
                }}
                animate={{
                  x: `${Math.random() * 100}%`,
                  y: `${Math.random() * 100}%`,
                  scale: [0, 1, 0],
                  rotate: Math.random() * 360,
                }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className={cn(
                  "absolute w-2 h-2 rounded-full",
                  i % 3 === 0 ? "bg-neon-pink" : i % 3 === 1 ? "bg-neon-cyan" : "bg-neon-violet"
                )}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image */}
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
        
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

        {/* Register Button */}
        <AnimatePresence mode="wait">
          {isRegistered ? (
            <motion.button
              key="registered"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-medium"
            >
              <Ticket className="w-4 h-4" />
              View Ticket
            </motion.button>
          ) : (
            <motion.div key="register" whileTap={{ scale: 0.97 }}>
              <Button
                onClick={handleRegister}
                disabled={isLoading}
                variant="gradient"
                className="w-full relative overflow-hidden"
              >
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className="flex items-center gap-2"
                    >
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                      >
                        <Sparkles className="w-4 h-4" />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.span
                      key="text"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                    >
                      Register
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
