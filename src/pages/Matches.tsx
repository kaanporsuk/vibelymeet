import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal, MessageCircle, Droplet, X } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NewVibesRail } from "@/components/NewVibesRail";
import { SwipeableMatchCard } from "@/components/SwipeableMatchCard";
import { EmptyMatchesState } from "@/components/EmptyMatchesState";
import { ProfileDetailDrawer } from "@/components/ProfileDetailDrawer";
import { MatchAvatar } from "@/components/MatchAvatar";
import { DropsTabContent } from "@/components/matches/DropsTabContent";
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
import { useMatches, type Match } from "@/hooks/useMatches";
import { useUndoableUnmatch } from "@/hooks/useUnmatch";
import { useArchiveMatch } from "@/hooks/useArchiveMatch";
import { useBlockUser } from "@/hooks/useBlockUser";
import { useMuteMatch, MuteDuration } from "@/hooks/useMuteMatch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { WhoLikedYouGate } from "@/components/premium/WhoLikedYouGate";
import { formatConversationCount } from "@/utils/matchSortScore";
import {
  MATCHES_SEARCH_PLACEHOLDER,
  matchPassesClientSearch,
} from "@/utils/matchSearchHaystack";
import {
  MATCHES_CONVERSATION_SORT_STORAGE_KEY,
  type ConversationSortOption,
  conversationSortShortLabel,
  orderIndexByMatchId as buildOrderIndexByMatchId,
  parseStoredConversationSort,
  sortConversations,
} from "@/utils/matchesConversationSort";
import {
  getUtcDateKey,
  resolveMatchesSpotlight,
} from "../../shared/matches/spotlightResolver";

