import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { MatchAvatar } from "./MatchAvatar";
import { ProfileDetailDrawer } from "./ProfileDetailDrawer";
import { Button } from "./ui/button";
import { toast } from "sonner";

interface NewVibe {
  id: string;
  name: string;
  image: string;
  age: number;
  vibes: string[];
  isNew: boolean;
  hasUnread?: boolean;
}

interface NewVibesRailProps {
  vibes: NewVibe[];
  onVibeClick: (id: string) => void;
}

export const NewVibesRail = ({ vibes, onVibeClick }: NewVibesRailProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (vibes.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative glass-card mx-4 my-4 p-4 rounded-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-foreground">New Vibes</h2>
            <p className="text-xs text-muted-foreground">{vibes.length} new connections</p>
          </div>
        </div>

        {/* Desktop scroll buttons */}
        <div className="hidden sm:flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 rounded-full"
            onClick={() => scroll("left")}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 rounded-full"
            onClick={() => scroll("right")}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable avatars */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1"
      >
        {vibes.map((vibe, index) => (
          <motion.div
            key={vibe.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
          >
            <ProfileDetailDrawer
              match={{
                id: vibe.id,
                name: vibe.name,
                age: vibe.age,
                image: vibe.image,
                vibes: vibe.vibes,
              }}
              trigger={
                <MatchAvatar
                  name={vibe.name}
                  image={vibe.image}
                  isNew={vibe.isNew}
                  hasUnread={vibe.hasUnread}
                  size="lg"
                />
              }
              onMessage={() => onVibeClick(vibe.id)}
              onVideoCall={() => toast.info("Video call feature coming soon!")}
            />
          </motion.div>
        ))}
      </div>

      {/* Gradient fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-card/60 to-transparent pointer-events-none rounded-l-2xl" />
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-card/60 to-transparent pointer-events-none rounded-r-2xl" />
    </motion.section>
  );
};
