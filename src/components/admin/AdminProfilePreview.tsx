import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  X,
  MapPin,
  Briefcase,
  Ruler,
  Heart,
  Sparkles,
  Video,
  Play,
  Loader2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";

import { fullScreenUrl } from "@/utils/imageUrl";
import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";

interface AdminVibeTag {
  label: string | null;
  emoji: string | null;
  category?: string | null;
}

type AdminPreviewPrompt = {
  prompt?: string | null;
  question?: string | null;
  answer?: string | null;
};

interface AdminPreviewProfile {
  id: string;
  updated_at: string | null;
  name: string | null;
  age: number | null;
  gender: string | null;
  job: string | null;
  location: string | null;
  about_me: string | null;
  looking_for: string | null;
  relationship_intent: string | null;
  photos: string[] | null;
  avatar_url: string | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  vibe_caption: string | null;
  lifestyle?: unknown;
  prompts?: unknown;
  photo_verified: boolean | null;
  height_cm: number | null;
  age_is_placeholder?: boolean | null;
}

interface AdminProfilePreviewProps {
  profile: AdminPreviewProfile | null;
  vibes: AdminVibeTag[];
  isOpen: boolean;
  onClose: () => void;
}

const normalizePrompts = (value: unknown): AdminPreviewPrompt[] => (
  Array.isArray(value)
    ? value.filter((prompt): prompt is AdminPreviewPrompt => typeof prompt === "object" && prompt !== null)
    : []
);