const Matches = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { data: matches = [], isLoading, refetch } = useMatches();
  const { isPremium } = useSubscription();
  const [phoneVerifiedForEmpty, setPhoneVerifiedForEmpty] = useState(true);

  // Check phone verification status for empty state nudge
  useEffect(() => {
    if (!user?.id) return;
    const check = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("phone_verified")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setPhoneVerifiedForEmpty(data.phone_verified);
    };
    check();
  }, [user?.id]);
  const [searchQuery, setSearchQuery] = useState("");
  const searchTrimmed = searchQuery.trim();
  const showNewVibesRail = searchTrimmed.length === 0;
  const [sortBy, setSortBy] = useState<ConversationSortOption>(() =>
    parseStoredConversationSort(
      typeof window !== "undefined"
        ? localStorage.getItem(MATCHES_CONVERSATION_SORT_STORAGE_KEY)
        : null
    )
  );
  const [activeTab, setActiveTab] = useState("conversations");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(MATCHES_CONVERSATION_SORT_STORAGE_KEY, sortBy);
    } catch {
      /* ignore quota / private mode */
    }
  }, [sortBy]);
  
  // Unmatch state
  const [unmatchTarget, setUnmatchTarget] = useState<Match | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Match | null>(null);
  const [blockTarget, setBlockTarget] = useState<Match | null>(null);
  const [muteTarget, setMuteTarget] = useState<Match | null>(null);
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [reportTarget, setReportTarget] = useState<Match | null>(null);
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
    await refetch();
  }, [refetch]);

  const pendingDropsCount = 0;

  // Track which new vibes the user has opened (session-level)
  const [openedVibeIds, setOpenedVibeIds] = useState<Set<string>>(new Set());

  // Separate new vibes, regular matches, and archived matches
  const { newVibes, regularMatches, archivedMatches } = useMemo(() => {
    const newVibes = matches
      .filter((m) => {
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
  const dateKey = getUtcDateKey();
  const matchesSpotlight = useMemo(
    () =>
      resolveMatchesSpotlight({
        userId: user?.id ?? "__anonymous__",
        dateKey,
      }),
    [user?.id, dateKey]
  );
  const spotlightDismissKey = useMemo(
    () =>
      `matches_spotlight_dismissed:${user?.id ?? "__anonymous__"}:${dateKey}:${matchesSpotlight.id}`,
    [user?.id, dateKey, matchesSpotlight.id]
  );
  const [spotlightDismissed, setSpotlightDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setSpotlightDismissed(localStorage.getItem(spotlightDismissKey) === "1");
    } catch {
      setSpotlightDismissed(false);
    }
  }, [spotlightDismissKey]);

  const regularConversationCount = regularMatches.length;
  const shouldShowSpotlightBase =
    activeTab === "conversations" && searchTrimmed.length === 0 && !spotlightDismissed;
  const spotlightPlacement: "empty" | "footer" | "inline" | null = shouldShowSpotlightBase
    ? regularConversationCount === 0
      ? "empty"
      : regularConversationCount <= 3
        ? "footer"
        : "inline"
    : null;

  const dismissSpotlightForDay = useCallback(() => {
    setSpotlightDismissed(true);
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(spotlightDismissKey, "1");
    } catch {
      /* ignore */
    }
  }, [spotlightDismissKey]);

  const spotlightCard = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
      className="mx-4 my-6 p-4 glass-card rounded-2xl border border-border/50 relative"
    >
      <button
        type="button"
        aria-label="Dismiss spotlight"
        onClick={dismissSpotlightForDay}
        className="absolute top-2 right-2 p-1 rounded-md hover:bg-secondary/50 transition-colors"
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
      <div className="text-center space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {matchesSpotlight.eyebrow}
        </p>
        <p className="text-sm font-semibold text-foreground">{matchesSpotlight.title}</p>
        <p className="text-sm text-muted-foreground">{matchesSpotlight.body}</p>
        {matchesSpotlight.ctaLabel && matchesSpotlight.ctaTarget ? (
          <a
            href={matchesSpotlight.ctaTarget}
            className="inline-block text-sm text-primary underline-offset-4 hover:underline pt-1"
          >
            {matchesSpotlight.ctaLabel}
          </a>
        ) : null}
      </div>
    </motion.div>
  );

  const orderIndexByMatchId = useMemo(() => {
    return buildOrderIndexByMatchId(regularMatches);
  }, [regularMatches]);

  // Filter (search) then sort — same options as native; count matches visible rows
  const filteredMatches = useMemo(() => {
    let filtered = [...regularMatches];

    if (searchTrimmed) {
      const query = searchTrimmed.toLowerCase();
      filtered = filtered.filter((m) => matchPassesClientSearch(m, query));
    }

    return sortConversations(filtered, sortBy, orderIndexByMatchId);
  }, [regularMatches, searchTrimmed, sortBy, orderIndexByMatchId]);

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
    setReportTarget(unmatchTarget);
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

  const handleViewDropProfile = (dropId: string) => {
    toast.info("Viewing profile...");
  };

  const sortOptions: { value: ConversationSortOption; label: string }[] = [
    { value: "recent", label: "Most Recent" },
    { value: "needsReply", label: "Needs Reply" },
    { value: "best", label: "Best Match" },
  ];

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen bg-background pb-[100px]">
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
            {regularMatches.length > 0 && (
              <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-primary/15 text-primary text-sm font-medium">
                {formatConversationCount(filteredMatches.length)}
              </div>
            )}
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-3">
              <TabsTrigger value="conversations" className="text-sm">
                <MessageCircle className="w-4 h-4 mr-1.5" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="drops" className="text-sm relative">
                <Droplet className="w-4 h-4 mr-1.5" />
                Daily Drop
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
          {activeTab === 'conversations' && regularMatches.length > 0 && (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={MATCHES_SEARCH_PLACEHOLDER}
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
              <p className="text-[11px] text-muted-foreground/90 mt-1.5 pl-0.5 tracking-wide">
                Sorted by: {conversationSortShortLabel(sortBy)}
              </p>
            </>
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
                  {/* Who Liked You Gate (free users) or New Vibes Rail (premium) — hidden while searching (native parity) */}
                  {showNewVibesRail && isPremium ? (
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
                  ) : showNewVibesRail && !isPremium && newVibes.length > 0 ? (
                    <WhoLikedYouGate count={newVibes.length} />
                  ) : null}

                  {/* Matches spotlight (0 conversations: high placement) */}
                  {spotlightPlacement === "empty" ? spotlightCard : null}

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
                          <div key={match.id}>
                            <motion.div
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: -100 }}
                              transition={{ delay: index * 0.03 }}
                            >
                              <SwipeableMatchCard
                                {...match}
                                photoVerified={match.photoVerified}
                                compatibility={match.compatibilityPercent}
                                onClick={() => navigate(`/chat/${match.id}`)}
                                onViewProfile={() => handleViewProfile(match.id)}
                                onUnmatch={() => handleUnmatchClick(match)}
                              />
                            </motion.div>
                            {/* Matches spotlight (4+ conversations: inline after 2nd row) */}
                            {spotlightPlacement === "inline" && index === 1 ? spotlightCard : null}
                          </div>
                        ))}
                      </div>
                    ) : searchTrimmed ? (
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

                  {/* Matches spotlight (1–3 conversations: footer placement) */}
                  {spotlightPlacement === "footer" ? spotlightCard : null}

                  {/* Invite friends banner */}
                  {matches.length >= 1 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.6 }}
                      className="mx-4 mb-6"
                    >
                      <button
                        onClick={async () => {
                          const link = `https://vibelymeet.com/auth?mode=signup&ref=${user?.id || ""}`;
                          try {
                            await navigator.share({
                              title: "Join me on Vibely!",
                              text: "I'm using Vibely for video dates — come find your vibe! 💜",
                              url: link,
                            });
                          } catch {
                            await navigator.clipboard.writeText(link);
                            toast.success("Invite link copied!");
                          }
                        }}
                        className="w-full p-3 glass-card rounded-2xl border border-border/50 flex items-center gap-3 hover:bg-secondary/30 transition-colors"
                      >
                        <span className="text-lg">💌</span>
                        <span className="text-sm text-muted-foreground">Invite friends to Vibely</span>
                      </button>
                    </motion.div>
                  )}
                </>
              ) : (
              <div className="space-y-4">
                <EmptyMatchesState onBrowseEvents={() => navigate("/events")} />
                {/* Matches spotlight (0 conversations: high placement) */}
                {spotlightPlacement === "empty" ? spotlightCard : null}
                {!phoneVerifiedForEmpty && (
                  <div className="px-4">
                    <PhoneVerificationNudge
                      variant="empty"
                      onVerified={() => setPhoneVerifiedForEmpty(true)}
                    />
                  </div>
                )}
              </div>
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
            <DropsTabContent />
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
            aboutMe: viewProfileMatch.bio || undefined,
            job: viewProfileMatch.job || undefined,
            location: viewProfileMatch.location || undefined,
            height: viewProfileMatch.height || undefined,
            prompts: viewProfileMatch.prompts,
            
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
          mode="match"
        />
      )}

      {/* Report Sheet */}
      <Sheet open={showReportSheet} onOpenChange={setShowReportSheet}>
        <SheetContent side="bottom" className="h-[85vh] p-0 rounded-t-3xl">
          <ReportWizard
            onBack={() => setShowReportSheet(false)}
            onComplete={handleReportComplete}
            preSelectedUser={reportTarget ? {
              id: reportTarget.id,
              name: reportTarget.name,
              avatar_url: reportTarget.image,
              interactionType: "Match",
              interactionDate: reportTarget.time || "Recent",
            } : undefined}
          />
        </SheetContent>
      </Sheet>
    </PullToRefresh>
  );
};

export default Matches;
