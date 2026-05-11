import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  Video,
  Play,
  MapPin,
  Briefcase,
  Ruler,
  Sparkles,
  X,
  Heart,
  Info,
  AlertCircle,
  ChevronUp,
  Loader2,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { useUserProfile } from "@/hooks/useUserProfile";
import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";


interface ProfileDetailDrawerProps {
  match: {
    id: string;
    name: string;
    age: number;
    image: string;
    vibes: string[];
    compatibility?: number;
    photos?: string[];
    job?: string;
    location?: string;
    height?: number;
    aboutMe?: string;
    lifestyle?: Record<string, string>;
    prompts?: { question: string; answer: string }[];
    
    bunnyVideoUid?: string | null;
    bunnyVideoStatus?: string;
    vibeCaption?: string;
    photoVerified?: boolean;
    phoneVerified?: boolean;
  };
  trigger?: React.ReactNode;
  onMessage?: () => void;
  onVideoCall?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showActions?: boolean; // Whether to show action buttons
  mode?: 'discovery' | 'match'; // discovery = X/Heart/Message/Video, match = Message/Video only
  presentation?: "default" | "chatProfile";
}

export const ProfileDetailDrawer = ({
  match,
  trigger,
  onMessage,
  onVideoCall,
  open: controlledOpen,
  onOpenChange,
  showActions = true,
  mode = 'match',
  presentation = "default",
}: ProfileDetailDrawerProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const { data: fetchedProfile } = useUserProfile(open ? match.id : null);
  
  // Use controlled or uncontrolled mode
  const setOpen = (value: boolean) => {
    if (isControlled && onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalOpen(value);
    }
  };
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showVideoOverlay, setShowVideoOverlay] = useState(false);
  const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(true);
  const isChatProfileViewer = presentation === "chatProfile";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("__vibely_diag") !== "1") return;
    if (open) {
      console.info("[diag] ProfileDetailDrawer opened", { matchId: match.id, path: window.location.pathname });
    }
  }, [open, match.id]);

  useEffect(() => {
    if (!open) return;
    setCurrentPhotoIndex(0);
    setShowVideoOverlay(false);
    setShowFullscreenPhoto(false);
    setShowScrollHint(true);
  }, [open, match.id]);

  // Use photos from match prop - resolve storage paths to full URLs
  const photos = useMemo(() => {
    const raw =
      fetchedProfile?.photos && fetchedProfile.photos.length > 0
        ? fetchedProfile.photos
        : match.photos && match.photos.length > 0
          ? match.photos
          : [match.image].filter(Boolean);
    return raw.map((p) => resolvePhotoUrl(p)).filter(Boolean) as string[];
  }, [fetchedProfile?.photos, match.photos, match.image]);
  
  const profileData = {
    job: fetchedProfile?.job ?? match.job ?? null,
    location: fetchedProfile?.display_location ?? fetchedProfile?.location ?? match.location ?? null,
    distanceLabel: fetchedProfile?.distance_label ?? null,
    height: fetchedProfile?.height_cm ?? match.height ?? null,
    aboutMe: fetchedProfile?.about_me ?? match.aboutMe ?? null,
    lifestyle: fetchedProfile?.lifestyle ?? match.lifestyle ?? {},
    prompts: fetchedProfile?.prompts ?? match.prompts ?? [],
  };

  const displayName = fetchedProfile?.name?.trim() || match.name;
  const displayAge = fetchedProfile?.age ?? match.age;
  const photoVerified = fetchedProfile?.photo_verified ?? match.photoVerified ?? false;
  const phoneVerified = match.phoneVerified ?? false;
  const profileVibes =
    fetchedProfile?.vibes && fetchedProfile.vibes.length > 0
      ? fetchedProfile.vibes
      : match.vibes;
  const tagline = fetchedProfile?.tagline?.trim() ?? "";
  const intentIdForDisplay =
    fetchedProfile?.relationship_intent?.trim() || fetchedProfile?.looking_for?.trim() || "";
  const intentDisplay = intentIdForDisplay ? getRelationshipIntentDisplaySafe(intentIdForDisplay) : null;
  const aboutTrim = (profileData.aboutMe ?? "").trim();
  const showAboutMe = aboutTrim.length > 10;
  
  const bunnyUid = fetchedProfile?.bunny_video_uid ?? match.bunnyVideoUid ?? null;
  const bunnyStatus = fetchedProfile?.bunny_video_status ?? match.bunnyVideoStatus ?? "none";
  const vibeCaption = fetchedProfile?.vibe_caption ?? match.vibeCaption ?? "";
  const compatibility = match.compatibility ?? 0;

  const vibeVideo = useMemo(
    () =>
      resolveWebVibeVideoState({
        bunny_video_uid: bunnyUid,
        bunny_video_status: bunnyStatus,
        vibe_caption: vibeCaption,
      }),
    [bunnyUid, bunnyStatus, vibeCaption],
  );
  const hasVideoIntro = vibeVideo.state === "ready" && !!vibeVideo.playbackUrl;
  const showCompatibilityBadge = compatibility > 0;

  // Hide scroll hint after a few seconds
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setShowScrollHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const goToPhoto = (index: number) => {
    if (index >= 0 && index < photos.length) {
      setCurrentPhotoIndex(index);
    }
  };

  const vibeEmojis: Record<string, string> = {
    Foodie: "🍜",
    "Night Owl": "🦉",
    Gamer: "🎮",
    "Gym Rat": "💪",
    Bookworm: "📚",
    Traveler: "✈️",
    "Music Lover": "🎵",
    Cinephile: "🎬",
    "Coffee Addict": "☕",
    Fitness: "🏋️",
    Nature: "🌿",
    Techie: "💻",
    Creative: "🎨",
  };

  const renderProfilePhotoCard = (photoIndex: number, delay: number) => (
    <motion.div
      key={`photo-${photoIndex}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl"
    >
      <img
        src={photos[photoIndex]}
        alt={`${displayName}'s photo`}
        className="h-full w-full cursor-pointer object-cover"
        onClick={() => {
          setCurrentPhotoIndex(photoIndex);
          setShowFullscreenPhoto(true);
        }}
      />
    </motion.div>
  );

  const renderVibeVideoModule = (delay: number) => {
    if (vibeVideo.state === "none") return null;

    const isProcessing = vibeVideo.state === "processing" || vibeVideo.state === "stale_processing";
    const thumbnailUrl = vibeVideo.thumbnailUrl ?? photos[0] ?? "";

    const title = isProcessing
      ? vibeVideo.state === "stale_processing"
        ? "Vibe Video still processing"
        : "Vibe Video processing"
      : vibeVideo.state === "failed"
        ? "Vibe Video needs a fresh take"
        : "Vibe Video preview syncing";
    const body = isProcessing
      ? vibeVideo.state === "stale_processing"
        ? "Their clip is saved, but playback is taking longer than usual."
        : "Their clip is saved and getting ready for playback."
      : vibeVideo.state === "failed"
        ? "This clip did not finish processing."
        : "The clip is ready on our side and playback should appear shortly.";

    return (
      <motion.div
        key="vibe-video-module"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay }}
        className="glass-card overflow-hidden rounded-2xl p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-neon-cyan" aria-hidden />
            <span className="text-sm font-medium text-muted-foreground">Vibe Video</span>
          </div>
          {hasVideoIntro ? (
            <span className="rounded-full border border-neon-cyan/25 bg-neon-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neon-cyan">
              Ready
            </span>
          ) : null}
        </div>

        {hasVideoIntro && vibeVideo.playbackUrl ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-secondary/60">
            {showVideoOverlay ? (
              <VibePlayer
                videoUrl={vibeVideo.playbackUrl}
                thumbnailUrl={thumbnailUrl || undefined}
                vibeCaption={vibeCaption}
                autoPlay
                showControls
                className="aspect-video w-full"
                backendReportsReady
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowVideoOverlay(true)}
                className="group relative block aspect-video w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Watch Intro"
                title="Watch Intro"
              >
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt="Vibe Video"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-secondary/80">
                    <Video className="h-10 w-10 text-muted-foreground" aria-hidden />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-white/15 shadow-lg backdrop-blur-md transition-transform group-hover:scale-105">
                    <Play className="ml-1 h-7 w-7 fill-white text-white" aria-hidden />
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 p-4">
                  <span className="text-sm font-semibold text-white">Watch Intro</span>
                  {vibeCaption ? (
                    <span className="max-w-[65%] truncate text-xs font-medium text-white/75">
                      {vibeCaption}
                    </span>
                  ) : null}
                </div>
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-secondary/45 p-4">
            <div className="flex items-start gap-3">
              {isProcessing ? (
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
              ) : (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  const renderChatDetailsSection = (delay: number) => {
    if (!isChatProfileViewer) return null;

    const details = [
      tagline
        ? { key: "tagline", icon: <Sparkles className="h-4 w-4" aria-hidden />, label: "Intro", value: tagline }
        : null,
      profileData.job
        ? { key: "job", icon: <Briefcase className="h-4 w-4" aria-hidden />, label: "Work", value: profileData.job }
        : null,
      profileData.location
        ? { key: "location", icon: <MapPin className="h-4 w-4" aria-hidden />, label: "Location", value: profileData.location }
        : null,
      profileData.distanceLabel
        ? {
            key: "distance",
            icon: <MapPin className="h-4 w-4" aria-hidden />,
            label: "Distance",
            value: `${profileData.distanceLabel} away`,
          }
        : null,
      profileData.height
        ? { key: "height", icon: <Ruler className="h-4 w-4" aria-hidden />, label: "Height", value: `${profileData.height} cm` }
        : null,
      photoVerified
        ? { key: "photo-verified", icon: <Info className="h-4 w-4" aria-hidden />, label: "Verified", value: "Photo verified" }
        : null,
      phoneVerified
        ? { key: "phone-verified", icon: <Info className="h-4 w-4" aria-hidden />, label: "Status", value: "Phone verified" }
        : null,
    ].filter((item): item is { key: string; icon: JSX.Element; label: string; value: string } => Boolean(item));

    if (details.length === 0) return null;

    return (
      <motion.div
        key="details"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay }}
        className="glass-card rounded-2xl p-5"
      >
        <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium text-muted-foreground">Details</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {details.map((item) => (
            <div key={item.key} className="rounded-xl border border-white/10 bg-secondary/25 px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-primary">{item.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-0.5 break-words text-sm text-foreground/90">{item.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  };

  // Build content sections
  const renderContentSections = () => {
    const sections: JSX.Element[] = [];
    let photoIndex = 1;

    // About Me section
    if (showAboutMe) {
      sections.push(
        <motion.div
          key="aboutMe"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-5 rounded-2xl"
        >
          <p className="ph-no-capture text-lg leading-relaxed text-foreground">{aboutTrim}</p>
        </motion.div>
      );
    }

    if (isChatProfileViewer) {
      const vibeSection = renderVibeVideoModule(showAboutMe ? 0.14 : 0.1);
      if (vibeSection) sections.push(vibeSection);
    }

    // Photo 2
    if (photoIndex < photos.length) {
      sections.push(renderProfilePhotoCard(photoIndex, 0.15));
      photoIndex++;
    }

    // Vibes section
    if (profileVibes.length > 0) {
      sections.push(
        <motion.div
          key="vibes"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-5 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Interests</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {profileVibes.map((vibe) => (
              <span
                key={vibe}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary/15 text-primary border border-primary/30 text-sm font-medium"
              >
                <span>{vibeEmojis[vibe] || "✨"}</span>
                {vibe}
              </span>
            ))}
          </div>
        </motion.div>
      );
    }

    if (!isChatProfileViewer && !hasVideoIntro) {
      const vibeSection = renderVibeVideoModule(0.22);
      if (vibeSection) sections.push(vibeSection);
    }

    const detailsSection = renderChatDetailsSection(0.24);
    if (detailsSection) {
      sections.push(detailsSection);
    }

    // Prompts interspersed with remaining photos (only if user has prompts)
    if (profileData.prompts && profileData.prompts.length > 0) {
      profileData.prompts.forEach((prompt, i) => {
        if (prompt.answer) {
          sections.push(
            <motion.div
              key={`prompt-${i}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.05 }}
              className="glass-card p-5 rounded-2xl"
            >
              <p className="text-sm font-medium text-primary mb-2">{prompt.question}</p>
              <p className="text-lg leading-relaxed text-foreground">{prompt.answer}</p>
            </motion.div>
          );

          // Add a photo after every other prompt
          if (i % 2 === 0 && photoIndex < photos.length) {
            sections.push(renderProfilePhotoCard(photoIndex, 0.3 + i * 0.05));
            photoIndex++;
          }
        }
      });
    }

    // Lifestyle section
    if (profileData.lifestyle && Object.keys(profileData.lifestyle).length > 0) {
      sections.push(
        <motion.div
          key="lifestyle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card p-5 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Lifestyle</span>
          </div>
          <LifestyleDetails values={profileData.lifestyle} editable={false} />
        </motion.div>
      );
    }

    // Add remaining photos
    while (photoIndex < photos.length) {
      sections.push(renderProfilePhotoCard(photoIndex, 0.45));
      photoIndex++;
    }

    return sections;
  };

  const activeHeroPhoto = photos[currentPhotoIndex] ?? photos[0] ?? "";

  const renderHeroPhoto = () => {
    if (!activeHeroPhoto) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-secondary/50">
          <Sparkles className="h-12 w-12 text-muted-foreground/40" aria-hidden />
        </div>
      );
    }

    return (
      <>
        {isChatProfileViewer ? (
          <AnimatePresence mode="wait">
            <motion.img
              key={`hero-bg-${currentPhotoIndex}`}
              src={activeHeroPhoto}
              alt=""
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute inset-0 hidden h-full w-full scale-[1.04] object-cover blur-2xl brightness-[0.42] md:block"
            />
          </AnimatePresence>
        ) : null}
        <AnimatePresence mode="wait">
          <motion.img
            key={`hero-${currentPhotoIndex}`}
            src={activeHeroPhoto}
            alt={`${displayName}'s photo`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "h-full w-full cursor-pointer",
              isChatProfileViewer
                ? "object-cover md:relative md:z-[1] md:object-contain md:drop-shadow-2xl"
                : "object-cover",
            )}
            onClick={() => setShowFullscreenPhoto(true)}
          />
        </AnimatePresence>
      </>
    );
  };

  const renderPhotoIndicators = () => (
    <div className="absolute left-4 right-16 top-3 z-30 flex gap-1.5">
      {photos.map((_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => goToPhoto(i)}
          className="group flex h-11 min-w-0 flex-1 items-start rounded-sm pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
          aria-label={`Show photo ${i + 1} of ${photos.length}`}
          aria-current={i === currentPhotoIndex ? "true" : undefined}
          title={`Photo ${i + 1}`}
        >
          <span
            className={cn(
              "block h-1 w-full rounded-full transition-all duration-200 group-hover:bg-white/75",
              i === currentPhotoIndex ? "bg-white" : "bg-white/40",
            )}
          />
        </button>
      ))}
    </div>
  );

  const renderTapZones = () => (
    <>
      <button
        type="button"
        onClick={() => goToPhoto(currentPhotoIndex - 1)}
        disabled={currentPhotoIndex <= 0}
        className="absolute bottom-28 left-0 top-16 z-20 min-w-11 w-1/3 rounded-r-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none"
        aria-label="Previous photo"
        title="Previous photo"
      />
      <button
        type="button"
        onClick={() => goToPhoto(currentPhotoIndex + 1)}
        disabled={currentPhotoIndex >= photos.length - 1}
        className="absolute bottom-28 right-0 top-16 z-20 min-w-11 w-1/3 rounded-l-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none"
        aria-label="Next photo"
        title="Next photo"
      />
    </>
  );

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
      <DrawerContent className="h-[95dvh] max-h-[95dvh] max-w-full bg-background border-t border-border/50 rounded-t-3xl flex flex-col overflow-hidden">
        {/* Close Button - Floating */}
        <div className="absolute top-4 right-4 z-40">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close profile"
            className="h-11 w-11 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          {/* Hero Section - Full Width Photo */}
          <div
            className={cn(
              "relative w-full overflow-hidden bg-background",
              isChatProfileViewer
                ? "aspect-[3/4] max-h-[70dvh] md:aspect-auto md:h-[clamp(420px,70dvh,760px)] md:max-h-[calc(100dvh-5rem)]"
                : "aspect-[3/4] max-h-[70vh]",
            )}
          >
            {hasVideoIntro && showVideoOverlay && vibeVideo.playbackUrl && !isChatProfileViewer ? (
              <VibePlayer
                videoUrl={vibeVideo.playbackUrl}
                thumbnailUrl={photos[0]}
                vibeCaption={vibeCaption}
                autoPlay={true}
                showControls={true}
                className="w-full h-full"
                backendReportsReady
              />
            ) : (
              <>
                {renderHeroPhoto()}
                {renderPhotoIndicators()}
                {renderTapZones()}

                {hasVideoIntro && !isChatProfileViewer ? (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    type="button"
                    onClick={() => setShowVideoOverlay(true)}
                    className="absolute bottom-28 left-4 z-30 flex min-h-11 items-center gap-2 rounded-full border border-border/50 bg-background/90 px-4 py-2.5 font-medium text-foreground shadow-lg backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    aria-label="Watch Intro"
                    title="Watch Intro"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-primary">
                      <Play className="ml-0.5 h-4 w-4 fill-primary-foreground text-primary-foreground" aria-hidden />
                    </div>
                    <span className="text-sm">Watch Intro</span>
                  </motion.button>
                ) : null}
              </>
            )}

            {/* Gradient overlay */}
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-48 bg-gradient-to-t from-background via-background/80 to-transparent" />

            {/* Profile info overlay */}
            <div className="absolute bottom-0 left-0 right-0 z-30 p-5 pb-6">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {/* Name and Age */}
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="break-words text-3xl font-display font-bold leading-tight text-foreground sm:text-4xl">
                      {displayName}
                    </h2>
                    <span className="text-2xl font-light leading-tight text-foreground/80 sm:text-3xl">{displayAge}</span>
                    <PhotoVerifiedMark verified={!!photoVerified} size="md" />
                  </div>

                  {/* Details */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-foreground/80">
                    {!isChatProfileViewer && profileData.job && (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Briefcase className="w-4 h-4" />
                        {profileData.job}
                      </span>
                    )}
                    {profileData.location && (
                      <span className="flex items-center gap-1.5 text-sm">
                        <MapPin className="w-4 h-4" />
                        {profileData.location}
                      </span>
                    )}
                    {profileData.distanceLabel && (
                      <span className="flex items-center gap-1.5 text-sm">
                        <MapPin className="w-4 h-4" />
                        {profileData.distanceLabel} away
                      </span>
                    )}
                    {!isChatProfileViewer && profileData.height && (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Ruler className="w-4 h-4" />
                        {profileData.height} cm
                      </span>
                    )}
                  </div>

                  {!isChatProfileViewer && tagline ? (
                    <p className="text-sm italic text-primary mt-2">&quot;{tagline}&quot;</p>
                  ) : null}

                  {intentDisplay ? (
                    <div className="mt-2">
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-sm text-primary">
                        {intentDisplay.emoji} {intentDisplay.label}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Compatibility badge */}
                {showCompatibilityBadge ? (
                  <div className="flex shrink-0 flex-col items-center">
                    <div className="relative w-14 h-14">
                      <svg className="w-full h-full -rotate-90">
                        <circle
                          cx="28"
                          cy="28"
                          r="24"
                          stroke="hsl(var(--muted))"
                          strokeWidth="4"
                          fill="none"
                        />
                        <circle
                          cx="28"
                          cy="28"
                          r="24"
                          stroke="url(#gradient-compat)"
                          strokeWidth="4"
                          fill="none"
                          strokeDasharray={`${compatibility * 1.51} 151`}
                          strokeLinecap="round"
                        />
                        <defs>
                          <linearGradient id="gradient-compat" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="hsl(var(--neon-violet))" />
                            <stop offset="100%" stopColor="hsl(var(--neon-pink))" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-foreground">{compatibility}%</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1">Match</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Content sections */}
          <div className={cn("px-4 space-y-4 -mt-4", showActions ? "pb-40" : "pb-10 md:pb-8")}>
            {/* Scroll hint */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: showScrollHint ? 1 : 0 }}
              className="flex justify-center py-2"
            >
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <ChevronUp className="w-4 h-4 animate-bounce" />
                <span>Scroll for more</span>
              </div>
            </motion.div>

            {renderContentSections()}
          </div>
        </div>

        {/* Fixed Action Bar - Floating (only shown when showActions is true) */}
        {showActions && (
          <div className="shrink-0 absolute bottom-0 left-0 right-0 p-4 pb-8 pointer-events-none">
            <div className="flex items-center justify-center gap-4 pointer-events-auto">
              {/* Pass button — only in discovery mode */}
              {mode === 'discovery' && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setOpen(false)}
                  className="w-14 h-14 rounded-full bg-card border-2 border-border shadow-xl flex items-center justify-center"
                >
                  <X className="w-6 h-6 text-muted-foreground" />
                </motion.button>
              )}

              {/* Like button — only in discovery mode */}
              {mode === 'discovery' && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="w-16 h-16 rounded-full bg-gradient-primary shadow-xl flex items-center justify-center neon-glow-pink"
                >
                  <Heart className="w-7 h-7 text-primary-foreground" fill="currentColor" />
                </motion.button>
              )}

              {/* Message button */}
              {onMessage && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setOpen(false);
                    onMessage();
                  }}
                  className="w-14 h-14 rounded-full bg-card border-2 border-border shadow-xl flex items-center justify-center"
                >
                  <MessageCircle className="w-6 h-6 text-primary" />
                </motion.button>
              )}

              {/* Video call button */}
              {onVideoCall && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setOpen(false);
                    onVideoCall();
                  }}
                  className="w-14 h-14 rounded-full bg-neon-cyan/20 border-2 border-neon-cyan/50 shadow-xl flex items-center justify-center"
                >
                  <Video className="w-6 h-6 text-neon-cyan" />
                </motion.button>
              )}
            </div>
          </div>
        )}

        {/* Fullscreen Photo Modal */}
        <PhotoPreviewModal
          photos={photos}
          initialIndex={currentPhotoIndex}
          isOpen={showFullscreenPhoto}
          onClose={() => setShowFullscreenPhoto(false)}
        />
      </DrawerContent>
    </Drawer>
  );
};
