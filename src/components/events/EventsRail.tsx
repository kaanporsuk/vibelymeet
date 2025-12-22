import { useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EventCardPremium } from "./EventCardPremium";
import type { Event } from "@/hooks/useEvents";

interface EventsRailProps {
  title: string;
  emoji?: string;
  events: Event[];
  accentColor?: "pink" | "violet" | "cyan";
}

export const EventsRail = ({
  title,
  emoji,
  events,
  accentColor = "violet",
}: EventsRailProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 340;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const accentClasses = {
    pink: "text-neon-pink",
    violet: "text-neon-violet",
    cyan: "text-neon-cyan",
  };

  if (events.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 mb-4">
        <h2 className="font-display text-xl font-bold text-foreground flex items-center gap-2">
          {emoji && <span className="text-2xl">{emoji}</span>}
          <span className={accentClasses[accentColor]}>{title}</span>
        </h2>
        
        {/* Navigation Arrows (Desktop) */}
        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={() => scroll("left")}
            className="p-2 rounded-full bg-muted/50 hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <button
            onClick={() => scroll("right")}
            className="p-2 rounded-full bg-muted/50 hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Scrollable Rail */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 px-4 scrollbar-hide scroll-smooth"
        style={{
          scrollSnapType: "x mandatory",
        }}
      >
        {events.map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            style={{ scrollSnapAlign: "start" }}
          >
            <EventCardPremium
              id={event.id}
              title={event.title}
              image={event.image}
              date={event.date}
              time={event.time}
              attendees={event.attendees}
              tags={event.tags}
            />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
};
