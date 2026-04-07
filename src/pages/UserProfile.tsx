import { useParams, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { ArrowLeft, Briefcase, MapPin, Ruler, Loader2, Play } from "lucide-react";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { VibeTag } from "@/components/VibeTag";
import { ProfilePrompt } from "@/components/ProfilePrompt";
import { RelationshipIntent } from "@/components/RelationshipIntent";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { useUserProfile } from "@/hooks/useUserProfile";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  // Canonical public-profile fetch — includes verification fields and vibes.
  // userId is the viewed profile's id (route param), never the current user's id.
  const { data: profile, isLoading } = useUserProfile(userId ?? null);

  const vibeVideo = useMemo(
    () =>
      resolveWebVibeVideoState(
        profile
          ? {
              bunny_video_uid: profile.bunny_video_uid,
              bunny_video_status: profile.bunny_video_status,
              vibe_caption: profile.vibe_caption,
            }
          : {
              bunny_video_uid: null,
              bunny_video_status: null,
              vibe_caption: null,
            },
      ),
    [profile],
  );
  const hasVibeVideo = vibeVideo.state === "ready" && !!vibeVideo.playbackUrl;
  const playbackUrl = vibeVideo.playbackUrl;
  const thumbnailUrl = vibeVideo.thumbnailUrl;
  const vibeCaption = profile?.vibe_caption?.trim() ?? "";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-4">
        <p className="text-lg font-semibold text-foreground">Profile not found</p>
        <button onClick={() => navigate(-1)} className="text-primary font-medium">Go back</button>
      </div>
    );
  }

  const photos = (profile.photos || []).filter(Boolean);
  const resolvedPhotos = photos.map(p => resolvePhotoUrl(p)).filter(Boolean);
  const prompts = (profile.prompts || []) as Array<{ question: string; answer: string }>;
  const lifestyle = (profile.lifestyle || {}) as Record<string, string>;
  const lookingForIntent = profile.relationship_intent ?? profile.looking_for;
  // vibes come from the canonical fetch — no separate query needed.
  const vibeTags = profile.vibes ?? [];

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Back button - fixed at top */}
      <div className="fixed top-0 left-0 right-0 z-50 p-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-foreground bg-background/60 backdrop-blur-sm rounded-full px-3 py-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      {/* Photo carousel */}
      {resolvedPhotos.length > 0 && (
        <div className="relative w-full aspect-[3/4] max-h-[70vh] overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.img
              key={currentPhotoIndex}
              src={resolvedPhotos[currentPhotoIndex]}
              alt={profile.name ?? ""}
              className="w-full h-full object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
          </AnimatePresence>

          {/* Tap zones for navigation */}
          {resolvedPhotos.length > 1 && (
            <div className="absolute inset-0 flex">
              <div
                className="w-1/2 h-full"
                onClick={() => setCurrentPhotoIndex(i => Math.max(0, i - 1))}
              />
              <div
                className="w-1/2 h-full"
                onClick={() => setCurrentPhotoIndex(i => Math.min(resolvedPhotos.length - 1, i + 1))}
              />
            </div>
          )}

          {/* Photo indicators */}
          {resolvedPhotos.length > 1 && (
            <div className="absolute top-14 left-0 right-0 flex justify-center gap-1.5 px-4">
              {resolvedPhotos.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1 rounded-full flex-1 max-w-12 transition-all",
                    i === currentPhotoIndex ? "bg-primary" : "bg-background/40"
                  )}
                />
              ))}
            </div>
          )}

          {/* Gradient at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
        </div>
      )}

      {/* Profile info */}
      <div className="px-4 -mt-8 relative z-10 space-y-5">
        {/* Name and age */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-display font-bold text-foreground">
              {profile.name}, {profile.age}
            </h1>
            {profile.photo_verified && (
              <PhotoVerifiedMark verified />
            )}
          </div>

          {profile.tagline && (
            <p className="text-sm text-primary italic">"{profile.tagline}"</p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {profile.job && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5" />
                {profile.job}
              </span>
            )}
            {profile.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {profile.location}
              </span>
            )}
            {profile.height_cm && (
              <span className="flex items-center gap-1">
                <Ruler className="w-3.5 h-3.5" />
                {profile.height_cm} cm
              </span>
            )}
          </div>
        </div>

        {/* Vibe Video — same readiness/playback contract as ProfilePreview / ProfileDetailDrawer */}
        {hasVibeVideo && playbackUrl ? (
          <div className="glass-card overflow-hidden border border-border">
            <button
              type="button"
              className="relative w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
              style={{ aspectRatio: "16/9" }}
              onClick={() => setShowVideoPlayer(true)}
              aria-label="Play vibe video"
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-muted" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center border border-white/30"
                  style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
                >
                  <Play className="w-7 h-7 text-white ml-1" />
                </div>
              </div>
              {vibeCaption ? (
                <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400 mb-0.5">
                    Vibing on
                  </p>
                  <p className="text-white text-sm font-bold drop-shadow-sm">{vibeCaption}</p>
                </div>
              ) : null}
            </button>
          </div>
        ) : null}

        {/* Vibe Tags */}
        {vibeTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {vibeTags.map((vibe) => (
              <VibeTag key={vibe} label={vibe} variant="display" />
            ))}
          </div>
        )}

        {/* Looking For */}
        {lookingForIntent && (
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Looking For</h3>
            <RelationshipIntent selected={lookingForIntent} />
          </div>
        )}

        {/* About Me */}
        {profile.about_me && (
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">About Me</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {profile.about_me}
            </p>
          </div>
        )}

        {/* Prompts */}
        {prompts.filter(p => p.question && p.answer).length > 0 && (
          <div className="space-y-3">
            {prompts.filter(p => p.question && p.answer).map((prompt, i) => (
              <ProfilePrompt
                key={i}
                prompt={prompt.question}
                answer={prompt.answer}
                index={i}
              />
            ))}
          </div>
        )}

        {/* Lifestyle */}
        {Object.keys(lifestyle).length > 0 && (
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Lifestyle</h3>
            <LifestyleDetails values={lifestyle} />
          </div>
        )}
      </div>

      {showVideoPlayer && hasVibeVideo && playbackUrl ? (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg">
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={() => setShowVideoPlayer(false)}
                className="px-3 py-1.5 rounded-full bg-white/10 text-white text-sm font-semibold hover:bg-white/15"
              >
                Close
              </button>
            </div>
            <div className="rounded-2xl overflow-hidden bg-black">
              <VibePlayer
                videoUrl={playbackUrl}
                thumbnailUrl={thumbnailUrl ?? undefined}
                vibeCaption={vibeCaption}
                autoPlay={true}
                showControls={true}
                className="w-full h-full"
                backendReportsReady
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UserProfile;