const AdminProfilePreview = ({ profile, vibes, isOpen, onClose }: AdminProfilePreviewProps) => {
  const [refreshedPhotos, setRefreshedPhotos] = useState<string[]>([]);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  // Resolve photos via CDN helper (no async refresh needed)
  useEffect(() => {
    if (!profile?.photos?.length) {
      setRefreshedPhotos([]);
      return;
    }
    setRefreshedPhotos(profile.photos.map((url: string) => fullScreenUrl(url)));
  }, [profile?.photos]);

  useEffect(() => {
    setShowVideoPlayer(false);
  }, [isOpen, profile?.id]);

  const vibeVideo = useMemo(
    () =>
      profile
        ? resolveWebVibeVideoState({
            bunny_video_uid: profile.bunny_video_uid,
            bunny_video_status: profile.bunny_video_status,
            updated_at: profile.updated_at,
            vibe_caption: profile.vibe_caption,
          })
        : null,
    [profile],
  );

  if (!isOpen) return null;

  const photos: string[] = refreshedPhotos.length > 0
    ? refreshedPhotos
    : Array.isArray(profile?.photos)
      ? profile.photos
      : [];
  const lifestyle = profile?.lifestyle as Record<string, string> | null;
  const prompts = normalizePrompts(profile?.prompts);
  const profileAgeLabel = profile?.age_is_placeholder ? "Pending age" : profile?.age ?? "N/A";
  const handleClose = () => {
    setShowVideoPlayer(false);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-[60] flex flex-col"
    >
      {/* Header - Fixed */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-display text-foreground">Profile Preview</h2>
            <p className="text-sm text-muted-foreground">How {profile?.name || "User"} sees their profile</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto p-4 pb-24">
          {profile ? (
            <div className="space-y-4">
              {/* Hero Photo */}
              {photos[0] && (
                <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl">
                  <img
                    src={photos[0]}
                    alt={profile.name || "Profile photo"}
                    className="w-full h-full object-cover"
                  />
                  {profile.photo_verified && (
                    <div className="absolute top-3 right-3 z-10">
                      <Badge className="bg-green-500/90 text-white border-none">
                        ✓ Verified
                      </Badge>
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
                  {/* Name and info */}
                  <div className="absolute bottom-4 left-4 right-4">
                    <h3 className="text-2xl font-bold text-foreground">
                      {profile.name || "Unnamed user"}, {profileAgeLabel}
                    </h3>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {profile.job && (
                        <span className="flex items-center gap-1 text-sm text-foreground/80">
                          <Briefcase className="w-3 h-3" />
                          {profile.job}
                        </span>
                      )}
                      {profile.location && (
                        <span className="flex items-center gap-1 text-sm text-foreground/80">
                          <MapPin className="w-3 h-3" />
                          {profile.location}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Bio */}
              {profile.about_me && (
                <div className="glass-card p-4 rounded-xl">
                  <p className="text-foreground leading-relaxed">{profile.about_me}</p>
                </div>
              )}

              {/* Vibes */}
              {vibes && vibes.length > 0 && (
                <div className="glass-card p-4 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-muted-foreground">Interests</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {vibes.map((vibe, i: number) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {vibe?.emoji} {vibe?.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Vibe Video — canonical admin truth */}
              {vibeVideo && vibeVideo.state !== "none" && (
                <div className="glass-card p-4 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Video className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-medium text-muted-foreground">Vibe Video</span>
                    <span className="text-xs text-muted-foreground/80">({vibeVideo.state})</span>
                  </div>
                  {vibeVideo.state === "processing" || vibeVideo.state === "stale_processing" ? (
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-secondary/50 flex flex-col items-center justify-center gap-2 p-4 text-center">
                      <Loader2
                        className={`w-6 h-6 animate-spin ${
                          vibeVideo.state === "stale_processing" ? "text-amber-400" : "text-muted-foreground"
                        }`}
                      />
                      <p className="text-sm text-muted-foreground">
                        {vibeVideo.state === "stale_processing"
                          ? "Still processing — refresh or inspect Bunny webhook delivery"
                          : "Processing — not playable yet"}
                      </p>
                    </div>
                  ) : vibeVideo.state === "failed" ? (
                    <div className="aspect-video rounded-lg bg-secondary/50 flex items-center justify-center p-4">
                      <p className="text-sm text-destructive text-center">Encoding failed</p>
                    </div>
                  ) : vibeVideo.state === "error" ? (
                    <div className="aspect-video rounded-lg bg-secondary/50 flex items-center justify-center p-4">
                      <p className="text-sm text-muted-foreground text-center">Inconsistent profile data</p>
                    </div>
                  ) : vibeVideo.state === "ready" && vibeVideo.playbackUrl ? (
                    <div
                      className="relative aspect-video rounded-lg overflow-hidden bg-secondary/50 cursor-pointer"
                      onClick={() => setShowVideoPlayer(!showVideoPlayer)}
                    >
                      <VibePlayer
                        videoUrl={vibeVideo.playbackUrl}
                        thumbnailUrl={vibeVideo.thumbnailUrl ?? undefined}
                        vibeCaption={vibeVideo.caption ?? undefined}
                        autoPlay={showVideoPlayer}
                        showControls
                        className="w-full h-full"
                        backendReportsReady
                      />
                      {!showVideoPlayer && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
                          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                            <Play className="w-5 h-5 text-background ml-1" fill="currentColor" />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : vibeVideo.state === "ready" && !vibeVideo.playbackUrl ? (
                    <div className="aspect-video rounded-lg bg-secondary/50 flex items-center justify-center p-4">
                      <p className="text-sm text-muted-foreground text-center">Ready in DB — no playback URL (CDN/env)</p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Additional Photos */}
              {photos.length > 1 && (
                <div className="grid grid-cols-2 gap-2">
                  {photos.slice(1).map((photo: string, i: number) => (
                    <div key={i} className="aspect-square rounded-xl overflow-hidden bg-secondary/50">
                      <img src={photo} alt={`Photo ${i + 2}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}

              {/* Prompts */}
              {prompts.length > 0 && prompts.some((p) => p.answer) && (
                <div className="space-y-3">
                  {prompts
                    .filter((p) => p.answer && (p.prompt || p.question))
                    .map((prompt, i) => {
                      const label = prompt.prompt || prompt.question;
                      return (
                        <div key={i} className="glass-card p-4 rounded-xl">
                          <p className="text-sm font-medium text-primary mb-1">{label}</p>
                          <p className="text-foreground">{prompt.answer}</p>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Lifestyle */}
              {lifestyle && Object.keys(lifestyle).length > 0 && (
                <div className="glass-card p-4 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Info className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Lifestyle</span>
                  </div>
                  <LifestyleDetails values={lifestyle} editable={false} />
                </div>
              )}

              {/* Details */}
              <div className="glass-card p-4 rounded-xl">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {profile.height_cm && (
                    <div className="flex items-center gap-2">
                      <Ruler className="w-4 h-4 text-muted-foreground" />
                      <span>{profile.height_cm} cm</span>
                    </div>
                  )}
                  {(profile.relationship_intent || profile.looking_for) && (
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-muted-foreground" />
                      <span>
                        {getRelationshipIntentDisplaySafe(profile.relationship_intent || profile.looking_for).emoji}{" "}
                        {getRelationshipIntentDisplaySafe(profile.relationship_intent || profile.looking_for).label}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-12">Profile preview unavailable</div>
          )}
        </div>
      </div>

      {/* Footer - Fixed */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-end">
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminProfilePreview;
