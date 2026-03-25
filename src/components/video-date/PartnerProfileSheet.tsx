import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Briefcase,
  Ruler,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface PartnerProfile {
  name: string;
  age: number;
  avatarUrl?: string;
  photos?: string[];
  about_me?: string;
  job?: string;
  location?: string;
  heightCm?: number;
  tags: string[];
  prompts?: { question: string; answer: string }[];
}

interface PartnerProfileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  partner: PartnerProfile;
}

export const PartnerProfileSheet = ({
  isOpen,
  onClose,
  partner,
}: PartnerProfileSheetProps) => {
  const vibeEmojis: Record<string, string> = {
    Foodie: "🍜",
    "Night Owl": "🦉",
    Gamer: "🎮",
    "Gym Rat": "💪",
    Bookworm: "📚",
    Traveler: "✈️",
    "Music Lover": "🎵",
    Cinephile: "🎬",
    "Coffee Addict": "☕",
    Fitness: "🏋️",
    Nature: "🌿",
    Techie: "💻",
    Creative: "🎨",
  };

  const heroPhoto =
    partner.photos && partner.photos.length > 0
      ? partner.photos[0]
      : partner.avatarUrl || "";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50"
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] bg-background rounded-t-3xl border-t border-border/50 overflow-hidden flex flex-col"
          >
            {/* Handle */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Close button */}
            <div className="absolute top-3 right-4 z-10">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-secondary/80"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-5">
              {/* Hero + Name */}
              <div className="flex items-center gap-4">
                {heroPhoto && (
                  <img
                    src={heroPhoto}
                    alt={partner.name}
                    className="w-20 h-20 rounded-2xl object-cover border-2 border-primary/30"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-display font-bold text-foreground truncate">
                    {partner.name}
                    {partner.age > 0 && (
                      <span className="font-light text-foreground/70 ml-2">
                        {partner.age}
                      </span>
                    )}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    {partner.job && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Briefcase className="w-3.5 h-3.5" />
                        {partner.job}
                      </span>
                    )}
                    {partner.location && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        {partner.location}
                      </span>
                    )}
                    {partner.heightCm && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Ruler className="w-3.5 h-3.5" />
                        {partner.heightCm} cm
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bio */}
              {partner.about_me && (
                <div className="glass-card p-4 rounded-2xl">
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {partner.about_me}
                  </p>
                </div>
              )}

              {/* Vibe Tags */}
              {partner.tags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Vibes
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {partner.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 text-sm font-medium"
                      >
                        <span>{vibeEmojis[tag] || "✨"}</span>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Photos */}
              {partner.photos && partner.photos.length > 1 && (
                <div className="grid grid-cols-2 gap-2">
                  {partner.photos.slice(1, 5).map((photo, i) => (
                    <img
                      key={i}
                      src={photo}
                      alt={`${partner.name}'s photo`}
                      className="w-full aspect-[3/4] object-cover rounded-xl"
                    />
                  ))}
                </div>
              )}

              {/* Prompts */}
              {partner.prompts &&
                partner.prompts.length > 0 &&
                partner.prompts.map(
                  (prompt, i) =>
                    prompt.answer && (
                      <div key={i} className="glass-card p-4 rounded-2xl">
                        <p className="text-xs font-medium text-primary mb-1">
                          {prompt.question}
                        </p>
                        <p className="text-sm leading-relaxed text-foreground">
                          {prompt.answer}
                        </p>
                      </div>
                    )
                )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
