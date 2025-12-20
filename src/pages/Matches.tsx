import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal, MessageCircle } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Skeleton } from "@/components/Skeleton";
import { NewVibesRail } from "@/components/NewVibesRail";
import { SwipeableMatchCard } from "@/components/SwipeableMatchCard";
import { EmptyMatchesState } from "@/components/EmptyMatchesState";
import { useMatches } from "@/hooks/useMatches";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type SortOption = "recent" | "unread" | "compatibility";

const Matches = () => {
  const navigate = useNavigate();
  const { data: matches = [], isLoading } = useMatches();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  // Separate new vibes (matches within 24h) from regular matches
  const { newVibes, regularMatches } = useMemo(() => {
    const newVibes = matches
      .filter((m) => m.isNew)
      .map((m) => ({
        id: m.id,
        name: m.name,
        image: m.image,
        isNew: true,
        hasUnread: m.unread,
      }));

    const regular = matches.filter((m) => !m.isNew);
    return { newVibes, regularMatches: regular };
  }, [matches]);

  // Filter and sort matches
  const filteredMatches = useMemo(() => {
    let filtered = [...regularMatches];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.vibes.some((v) => v.toLowerCase().includes(query))
      );
    }

    // Sort
    switch (sortBy) {
      case "unread":
        filtered.sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0));
        break;
      case "compatibility":
        // Mock sorting by random compatibility
        filtered.sort(() => Math.random() - 0.5);
        break;
      default:
        // Already sorted by recent from API
        break;
    }

    return filtered;
  }, [regularMatches, searchQuery, sortBy]);

  const handleUnmatch = (name: string) => {
    toast.success(`Unmatched with ${name}`, {
      description: "You won't see each other anymore",
    });
  };

  const handleViewProfile = (id: string, name: string) => {
    toast.info(`Viewing ${name}'s profile`, {
      description: "Profile view coming soon!",
    });
  };

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "recent", label: "Most Recent" },
    { value: "unread", label: "Unread First" },
    { value: "compatibility", label: "Best Match" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-border/50">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-display font-bold text-foreground">
                Matches
              </h1>
            </div>
            {matches.length > 0 && (
              <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-primary/15 text-primary text-sm font-medium">
                {matches.length} vibes
              </div>
            )}
          </div>

          {/* Search and filter bar */}
          {matches.length > 0 && (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or vibe..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-secondary/50 border-border/50 rounded-xl"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 rounded-xl border-border/50"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {sortOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => setSortBy(option.value)}
                      className={sortBy === option.value ? "bg-primary/10" : ""}
                    >
                      {option.label}
                      {sortBy === option.value && (
                        <span className="ml-auto text-primary">✓</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {/* Skeleton for New Vibes Rail */}
            <div className="glass-card p-4 rounded-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="flex gap-4">
                {Array(4)
                  .fill(0)
                  .map((_, i) => (
                    <div key={i} className="flex flex-col items-center gap-2">
                      <Skeleton className="w-20 h-20 rounded-full" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  ))}
              </div>
            </div>

            {/* Skeleton for chat list */}
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4">
                  <Skeleton className="w-14 h-14 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : matches.length > 0 ? (
          <>
            {/* New Vibes Rail */}
            <NewVibesRail
              vibes={newVibes}
              onVibeClick={(id) => navigate(`/chat/${id}`)}
            />

            {/* Section divider */}
            {regularMatches.length > 0 && (
              <div className="px-4 py-2 flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  Conversations
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            {/* Chat list */}
            <AnimatePresence mode="popLayout">
              {filteredMatches.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {filteredMatches.map((match, index) => (
                    <motion.div
                      key={match.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <SwipeableMatchCard
                        {...match}
                        onClick={() => navigate(`/chat/${match.id}`)}
                        onViewProfile={() =>
                          handleViewProfile(match.id, match.name)
                        }
                        onUnmatch={() => handleUnmatch(match.name)}
                      />
                    </motion.div>
                  ))}
                </div>
              ) : searchQuery ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center py-12 px-4 text-center"
                >
                  <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-display font-semibold text-foreground mb-2">
                    No matches found
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Try a different search term
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Tip at bottom */}
            {regularMatches.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mx-4 my-6 p-4 glass-card rounded-2xl border border-border/50"
              >
                <p className="text-sm text-muted-foreground text-center">
                  <span className="text-primary">Pro tip:</span> Swipe right to
                  view their profile, left to unmatch
                </p>
              </motion.div>
            )}
          </>
        ) : (
          <EmptyMatchesState onBrowseEvents={() => navigate("/events")} />
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Matches;
