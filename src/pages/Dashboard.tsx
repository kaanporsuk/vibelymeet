import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import { EventCard } from "@/components/EventCard";
import { MatchAvatar } from "@/components/MatchAvatar";
import { EventCardSkeleton, MatchAvatarSkeleton } from "@/components/Skeleton";

// Mock data
const mockMatches = [
  { id: "1", name: "Emma", image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200", isNew: true },
  { id: "2", name: "Alex", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200", isNew: true },
  { id: "3", name: "Sofia", image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200", isNew: false },
  { id: "4", name: "Jordan", image: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200", isNew: false },
  { id: "5", name: "Taylor", image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200", isNew: false },
];

const mockEvents = [
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
];

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ hours: 23, minutes: 45, seconds: 12 });

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev.seconds > 0) {
          return { ...prev, seconds: prev.seconds - 1 };
        } else if (prev.minutes > 0) {
          return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        } else if (prev.hours > 0) {
          return { hours: prev.hours - 1, minutes: 59, seconds: 59 };
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div>
            <p className="text-sm text-muted-foreground">Good evening,</p>
            <h1 className="text-xl font-display font-bold text-foreground">Alex</h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        {/* Next Event Hero */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">Next Event</h2>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>

          <div className="glass-card p-6 space-y-4 neon-glow-violet">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center">
                <span className="text-2xl">🎵</span>
              </div>
              <div>
                <h3 className="font-display font-semibold text-foreground">
                  90s Music Lovers Night
                </h3>
                <p className="text-sm text-muted-foreground">Tomorrow at 8 PM</p>
              </div>
            </div>

            <div className="flex justify-center gap-4">
              {[
                { value: countdown.hours, label: "HRS" },
                { value: countdown.minutes, label: "MIN" },
                { value: countdown.seconds, label: "SEC" },
              ].map((item, i) => (
                <div key={i} className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
                    <span className="text-2xl font-display font-bold gradient-text">
                      {String(item.value).padStart(2, "0")}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground mt-1">{item.label}</span>
                </div>
              ))}
            </div>

            <Button variant="gradient" className="w-full" onClick={() => navigate("/date/1")}>
              Join Waiting Room
            </Button>
          </div>
        </section>

        {/* Matches Rail */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">
              Your Matches
              {!loading && mockMatches.filter((m) => m.isNew).length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-neon-pink/20 text-neon-pink">
                  {mockMatches.filter((m) => m.isNew).length} new
                </span>
              )}
            </h2>
            <button
              onClick={() => navigate("/matches")}
              className="flex items-center text-sm text-primary"
            >
              See all <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4">
            {loading
              ? Array(5)
                  .fill(0)
                  .map((_, i) => <MatchAvatarSkeleton key={i} />)
              : mockMatches.map((match) => (
                  <MatchAvatar
                    key={match.id}
                    image={match.image}
                    name={match.name}
                    isNew={match.isNew}
                    onClick={() => navigate(`/chat/${match.id}`)}
                  />
                ))}
          </div>
        </section>

        {/* Discover Events */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-foreground">Discover</h2>
            <button
              onClick={() => navigate("/events")}
              className="flex items-center text-sm text-primary"
            >
              All events <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {loading
              ? Array(2)
                  .fill(0)
                  .map((_, i) => <EventCardSkeleton key={i} />)
              : mockEvents.map((event) => <EventCard key={event.id} {...event} />)}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
};

export default Dashboard;
