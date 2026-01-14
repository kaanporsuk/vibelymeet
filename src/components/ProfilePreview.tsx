import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Briefcase,
  Ruler,
  Heart,
  MessageCircle,
  Sparkles,
  ChevronUp,
  Info,
  Video,
  Play,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeTag } from "@/components/VibeTag";
import { VerificationBadge } from "@/components/VerificationBadge";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { LazyImage } from "@/components/LazyImage";
import { SuperLikeButton } from "@/components/SuperLikeButton";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";
import { getSignedVideoUrl } from "@/services/videoStorageService";

interface ProfilePreviewProps {
  profile: {
    name: string;
    age: number;
    photos: string[];
    bio: string;
    job: string;
    location: string;
    heightCm: number;
    vibes: string[];
    verified: boolean;
    photoVerified?: boolean;
    prompts: { prompt: string; answer: string }[];
    relationshipIntent: string;
    lifestyle?: Record<string, string>;
    videoIntroUrl?: string;
  };
  onClose: () => void;
}

const intentLabels: Record<string, string> = {
  "long-term": "💍 Long-term partner",
  "relationship": "💕 Relationship",
  "something-casual": "✨ Something casual",
  "new-friends": "👋 New friends",
  "figuring-out": "🤷 Figuring it out",
};

export const ProfilePreview = ({ profile, onClose }: ProfilePreviewProps) => {
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);
  const [showActionHint, setShowActionHint] = useState(true);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const [vibeVideoPlaybackUrl, setVibeVideoPlaybackUrl] = useState<string | null>(null);
  const [isResolvingVibeVideo, setIsResolvingVibeVideo] = useState(false);
  const { hapticSwipe, hapticTap, playFeedback } = useSoundEffects();

  const hasPhotos = profile.photos.length > 0;

  // Resolve a playable URL for vibe videos (bucket is private, so we need a signed URL)
  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      if (!profile.videoIntroUrl) {
        setVibeVideoPlaybackUrl(null);
        return;
      }

      setIsResolvingVibeVideo(true);
      const signed = await getSignedVideoUrl(profile.videoIntroUrl);
      if (cancelled) return;

      setVibeVideoPlaybackUrl(signed);
      setIsResolvingVibeVideo(false);
    };

    resolve();

    return () => {
      cancelled = true;
    };
  }, [profile.videoIntroUrl]);

  // Hide action hint after a few seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowActionHint(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  const goToPhoto = (index: number) => {
    if (index >= 0 && index < profile.photos.length) {
      setCurrentPhotoIndex(index);
      hapticSwipe();
    }
  };

  // Create content sections interspersed with photos (Hinge-style)
  const contentSections = [
    // Video intro first if available
    ...(profile.videoIntroUrl ? [{ type: 'video' as const, data: profile.videoIntroUrl }] : []),
    // Photo 1 is always hero
    ...(profile.bio ? [{ type: 'bio' as const, data: profile.bio }] : []),
    // Photo 2
    ...(profile.vibes.length > 0 ? [{ type: 'vibes' as const, data: profile.vibes }] : []),
    // Photo 3
    ...profile.prompts.filter(p => p.answer && p.prompt).map(p => ({ type: 'prompt' as const, data: p })),
    // Remaining photos interspersed
    ...(profile.lifestyle && Object.keys(profile.lifestyle).length > 0 
      ? [{ type: 'lifestyle' as const, data: profile.lifestyle }] 
      : []),
  ];

  // Interleave photos with content
  const renderContent = () => {
    const elements: JSX.Element[] = [];
    let photoIndex = 1; // Start from second photo (first is hero)
    let contentIndex = 0;

    while (contentIndex < contentSections.length || photoIndex < profile.photos.length) {
      // Add a content section
      if (contentIndex < contentSections.length) {
        const section = contentSections[contentIndex];
        elements.push(renderSection(section, contentIndex));
        contentIndex++;
      }

      // Add a photo (every 2 content sections or if we have more photos)
      if (photoIndex < profile.photos.length && (contentIndex % 2 === 0 || contentIndex >= contentSections.length)) {
        const currentPhotoIdx = photoIndex; // Capture for closure
        elements.push(
          <motion.div
            key={`photo-${photoIndex}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * elements.length }}
            className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl"
          >
            <LazyImage
              src={profile.photos[photoIndex]}
              alt={`${profile.name}'s photo`}
              className="w-full h-full cursor-pointer"
              onClick={() => {
                hapticTap();
                setCurrentPhotoIndex(currentPhotoIdx);
                setShowFullscreenPhoto(true);
              }}
            />
            {/* Show verification badge on first photo in interspersed section */}
            {profile.photoVerified && currentPhotoIdx === 1 && (
              <div className="absolute top-3 right-3 z-10">
                <PhotoVerifiedMark verified size="md" />
              </div>
            )}
          </motion.div>
        );
        photoIndex++;
      }
    }

    return elements;
  };

  const renderSection = (section: typeof contentSections[0], index: number) => {
    const delay = 0.1 * index;

    switch (section.type) {
      case 'video':
        return (
          <motion.div
            key="video"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="glass-card p-4 rounded-2xl"
          >
            <div className="flex items-center gap-2 mb-3">
              <Video className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm font-medium text-muted-foreground">Vibe Video</span>
            </div>

            <div
              className="relative aspect-[9/16] max-h-[50vh] mx-auto rounded-xl overflow-hidden"
              onClick={() => {
                if (!vibeVideoPlaybackUrl) return;
                setShowVideoPlayer((v) => !v);
              }}
              role={vibeVideoPlaybackUrl ? "button" : undefined}
              aria-label={vibeVideoPlaybackUrl ? "Play vibe video" : "Vibe video loading"}
            >
              {isResolvingVibeVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {!isResolvingVibeVideo && !vibeVideoPlaybackUrl && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary">
                  <Play className="w-8 h-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Video unavailable</p>
                </div>
              )}

              {vibeVideoPlaybackUrl && (
                <div className="w-full h-full">
                  <VibePlayer
                    videoUrl={vibeVideoPlaybackUrl}
                    autoPlay={showVideoPlayer}
                    showControls
                    className="w-full h-full"
                  />

                  {!showVideoPlayer && (
                    <div className="absolute inset-0 bg-background/30 flex items-center justify-center transition-colors">
                      <motion.div
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="w-16 h-16 rounded-full bg-neon-cyan/90 flex items-center justify-center shadow-lg"
                      >
                        <Play className="w-7 h-7 text-background ml-1" fill="currentColor" />
                      </motion.div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground mt-2">
              What I'm vibing on right now
            </p>
          </motion.div>
        );

      case 'bio':
        return (
          <motion.div
            key="bio"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="glass-card p-5 rounded-2xl"
          >
            <p className="text-lg leading-relaxed text-foreground">{section.data}</p>
          </motion.div>
        );

      case 'vibes':
        return (
          <motion.div
            key="vibes"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="glass-card p-5 rounded-2xl"
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Interests</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(section.data as string[]).map((vibe) => (
                <VibeTag key={vibe} label={vibe} />
              ))}
            </div>
          </motion.div>
        );

      case 'prompt':
        const prompt = section.data as { prompt: string; answer: string };
        return (
          <motion.div
            key={`prompt-${prompt.prompt}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="glass-card p-5 rounded-2xl"
          >
            <p className="text-sm font-medium text-primary mb-2">{prompt.prompt}</p>
            <p className="text-lg leading-relaxed text-foreground">{prompt.answer}</p>
          </motion.div>
        );

      case 'lifestyle':
        return (
          <motion.div
            key="lifestyle"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="glass-card p-5 rounded-2xl"
          >
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Lifestyle</span>
            </div>
            <LifestyleDetails values={section.data as Record<string, string>} editable={false} />
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background flex flex-col"
      >
        {/* Fixed Header - Minimal */}
        <div className="shrink-0 absolute top-0 left-0 right-0 z-30 p-4 flex items-center justify-between pointer-events-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm pointer-events-auto"
          >
            <X className="w-5 h-5" />
          </Button>
          <div className="px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border/50">
            <span className="text-xs font-medium text-muted-foreground">Preview Mode</span>
          </div>
          <div className="w-10" />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain scroll-smooth">
        {/* Hero Photo - Full Width, Tall with Swipe Gestures */}
          {hasPhotos && (
            <div className="relative w-full aspect-[3/4] min-h-[70vh] max-h-[85vh] overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.img
                  key={currentPhotoIndex}
                  src={profile.photos[currentPhotoIndex]}
                  alt={`${profile.name}'s photo`}
                  className="w-full h-full object-cover touch-pan-y"
                  initial={{ opacity: 0, x: 100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.1}
                  onDragEnd={(_, info) => {
                    const threshold = 50;
                    if (info.offset.x > threshold && currentPhotoIndex > 0) {
                      goToPhoto(currentPhotoIndex - 1);
                    } else if (info.offset.x < -threshold && currentPhotoIndex < profile.photos.length - 1) {
                      goToPhoto(currentPhotoIndex + 1);
                    }
                  }}
                  onClick={() => setShowFullscreenPhoto(true)}
                />
              </AnimatePresence>

              {/* Photo verification badge */}
              {profile.photoVerified && currentPhotoIndex === 0 && (
                <div className="absolute top-16 right-4 z-10">
                  <PhotoVerifiedMark verified size="md" />
                </div>
              )}

              {/* Photo indicators at top */}
              <div className="absolute top-14 left-4 right-4 flex gap-1.5 z-10">
                {profile.photos.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => goToPhoto(index)}
                    className={cn(
                      "h-1 rounded-full flex-1 transition-all duration-200",
                      index === currentPhotoIndex
                        ? "bg-white"
                        : "bg-white/40"
                    )}
                  />
                ))}
              </div>

              {/* Tap zones for navigation (fallback for non-touch) */}
              <button
                onClick={() => goToPhoto(currentPhotoIndex - 1)}
                className="absolute left-0 top-20 bottom-32 w-1/4 z-5"
                aria-label="Previous photo"
              />
              <button
                onClick={() => goToPhoto(currentPhotoIndex + 1)}
                className="absolute right-0 top-20 bottom-32 w-1/4 z-5"
                aria-label="Next photo"
              />

              {/* Gradient overlay at bottom */}
              <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />

              {/* Profile info overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-5 pb-6">
                <div className="flex items-end justify-between">
                  <div className="flex-1">
                    {/* Name and Age - Large and prominent */}
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="text-4xl font-display font-bold text-foreground">
                        {profile.name}
                      </h1>
                      <span className="text-3xl font-light text-foreground/80">{profile.age}</span>
                      <VerificationBadge verified={profile.verified} size="lg" />
                    </div>

                    {/* Key details row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-foreground/80">
                      {profile.job && (
                        <span className="flex items-center gap-1.5 text-sm">
                          <Briefcase className="w-4 h-4" />
                          {profile.job}
                        </span>
                      )}
                      {profile.location && (
                        <span className="flex items-center gap-1.5 text-sm">
                          <MapPin className="w-4 h-4" />
                          {profile.location}
                        </span>
                      )}
                      {profile.heightCm > 0 && (
                        <span className="flex items-center gap-1.5 text-sm">
                          <Ruler className="w-4 h-4" />
                          {profile.heightCm} cm
                        </span>
                      )}
                    </div>

                    {/* Intent badge */}
                    {profile.relationshipIntent && intentLabels[profile.relationshipIntent] && (
                      <div className="mt-2">
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-sm text-primary">
                          {intentLabels[profile.relationshipIntent]}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Photo verified badge */}
                  <PhotoVerifiedMark verified={!!profile.photoVerified} size="md" />
                </div>
              </div>
            </div>
          )}

          {/* Content sections - Hinge-style cards with interspersed photos */}
          <div className="px-4 space-y-4 pb-40 -mt-4">
            {/* Scroll hint */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: showActionHint ? 1 : 0 }}
              className="flex justify-center py-2"
            >
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <ChevronUp className="w-4 h-4 animate-bounce" />
                <span>Scroll for more</span>
              </div>
            </motion.div>

            {renderContent()}
          </div>
        </div>

        {/* Fixed Bottom Action Bar - Large, Floating */}
        <div className="shrink-0 absolute bottom-0 left-0 right-0 p-4 pb-8 pointer-events-none">
          <div className="flex items-center justify-center gap-4 pointer-events-auto">
            {/* Pass button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => hapticTap()}
              className="w-14 h-14 rounded-full bg-card border-2 border-border shadow-xl flex items-center justify-center"
            >
              <X className="w-6 h-6 text-muted-foreground" />
            </motion.button>

            {/* Super Like button */}
            <SuperLikeButton 
              size="md"
              onClick={() => {
                playFeedback('superlike', { volume: 0.6 });
              }}
            />

            {/* Like button - Largest, center */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => playFeedback('match', { volume: 0.5 })}
              className="w-20 h-20 rounded-full bg-gradient-primary shadow-xl flex items-center justify-center neon-glow-pink"
            >
              <Heart className="w-9 h-9 text-primary-foreground" fill="currentColor" />
            </motion.button>

            {/* Message button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => hapticTap()}
              className="w-14 h-14 rounded-full bg-card border-2 border-border shadow-xl flex items-center justify-center"
            >
              <MessageCircle className="w-6 h-6 text-primary" />
            </motion.button>
          </div>

          {/* Preview mode indicator */}
          <p className="text-center text-xs text-muted-foreground mt-4">
            This is how others see your profile
          </p>
        </div>
      </motion.div>

      {/* Fullscreen Photo Modal */}
      <PhotoPreviewModal
        photos={profile.photos}
        initialIndex={currentPhotoIndex}
        isOpen={showFullscreenPhoto}
        onClose={() => setShowFullscreenPhoto(false)}
      />
    </>
  );
};
