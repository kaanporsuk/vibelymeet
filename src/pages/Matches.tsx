import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Skeleton } from "@/components/Skeleton";

const mockMatches = [
  {
    id: "1",
    name: "Emma",
    age: 26,
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
    lastMessage: "Hey! That event was so fun 😊",
    time: "2m ago",
    unread: true,
    vibes: ["Music", "Travel"],
  },
  {
    id: "2",
    name: "Alex",
    age: 28,
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
    lastMessage: "Would love to grab coffee sometime",
    time: "1h ago",
    unread: true,
    vibes: ["Tech", "Coffee"],
  },
  {
    id: "3",
    name: "Sofia",
    age: 24,
    image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
    lastMessage: "You have great taste in music!",
    time: "3h ago",
    unread: false,
    vibes: ["Music", "Art"],
  },
  {
    id: "4",
    name: "Jordan",
    age: 27,
    image: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400",
    lastMessage: "That hiking spot looks amazing",
    time: "1d ago",
    unread: false,
    vibes: ["Fitness", "Nature"],
  },
  {
    id: "5",
    name: "Taylor",
    age: 25,
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400",
    lastMessage: "Nice to meet you at the event!",
    time: "2d ago",
    unread: false,
    vibes: ["Food", "Travel"],
  },
];

const Matches = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-4">
        <h1 className="text-2xl font-display font-bold text-foreground text-center">
          Matches
        </h1>
      </header>

      <main className="max-w-lg mx-auto">
        {loading ? (
          <div className="divide-y divide-border">
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4">
                  <Skeleton className="w-16 h-16 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                </div>
              ))}
          </div>
        ) : mockMatches.length > 0 ? (
          <div className="divide-y divide-border">
            {mockMatches.map((match) => (
              <button
                key={match.id}
                onClick={() => navigate(`/chat/${match.id}`)}
                className="w-full flex items-center gap-4 p-4 hover:bg-secondary/50 transition-colors text-left"
              >
                <div className="relative">
                  <img
                    src={match.image}
                    alt={match.name}
                    className="w-16 h-16 rounded-full object-cover border-2 border-border"
                  />
                  {match.unread && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-neon-pink rounded-full neon-glow-pink" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-foreground">
                      {match.name}, {match.age}
                    </h3>
                    <span className="text-xs text-muted-foreground">{match.time}</span>
                  </div>
                  <p
                    className={`text-sm truncate ${
                      match.unread ? "text-foreground font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {match.lastMessage}
                  </p>
                  <div className="flex gap-1 mt-1">
                    {match.vibes.map((vibe) => (
                      <span
                        key={vibe}
                        className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary"
                      >
                        {vibe}
                      </span>
                    ))}
                  </div>
                </div>

                <MessageCircle className="w-5 h-5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-20 h-20 rounded-3xl bg-secondary flex items-center justify-center mb-4">
              <span className="text-4xl">💫</span>
            </div>
            <h3 className="text-xl font-display font-semibold text-foreground mb-2">
              No matches yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Join an event to start making connections!
            </p>
            <button
              onClick={() => navigate("/events")}
              className="text-primary font-medium"
            >
              Browse Events →
            </button>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Matches;
