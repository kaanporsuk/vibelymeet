import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BottomNav } from "@/components/BottomNav";
import { EventCard } from "@/components/EventCard";
import { EventCardSkeleton } from "@/components/Skeleton";
import { useEvents } from "@/hooks/useEvents";

const filterTags = ["All", "Music", "Tech", "Food", "Travel", "Books", "Fitness"];

const Events = () => {
  const { data: events = [], isLoading } = useEvents();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        activeFilter === "All" || event.tags.some((tag) => tag === activeFilter);
      return matchesSearch && matchesFilter;
    });
  }, [events, searchQuery, activeFilter]);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-4 space-y-4">
        <h1 className="text-2xl font-display font-bold text-foreground text-center">
          Discover Events
        </h1>

        {/* Search */}
        <div className="relative max-w-lg mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 rounded-2xl glass-card border-white/10"
          />
        </div>

        {/* Filter Tags */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
          {filterTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveFilter(tag)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 shrink-0 ${
                activeFilter === tag
                  ? "bg-primary text-primary-foreground neon-glow-violet"
                  : "glass-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <div className="grid gap-4">
          {isLoading
            ? Array(4)
                .fill(0)
                .map((_, i) => <EventCardSkeleton key={i} />)
            : filteredEvents.length > 0
            ? filteredEvents.map((event) => (
                <EventCard
                  key={event.id}
                  id={event.id}
                  title={event.title}
                  image={event.image}
                  date={event.date}
                  time={event.time}
                  attendees={event.attendees}
                  tags={event.tags}
                />
              ))
            : (
              <div className="text-center py-12 space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-secondary flex items-center justify-center">
                  <span className="text-3xl">🔍</span>
                </div>
                <p className="text-muted-foreground">No events found</p>
              </div>
            )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default Events;
