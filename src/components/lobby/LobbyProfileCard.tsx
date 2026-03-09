import { useState, useEffect } from "react";
import { Sparkles, Briefcase, MapPin } from "lucide-react";
import { DeckProfile } from "@/hooks/useEventDeck";
import { supabase } from "@/integrations/supabase/client";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { PremiumBadge } from "@/components/premium/PremiumBadge";

interface LobbyProfileCardProps {
  profile: DeckProfile;
  userVibes: string[];
  isBehind?: boolean;
}

const LobbyProfileCard = ({ profile, userVibes, isBehind = false }: LobbyProfileCardProps) => {
  const [vibeLabels, setVibeLabels] = useState<string[]>([]);
  const [profileIsPremium, setProfileIsPremium] = useState(false);

  // Fetch premium status for this profile
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("is_premium")
        .eq("id", profile.profile_id)
        .maybeSingle();
      setProfileIsPremium(!!data?.is_premium);
    })();
  }, [profile.profile_id]);

  // Fetch vibe tags for this profile
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label, emoji)")
        .eq("profile_id", profile.profile_id);

      if (data) {
        const labels = data
          .map((v) => {
            const tag = v.vibe_tags as { label: string; emoji: string } | null;
            return tag ? `${tag.emoji} ${tag.label}` : null;
          })
          .filter(Boolean) as string[];
        setVibeLabels(labels);
      }
    })();
  }, [profile.profile_id]);

  // Use server-side shared_vibe_count, fall back to client-side calculation
  const sharedCount = profile.shared_vibe_count > 0
    ? profile.shared_vibe_count
    : vibeLabels.filter((v) => {
        const label = v.replace(/^\S+\s/, "");
        return userVibes.includes(label);
      }).length;

  return (
    <div className={`relative w-full h-full rounded-2xl overflow-hidden bg-card border border-border ${isBehind ? "" : "shadow-2xl shadow-black/40"}`}>
      {/* Photo */}
      <div className="absolute inset-0">
        <ProfilePhoto
          photos={profile.photos as string[]}
          avatarUrl={profile.avatar_url}
          name={profile.name}
          size="full"
          rounded="2xl"
          loading="eager"
        />
      </div>

      {/* Gradient overlay at bottom */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      {/* Super Vibe badge */}
      {profile.has_super_vibed && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neon-yellow/20 border border-neon-yellow/50 backdrop-blur-sm">
          <Sparkles className="w-3.5 h-3.5 text-neon-yellow" />
          <span className="text-xs font-semibold text-neon-yellow">Someone wants to meet you!</span>
        </div>
      )}

      {/* Premium badge */}
      {profileIsPremium && (
        <div className="absolute top-4 right-4 z-10">
          <PremiumBadge />
        </div>
      )}

      {/* Status badge if in a date */}
      {profile.queue_status && !["browsing", "idle"].includes(profile.queue_status) && (
        <div className="absolute top-4 right-4 z-10 px-2.5 py-1 rounded-full bg-secondary/80 backdrop-blur-sm border border-border">
          <span className="text-[10px] font-medium text-muted-foreground">In a date</span>
        </div>
      )}

      {/* Bottom info area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 space-y-3 z-10">
        <div className="flex items-end gap-2">
          <h3 className="text-2xl font-display font-bold text-white">{profile.name}</h3>
          <span className="text-lg text-white/80 font-medium mb-0.5">{profile.age}</span>
        </div>

        {(profile.job || profile.location) && (
          <div className="flex items-center gap-3 text-white/60 text-sm">
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
          </div>
        )}

        {vibeLabels.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {vibeLabels.slice(0, 3).map((tag) => {
              const label = tag.replace(/^\S+\s/, "");
              const isShared = userVibes.includes(label);
              return (
                <span
                  key={tag}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium backdrop-blur-sm border ${
                    isShared
                      ? "bg-primary/20 border-primary/30 text-primary"
                      : "bg-white/10 border-white/10 text-white/90"
                  }`}
                >
                  {tag}
                </span>
              );
            })}
            {vibeLabels.length > 3 && (
              <span className="shrink-0 px-2 py-1 rounded-full text-xs font-medium bg-white/10 backdrop-blur-sm text-white/60">
                +{vibeLabels.length - 3}
              </span>
            )}
          </div>
        )}

        {sharedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">
              {sharedCount} shared vibe{sharedCount > 1 ? "s" : ""}
            </span>
          </div>
        )}

        {profile.bio && (
          <p className="text-sm text-white/70 line-clamp-2">{profile.bio}</p>
        )}
      </div>
    </div>
  );
};

export default LobbyProfileCard;
