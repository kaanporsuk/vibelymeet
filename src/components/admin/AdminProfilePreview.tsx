import { useState, useEffect } from "react";
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
  User,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VibeTag } from "@/components/VibeTag";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";

import { getImageUrl, fullScreenUrl } from "@/utils/imageUrl";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AdminProfilePreviewProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

const intentLabels: Record<string, string> = {
  "long-term": "💍 Long-term partner",
  "relationship": "💕 Relationship",
  "something-casual": "✨ Something casual",
  "new-friends": "👋 New friends",
  "figuring-out": "🤷 Figuring it out",
};

const AdminProfilePreview = ({ userId, isOpen, onClose }: AdminProfilePreviewProps) => {
  const [refreshedPhotos, setRefreshedPhotos] = useState<string[]>([]);
  const [vibeVideoPlaybackUrl, setVibeVideoPlaybackUrl] = useState<string | null>(null);
  const [isResolvingVideo, setIsResolvingVideo] = useState(false);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  // Fetch user profile
  const { data: profile, isLoading } = useQuery({
    queryKey: ["admin-profile-preview", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: isOpen && !!userId,
  });

  // Fetch user vibes
  const { data: vibes } = useQuery({
    queryKey: ["admin-profile-vibes", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profile_vibes")
        .select(`
          vibe_tags (
            label,
            emoji,
            category
          )
        `)
        .eq("profile_id", userId);
      return data?.map((v) => v.vibe_tags) || [];
    },
    enabled: isOpen && !!userId,
  });

  // Refresh signed URLs for photos
  useEffect(() => {
    if (!profile?.photos?.length) {
      setRefreshedPhotos([]);
      return;
    }

    const refreshPhotos = async () => {
      const refreshed: string[] = [];
      for (const url of profile.photos) {
        if (url && isSignedUrlExpiring(url)) {
          const path = extractPathFromSignedUrl(url);
          if (path) {
            const newUrl = await getSignedPhotoUrl(path);
            refreshed.push(newUrl || url);
          } else {
            refreshed.push(url);
          }
        } else {
          refreshed.push(url);
        }
      }
      setRefreshedPhotos(refreshed);
    };

    refreshPhotos();
  }, [profile?.photos]);

  // Resolve Bunny CDN video URL
  useEffect(() => {
    if (!profile?.bunny_video_uid || (profile as any).bunny_video_status !== "ready") {
      setVibeVideoPlaybackUrl(null);
      setIsResolvingVideo(false);
      return;
    }
    setVibeVideoPlaybackUrl(
      `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${profile.bunny_video_uid}/playlist.m3u8`
    );
    setIsResolvingVideo(false);
  }, [profile?.bunny_video_uid, (profile as any)?.bunny_video_status]);

  if (!isOpen) return null;

  const photos = refreshedPhotos.length > 0 ? refreshedPhotos : profile?.photos || [];
  const lifestyle = profile?.lifestyle as Record<string, string> | null;
  const prompts = profile?.prompts as Array<{ prompt: string; answer: string }> | null;

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
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto p-4 pb-24">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-40 bg-secondary/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : profile ? (
            <div className="space-y-4">
              {/* Hero Photo */}
              {photos[0] && (
                <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl">
                  <img
                    src={photos[0]}
                    alt={profile.name}
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
                      {profile.name}, {profile.age}
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
              {profile.bio && (
                <div className="glass-card p-4 rounded-xl">
                  <p className="text-foreground leading-relaxed">{profile.bio}</p>
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
                    {vibes.map((vibe: any, i: number) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {vibe?.emoji} {vibe?.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Video Intro */}
              {profile.video_intro_url && (
                <div className="glass-card p-4 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Video className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-medium text-muted-foreground">Vibe Video</span>
                  </div>
                  <div
                    className="relative aspect-video rounded-lg overflow-hidden bg-secondary/50 cursor-pointer"
                    onClick={() => vibeVideoPlaybackUrl && setShowVideoPlayer(!showVideoPlayer)}
                  >
                    {isResolvingVideo && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {vibeVideoPlaybackUrl && (
                      <>
                        <VibePlayer
                          videoUrl={vibeVideoPlaybackUrl}
                          autoPlay={showVideoPlayer}
                          showControls
                          className="w-full h-full"
                        />
                        {!showVideoPlayer && (
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                              <Play className="w-5 h-5 text-background ml-1" fill="currentColor" />
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Additional Photos */}
              {photos.length > 1 && (
                <div className="grid grid-cols-2 gap-2">
                  {photos.slice(1).map((photo, i) => (
                    <div key={i} className="aspect-square rounded-xl overflow-hidden bg-secondary/50">
                      <img src={photo} alt={`Photo ${i + 2}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}

              {/* Prompts */}
              {prompts && prompts.length > 0 && prompts.some((p) => p.answer) && (
                <div className="space-y-3">
                  {prompts
                    .filter((p) => p.answer && p.prompt)
                    .map((prompt, i) => (
                      <div key={i} className="glass-card p-4 rounded-xl">
                        <p className="text-sm font-medium text-primary mb-1">{prompt.prompt}</p>
                        <p className="text-foreground">{prompt.answer}</p>
                      </div>
                    ))}
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
                  {profile.looking_for && (
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-muted-foreground" />
                      <span>{intentLabels[profile.looking_for] || profile.looking_for}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-12">Profile not found</div>
          )}
        </div>
      </div>

      {/* Footer - Fixed */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminProfilePreview;
