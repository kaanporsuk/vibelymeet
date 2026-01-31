import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Sparkles } from "lucide-react";
import { useEvents } from "@/hooks/useEvents";
import { BottomNav } from "@/components/BottomNav";
import { FeaturedEventCard } from "@/components/events/FeaturedEventCard";
import { EventsFilterBar } from "@/components/events/EventsFilterBar";
import { EventsRail } from "@/components/events/EventsRail";
import { EventCardPremium } from "@/components/events/EventCardPremium";
import { 
  FeaturedEventSkeleton, 
  EventsRailSkeleton 
} from "@/components/ShimmerSkeleton";

// Mock data for personalization
const userVibes = ["Music", "Tech", "Art"];
const nicheCategories = ["Gaming", "Food", "Wellness"];

const Events = () => {
  const { data: events, isLoading } = useEvents();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // Categorize events
  const { featuredEvent, trendingEvents, personalizedEvents, nicheEvents, filteredEvents } = useMemo(() => {
    if (!events) {
      return {
        featuredEvent: null,
        trendingEvents: [],
        personalizedEvents: [],
        nicheEvents: [],
        filteredEvents: [],
      };
    }

    // Apply search and filters
    let filtered = events;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (event) =>
          event.title.toLowerCase().includes(query) ||
          event.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    if (activeFilters.length > 0) {
      filtered = filtered.filter((event) => {
        // Check date filters
        const now = new Date();
        const eventDate = new Date(event.eventDate);
        const isTonight = eventDate.toDateString() === now.toDateString();
        const isThisWeekend = (() => {
          const dayOfWeek = now.getDay();
          const saturday = new Date(now);
          saturday.setDate(now.getDate() + (6 - dayOfWeek));
          const sunday = new Date(saturday);
          sunday.setDate(saturday.getDate() + 1);
          return eventDate >= saturday && eventDate <= sunday;
        })();
        const isThisWeek = (() => {
          const endOfWeek = new Date(now);
          endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
          return eventDate <= endOfWeek;
        })();

        const dateMatch = 
          (activeFilters.includes("Tonight") && isTonight) ||
          (activeFilters.includes("This Weekend") && isThisWeekend) ||
          (activeFilters.includes("This Week") && isThisWeek) ||
          (activeFilters.includes("Upcoming") && eventDate > now);

        // Check interest filters
        const interestFilters = activeFilters.filter(
          (f) => !["Tonight", "This Weekend", "This Week", "Upcoming"].includes(f)
        );
        const interestMatch =
          interestFilters.length === 0 ||
          event.tags.some((tag) => interestFilters.includes(tag));

        // If only date filters are active
        if (interestFilters.length === 0 && activeFilters.some(f => ["Tonight", "This Weekend", "This Week", "Upcoming"].includes(f))) {
          return dateMatch;
        }
        
        // If only interest filters are active
        if (!activeFilters.some(f => ["Tonight", "This Weekend", "This Week", "Upcoming"].includes(f))) {
          return interestMatch;
        }

        return dateMatch && interestMatch;
      });
    }

    // Featured = first upcoming event with most attendees
    const featured = [...events]
      .filter((e) => new Date(e.eventDate) > new Date())
      .sort((a, b) => b.attendees - a.attendees)[0];

    // Trending = high attendee count
    const trending = events
      .filter((e) => e.id !== featured?.id)
      .sort((a, b) => b.attendees - a.attendees)
      .slice(0, 6);

    // Personalized = matches user vibes
    const personalized = events
      .filter((e) => 
        e.id !== featured?.id && 
        e.tags.some((tag) => userVibes.includes(tag))
      )
      .slice(0, 6);

    // Niche = matches niche categories
    const niche = events
      .filter((e) => 
        e.id !== featured?.id && 
        e.tags.some((tag) => nicheCategories.includes(tag))
      )
      .slice(0, 6);

    return {
      featuredEvent: featured,
      trendingEvents: trending,
      personalizedEvents: personalized,
      nicheEvents: niche,
      filteredEvents: filtered,
    };
  }, [events, searchQuery, activeFilters]);

  const isFiltering = searchQuery || activeFilters.length > 0;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="pt-safe-top px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Calendar className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              Discover Events
            </h1>
            <p className="text-muted-foreground text-sm">
              Find your next vibe match
            </p>
          </div>
        </div>
      </header>

      {/* Filter Bar */}
      <EventsFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilters={activeFilters}
        onFiltersChange={setActiveFilters}
      />

      {/* Content */}
      <div className="space-y-8 pt-6">
        {isLoading ? (
          <div className="px-4 space-y-8">
            {/* Featured Skeleton with Shimmer */}
            <FeaturedEventSkeleton />
            
            {/* Rail Skeletons with Shimmer */}
            {[1, 2, 3].map((i) => (
              <EventsRailSkeleton key={i} />
            ))}
          </div>
        ) : isFiltering ? (
          // Filtered Results Grid
          <div className="px-4">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-muted-foreground">
                {filteredEvents.length} events found
              </span>
            </div>
            
            <AnimatePresence mode="popLayout">
              {filteredEvents.length > 0 ? (
                <motion.div
                  layout
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                  {filteredEvents.map((event) => (
                    <motion.div
                      key={event.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                    >
                      <EventCardPremium
                        id={event.id}
                        title={event.title}
                        image={event.image}
                        date={event.date}
                        time={event.time}
                        attendees={event.attendees}
                        tags={event.tags}
                        status={event.status}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center py-16"
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                    <Calendar className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    No events found
                  </h3>
                  <p className="text-muted-foreground">
                    Try adjusting your filters or search terms
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          // Default Discovery View
          <>
            {/* Featured Event */}
            {featuredEvent && (
              <div className="px-4">
                <FeaturedEventCard
                  id={featuredEvent.id}
                  title={featuredEvent.title}
                  description={featuredEvent.description}
                  image={featuredEvent.image}
                  eventDate={featuredEvent.eventDate}
                  attendees={featuredEvent.attendees}
                  tags={featuredEvent.tags}
                />
              </div>
            )}

            {/* Trending Tonight */}
            {trendingEvents.length > 0 && (
              <EventsRail
                title="Trending Tonight"
                emoji="🔥"
                events={trendingEvents}
                accentColor="pink"
              />
            )}

            {/* For Your Vibe */}
            {personalizedEvents.length > 0 && (
              <EventsRail
                title="For Your Vibe"
                emoji="✨"
                events={personalizedEvents}
                accentColor="violet"
              />
            )}

            {/* Niche Communities */}
            {nicheEvents.length > 0 && (
              <EventsRail
                title="Niche Communities"
                emoji="🎯"
                events={nicheEvents}
                accentColor="cyan"
              />
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Events;
