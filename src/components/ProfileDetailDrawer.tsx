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
  ChevronUp,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { PhoneVerifiedBadge } from "@/components/PhoneVerifiedBadge";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { useUserProfile } from "@/hooks/useUserProfile";


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
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("__vibely_diag") !== "1") return;
    if (open) {
      console.info("[diag] ProfileDetailDrawer opened", { matchId: match.id, path: window.location.pathname });
    }
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
    location: fetchedProfile?.location ?? match.location ?? null,
    height: fetchedProfile?.height_cm ?? match.height ?? null,
    aboutMe: fetchedProfile?.about_me ?? match.aboutMe ?? null,
    lifestyle: fetchedProfile?.lifestyle ?? match.lifestyle ?? {},
    prompts: fetchedProfile?.prompts ?? match.prompts ?? [],
  };

  const tagline = fetchedProfile?.tagline?.trim() ?? "";
  const lookingFor = fetchedProfile?.looking_for?.trim() ?? "";
  const aboutTrim = (profileData.aboutMe ?? "").trim();
  const showAboutMe = aboutTrim.length > 10;
  
  const bunnyUid = fetchedProfile?.bunny_video_uid ?? match.bunnyVideoUid ?? null;
  const bunnyStatus = fetchedProfile?.bunny_video_status ?? match.bunnyVideoStatus ?? "none";
  const vibeCaption = fetchedProfile?.vibe_caption ?? match.vibeCaption ?? "";
  const hasVideoIntro = !!bunnyUid && bunnyStatus === "ready";
  const compatibility = match.compatibility ?? 0;

  // Resolve Bunny CDN URL for video playback
  useEffect(() => {
    if (!open || !bunnyUid || bunnyStatus !== "ready") {
      setSignedVideoUrl(null);
      return;
    }
    setSignedVideoUrl(
      `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${bunnyUid}/playlist.m3u8`
    );
  }, [open, bunnyUid, bunnyStatus]);

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

    // Photo 2
    if (photoIndex < photos.length) {
      sections.push(
        <motion.div
          key={`photo-${photoIndex}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl"
        >
          <img
            src={photos[photoIndex]}
            alt={`${match.name}'s photo`}
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => {
              setCurrentPhotoIndex(photoIndex);
              setShowFullscreenPhoto(true);
            }}
          />
        </motion.div>
      );
      photoIndex++;
    }

    // Vibes section
    if (match.vibes.length > 0) {
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
            {match.vibes.map((vibe) => (
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
            sections.push(
              <motion.div
                key={`photo-${photoIndex}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl"
              >
                <img
                  src={photos[photoIndex]}
                  alt={`${match.name}'s photo`}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => {
                    setCurrentPhotoIndex(photoIndex);
                    setShowFullscreenPhoto(true);
                  }}
                />
              </motion.div>
            );
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
      sections.push(
        <motion.div
          key={`photo-${photoIndex}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl"
        >
          <img
            src={photos[photoIndex]}
            alt={`${match.name}'s photo`}
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => {
              setCurrentPhotoIndex(photoIndex);
              setShowFullscreenPhoto(true);
            }}
          />
        </motion.div>
      );
      photoIndex++;
    }

    return sections;
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
      <DrawerContent className="h-[95vh] max-w-full bg-background border-t border-border/50 rounded-t-3xl flex flex-col overflow-hidden">
        {/* Close Button - Floating */}
        <div className="absolute top-4 right-4 z-30">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          {/* Hero Section - Full Width Photo */}
          <div className="relative w-full aspect-[3/4] max-h-[70vh] overflow-hidden">
            {hasVideoIntro && !showVideoOverlay ? (
              <>
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentPhotoIndex}
                    src={photos[currentPhotoIndex]}
                    alt={`${match.name}'s photo`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="w-full h-full object-cover"
                    onClick={() => setShowFullscreenPhoto(true)}
                  />
                </AnimatePresence>

                {/* Photo indicators */}
                <div className="absolute top-4 left-4 right-16 flex gap-1.5">
                  {photos.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => goToPhoto(i)}
                      className={cn(
                        "h-1 rounded-full flex-1 transition-all duration-200",
                        i === currentPhotoIndex
                          ? "bg-white"
                          : "bg-white/40"
                      )}
                    />
                  ))}
                </div>

                {/* Tap zones */}
                <button
                  onClick={() => goToPhoto(currentPhotoIndex - 1)}
                  className="absolute left-0 top-16 bottom-32 w-1/3"
                  aria-label="Previous photo"
                />
                <button
                  onClick={() => goToPhoto(currentPhotoIndex + 1)}
                  className="absolute right-0 top-16 bottom-32 w-1/3"
                  aria-label="Next photo"
                />

                {/* Play Intro Video Button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowVideoOverlay(true)}
                  className="absolute bottom-28 left-4 flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/90 backdrop-blur-md border border-border/50 text-foreground font-medium shadow-lg"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
                    <Play className="w-4 h-4 text-primary-foreground fill-primary-foreground ml-0.5" />
                  </div>
                  <span className="text-sm">Watch Intro</span>
                </motion.button>
              </>
            ) : hasVideoIntro && showVideoOverlay && signedVideoUrl ? (
              <VibePlayer
                videoUrl={signedVideoUrl}
                thumbnailUrl={photos[0]}
                vibeCaption={vibeCaption}
                autoPlay={true}
                showControls={true}
                className="w-full h-full"
              />
            ) : (
              <>
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentPhotoIndex}
                    src={photos[currentPhotoIndex]}
                    alt={`${match.name}'s photo`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="w-full h-full object-cover"
                    onClick={() => setShowFullscreenPhoto(true)}
                  />
                </AnimatePresence>

                <div className="absolute top-4 left-4 right-16 flex gap-1.5">
                  {photos.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => goToPhoto(i)}
                      className={cn(
                        "h-1 rounded-full flex-1 transition-all duration-200",
                        i === currentPhotoIndex
                          ? "bg-white"
                          : "bg-white/40"
                      )}
                    />
                  ))}
                </div>

                <button
                  onClick={() => goToPhoto(currentPhotoIndex - 1)}
                  className="absolute left-0 top-16 bottom-32 w-1/3"
                  aria-label="Previous photo"
                />
                <button
                  onClick={() => goToPhoto(currentPhotoIndex + 1)}
                  className="absolute right-0 top-16 bottom-32 w-1/3"
                  aria-label="Next photo"
                />
              </>
            )}

            {/* Gradient overlay */}
            <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />

            {/* Profile info overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-5 pb-6">
              <div className="flex items-end justify-between">
                <div className="flex-1">
                  {/* Name and Age */}
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-4xl font-display font-bold text-foreground">
                      {match.name}
                    </h2>
                    <span className="text-3xl font-light text-foreground/80">{match.age}</span>
                    <PhotoVerifiedMark verified={!!match.photoVerified} size="md" />
                    <PhoneVerifiedBadge verified={!!match.phoneVerified} size="md" />
                  </div>

                  {/* Details */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-foreground/80">
                    {profileData.job && (
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
                    {profileData.height && (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Ruler className="w-4 h-4" />
                        {profileData.height} cm
                      </span>
                    )}
                  </div>

                  {tagline ? (
                    <p className="text-sm italic text-primary mt-2">&quot;{tagline}&quot;</p>
                  ) : null}

                  {lookingFor ? (
                    <div className="mt-2">
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-sm text-primary">
                        {lookingFor}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Compatibility badge */}
                <div className="flex flex-col items-center shrink-0">
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
              </div>
            </div>
          </div>

          {/* Content sections */}
          <div className="px-4 space-y-4 pb-40 -mt-4">
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
