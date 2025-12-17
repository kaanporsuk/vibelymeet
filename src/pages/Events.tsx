import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BottomNav } from "@/components/BottomNav";
import { EventCard } from "@/components/EventCard";
import { EventCardSkeleton } from "@/components/Skeleton";

const allEvents = [
  {
    id: "1",
    title: "90s Music Lovers Night",
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600",
    date: "Dec 20",
    time: "8 PM",
    attendees: 24,
    tags: ["Music", "Retro"],
  },
  {
    id: "2",
    title: "Tech Professionals Mixer",
    image: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=600",
    date: "Dec 22",
    time: "7 PM",
    attendees: 18,
    tags: ["Tech", "Networking"],
  },
  {
    id: "3",
    title: "Foodies Unite",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600",
    date: "Dec 24",
    time: "6 PM",
    attendees: 32,
    tags: ["Food", "Wine"],
  },
  {
    id: "4",
    title: "Adventure Seekers",
    image: "https://images.unsplash.com/photo-1533130061792-64b345e4a833?w=600",
    date: "Dec 26",
    time: "5 PM",
    attendees: 16,
    tags: ["Travel", "Adventure"],
  },
  {
    id: "5",
    title: "Book Club Singles",
    image: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600",
    date: "Dec 28",
    time: "4 PM",
    attendees: 12,
    tags: ["Books", "Intellectual"],
  },
  {
    id: "6",
    title: "Fitness & Health",
    image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600",
    date: "Dec 30",
    time: "9 AM",
    attendees: 20,
    tags: ["Fitness", "Wellness"],
  },
];

const filterTags = ["All", "Music", "Tech", "Food", "Travel", "Books", "Fitness"];

const Events = () => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const filteredEvents = allEvents.filter((event) => {
    const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter =
      activeFilter === "All" || event.tags.some((tag) => tag === activeFilter);
    return matchesSearch && matchesFilter;
  });

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
          {loading
            ? Array(4)
                .fill(0)
                .map((_, i) => <EventCardSkeleton key={i} />)
            : filteredEvents.length > 0
            ? filteredEvents.map((event) => <EventCard key={event.id} {...event} />)
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
