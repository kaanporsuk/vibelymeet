import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal, MessageCircle, Droplet, Loader2 } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NewVibesRail, NewVibe } from "@/components/NewVibesRail";
import { SwipeableMatchCard } from "@/components/SwipeableMatchCard";
import { EmptyMatchesState } from "@/components/EmptyMatchesState";
import { ProfileDetailDrawer } from "@/components/ProfileDetailDrawer";
import { MatchAvatar } from "@/components/MatchAvatar";
import { DropsTabContent, DropMatch } from "@/components/matches/DropsTabContent";
import { PullToRefresh } from "@/components/PullToRefresh";
import { UnmatchDialog } from "@/components/UnmatchDialog";
import { ArchiveMatchDialog } from "@/components/ArchiveMatchDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { MuteOptionsSheet } from "@/components/MuteOptionsSheet";
import { ArchivedMatchesSection } from "@/components/ArchivedMatchesSection";
import { 
  MatchCardSkeleton, 
  NewVibesRailSkeleton 
} from "@/components/ShimmerSkeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import ReportWizard from "@/components/safety/ReportWizard";
import { useMatches, Match } from "@/hooks/useMatches";
import { useDropMatches } from "@/hooks/useDropMatches";
import { useUndoableUnmatch } from "@/hooks/useUnmatch";
import { useArchiveMatch } from "@/hooks/useArchiveMatch";
import { useBlockUser } from "@/hooks/useBlockUser";
import { useMuteMatch, MuteDuration } from "@/hooks/useMuteMatch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  const { data: matches = [], isLoading, refetch } = useMatches();
  const { data: drops = [], isLoading: isLoadingDrops, refetch: refetchDrops } = useDropMatches();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [activeTab, setActiveTab] = useState("conversations");
  
  // Unmatch state
  const [unmatchTarget, setUnmatchTarget] = useState<Match | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Match | null>(null);
  const [blockTarget, setBlockTarget] = useState<Match | null>(null);
  const [muteTarget, setMuteTarget] = useState<Match | null>(null);
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [pendingUnmatchIds, setPendingUnmatchIds] = useState<Set<string>>(new Set());
  
  const { initiateUnmatch } = useUndoableUnmatch({
    onUnmatchComplete: () => {
      if (unmatchTarget) {
        setPendingUnmatchIds(prev => {
          const next = new Set(prev);
          next.delete(unmatchTarget.matchId);
          return next;
        });
      }
    },
    onUndo: () => {
      setPendingUnmatchIds(new Set());
    },
  });

  const { archiveMatch, isArchiving } = useArchiveMatch();
  const { blockUser, isBlocking } = useBlockUser();
  const { muteMatch, unmuteMatch, isMatchMuted } = useMuteMatch();

  // Pull to refresh handler
  const handleRefresh = useCallback(async () => {
    await Promise.all([refetch(), refetchDrops()]);
  }, [refetch, refetchDrops]);

  const pendingDropsCount = drops.filter(d => d.status === 'received' || d.status === 'sent').length;
  const matchedDropsCount = drops.filter(d => d.status === 'matched').length;

  // Track which new vibes the user has opened (session-level)
  const [openedVibeIds, setOpenedVibeIds] = useState<Set<string>>(new Set());

  // Separate new vibes, regular matches, and archived matches
  const { newVibes, regularMatches, archivedMatches } = useMemo(() => {
    const newVibes = matches
      .filter((m) => {
        const matchedAt = new Date(m.time === 'new' ? Date.now() : Date.now()); // isNew is already computed in hook
        return m.isNew && !m.isArchived && !openedVibeIds.has(m.id);
      })
      .map((m) => ({
        id: m.id,
        name: m.name,
        age: m.age,
        image: m.image,
        vibes: m.vibes,
        isNew: true,
        hasUnread: m.unread,
        photoVerified: m.photoVerified,
      }));

    // Regular matches include opened new vibes
    const regular = matches.filter((m) => (!m.isNew || openedVibeIds.has(m.id)) && !m.isArchived);
    const archived = matches.filter((m) => m.isArchived);
    return { newVibes, regularMatches: regular, archivedMatches: archived };
  }, [matches, openedVibeIds]);

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

  const handleUnmatchClick = (match: Match) => {
    setUnmatchTarget(match);
  };

  const handleConfirmUnmatch = () => {
    if (unmatchTarget) {
      setPendingUnmatchIds(prev => new Set(prev).add(unmatchTarget.matchId));
      initiateUnmatch(unmatchTarget.matchId, unmatchTarget.name);
      setUnmatchTarget(null);
    }
  };

  const handleConfirmArchive = () => {
    if (archiveTarget) {
      archiveMatch(archiveTarget.matchId, archiveTarget.name);
      setArchiveTarget(null);
    }
  };

  const handleConfirmBlock = (reason?: string) => {
    if (blockTarget) {
      blockUser(blockTarget.id, blockTarget.name, reason);
      setBlockTarget(null);
    }
  };

  const handleMuteDuration = (duration: MuteDuration) => {
    if (muteTarget) {
      muteMatch(muteTarget.matchId, muteTarget.name, duration);
      setMuteTarget(null);
    }
  };

  const handleOpenReport = () => {
    setUnmatchTarget(null);
    setShowReportSheet(true);
  };

  const handleReportComplete = () => {
    setShowReportSheet(false);
    toast.success("Report submitted", {
      description: "Our team will review it within 24 hours",
    });
  };

  const [viewProfileMatch, setViewProfileMatch] = useState<Match | null>(null);

  const handleViewProfile = (id: string) => {
    const match = matches?.find(m => m.id === id);
    if (match) setViewProfileMatch(match);
  };

  const handleOpenDropChat = (dropId: string) => {
    const drop = drops.find(d => d.id === dropId);
    if (drop) {
      navigate(`/chat/${drop.candidate.id}`);
    }
  };

  const handleViewDropProfile = (dropId: string) => {
    toast.info("Viewing profile...");
  };

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "recent", label: "Most Recent" },
    { value: "unread", label: "Unread First" },
    { value: "compatibility", label: "Best Match" },
  ];

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-background pb-24">
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

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-3">
              <TabsTrigger value="conversations" className="text-sm">
                <MessageCircle className="w-4 h-4 mr-1.5" />
                Chats
              </TabsTrigger>
              <TabsTrigger value="drops" className="text-sm relative">
                <Droplet className="w-4 h-4 mr-1.5" />
                Daily Drops
                {pendingDropsCount > 0 && (
                  <motion.span 
                    animate={{ 
                      scale: [1, 1.2, 1],
                      boxShadow: [
                        '0 0 0 0 hsl(var(--neon-cyan) / 0.4)',
                        '0 0 0 6px hsl(var(--neon-cyan) / 0)',
                        '0 0 0 0 hsl(var(--neon-cyan) / 0)'
                      ]
                    }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-neon-cyan text-[10px] font-bold text-background flex items-center justify-center"
                  >
                    {pendingDropsCount}
                  </motion.span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Search and filter bar - only for conversations */}
          {activeTab === 'conversations' && matches.length > 0 && (
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
        <AnimatePresence mode="wait">
          {/* Conversations Tab */}
          {activeTab === 'conversations' && (
            <motion.div
              key="conversations"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
            >
              {isLoading ? (
                <div className="p-4 space-y-4">
                  {/* Shimmer Skeleton for New Vibes Rail */}
                  <NewVibesRailSkeleton />

                  {/* Shimmer Skeleton for chat list */}
                  {Array(5).fill(0).map((_, i) => (
                    <MatchCardSkeleton key={i} />
                  ))}
                </div>
              ) : matches.length > 0 ? (
                <>
                  {/* New Vibes Rail */}
                  <NewVibesRail
                    vibes={newVibes}
                    onVibeClick={(id) => {
                      setOpenedVibeIds(prev => new Set(prev).add(id));
                      navigate(`/chat/${id}`);
                    }}
                    onVibeProfileOpen={(vibe) => {
                      setOpenedVibeIds(prev => new Set(prev).add(vibe.id));
                      const match = matches?.find(m => m.id === vibe.id);
                      if (match) setViewProfileMatch(match);
                    }}
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
                              photoVerified={match.photoVerified}
                              onClick={() => navigate(`/chat/${match.id}`)}
                            onViewProfile={() =>
                                handleViewProfile(match.id)
                              }
                              onUnmatch={() => handleUnmatchClick(match)}
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

                  {/* Archived Matches Section */}
                  <ArchivedMatchesSection archivedMatches={archivedMatches} />

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
            </motion.div>
          )}

        {/* Daily Drops Tab */}
        {activeTab === 'drops' && (
          <motion.div 
            key="drops"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="p-4"
          >
            <DropsTabContent
              drops={drops}
              onOpenChat={handleOpenDropChat}
              onViewProfile={handleViewDropProfile}
            />
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      <BottomNav />

      {/* Unmatch Dialog */}
      <UnmatchDialog
        isOpen={!!unmatchTarget}
        onClose={() => setUnmatchTarget(null)}
        onConfirm={handleConfirmUnmatch}
        onReport={handleOpenReport}
        userName={unmatchTarget?.name || ""}
        userAvatar={unmatchTarget?.image}
        isLoading={false}
      />

      {/* Archive Dialog */}
      <ArchiveMatchDialog
        isOpen={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleConfirmArchive}
        userName={archiveTarget?.name || ""}
        userAvatar={archiveTarget?.image}
        isLoading={isArchiving}
      />

      {/* Block User Dialog */}
      <BlockUserDialog
        isOpen={!!blockTarget}
        onClose={() => setBlockTarget(null)}
        onConfirm={handleConfirmBlock}
        userName={blockTarget?.name || ""}
        userAvatar={blockTarget?.image}
        isLoading={isBlocking}
      />

      {/* Mute Options Sheet */}
      <MuteOptionsSheet
        isOpen={!!muteTarget}
        onClose={() => setMuteTarget(null)}
        onSelectDuration={handleMuteDuration}
        userName={muteTarget?.name || ""}
        currentlyMuted={muteTarget ? isMatchMuted(muteTarget.matchId) : false}
        onUnmute={() => {
          if (muteTarget) {
            unmuteMatch(muteTarget.matchId, muteTarget.name);
          }
        }}
      />

      {/* Profile Detail Drawer */}
      {viewProfileMatch && (
        <ProfileDetailDrawer
          match={{
            id: viewProfileMatch.id,
            name: viewProfileMatch.name,
            age: viewProfileMatch.age,
            image: viewProfileMatch.image,
            vibes: viewProfileMatch.vibes,
            photos: viewProfileMatch.photos,
            bio: viewProfileMatch.bio || undefined,
            job: viewProfileMatch.job || undefined,
            location: viewProfileMatch.location || undefined,
            height: viewProfileMatch.height || undefined,
            prompts: viewProfileMatch.prompts,
            videoIntroUrl: viewProfileMatch.videoIntroUrl,
            lifestyle: viewProfileMatch.lifestyle,
          }}
          open={!!viewProfileMatch}
          onOpenChange={(open) => { if (!open) setViewProfileMatch(null); }}
          onMessage={() => {
            const matchId = viewProfileMatch.id;
            setViewProfileMatch(null);
            navigate(`/chat/${matchId}`);
          }}
          showActions={true}
        />
      )}

      {/* Report Sheet */}
      <Sheet open={showReportSheet} onOpenChange={setShowReportSheet}>
        <SheetContent side="bottom" className="h-[85vh] p-0 rounded-t-3xl">
          <ReportWizard
            onBack={() => setShowReportSheet(false)}
            onComplete={handleReportComplete}
          />
        </SheetContent>
      </Sheet>
    </PullToRefresh>
  );
};

export default Matches;
