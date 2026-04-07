import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Briefcase,
  MapPin,
  Info,
  ShieldCheck,
  Users,
  HeartHandshake,
} from "lucide-react";
import { DeckProfile } from "@/hooks/useEventDeck";
import { supabase } from "@/integrations/supabase/client";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { PremiumBadge } from "@/components/premium/PremiumBadge";
import { getUserBadge } from "@/hooks/useEntitlements";
import { cn } from "@/lib/utils";
import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";

interface LobbyProfileCardProps {
  profile: DeckProfile;
  userVibes: string[];
  isBehind?: boolean;
}

function formatHeightCm(cm: number | null | undefined): string | null {
  if (cm == null || cm <= 0) return null;
  return `${cm} cm`;
}

const LobbyProfileCard = ({ profile, userVibes, isBehind = false }: LobbyProfileCardProps) => {
  void userVibes; // Partner vibe tags come from `get_event_deck.shared_vibe_count` only (avoid per-card profile_vibes fetches).
  const navigate = useNavigate();
  const [profileBadge, setProfileBadge] = useState<"premium" | "vip" | null>(null);
  const [photoVerified, setPhotoVerified] = useState(false);

  useEffect(() => {
    if (isBehind) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("subscription_tier, photo_verified")
        .eq("id", profile.id)
        .maybeSingle();
      setProfileBadge(getUserBadge(data?.subscription_tier as string | null | undefined));
      setPhotoVerified(Boolean(data?.photo_verified));
    })();
  }, [profile.id, isBehind]);

  const sharedCount = profile.shared_vibe_count;

  const inSession = profile.queue_status && !["browsing", "idle"].includes(profile.queue_status);
  const heightLabel = formatHeightCm(profile.height_cm);
  const showTrustStrip =
    profile.has_met_before || profile.is_already_connected || photoVerified || sharedCount > 0;

  const intentRaw = profile.looking_for?.trim();
  const intentDisplay = intentRaw ? getRelationshipIntentDisplaySafe(intentRaw) : null;

  return (
    <div
      className={cn(
        "relative w-full h-full rounded-3xl overflow-hidden bg-zinc-950 ring-1 ring-inset ring-white/[0.12]",
        isBehind ? "opacity-[0.97]" : "shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85),0_0_0_1px_rgba(168,85,247,0.15)]",
      )}
    >
      {/* Photo — full bleed, cinematic */}
      <div className="absolute inset-0 scale-[1.02]">
        <ProfilePhoto
          photos={profile.photos as string[]}
          avatarUrl={profile.avatar_url}
          name={profile.name}
          size="full"
          rounded="2xl"
          loading="eager"
        />
      </div>

      {/* Neon wash + vignette */}
      <div
        className="absolute inset-0 pointer-events-none rounded-3xl"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 20%, rgba(168,85,247,0.12) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(34,211,238,0.08) 0%, transparent 45%)",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent pointer-events-none rounded-3xl" />

      {/* Top chrome */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between gap-2 p-3 sm:p-4">
        {profile.has_super_vibed ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-neon-yellow/15 border border-neon-yellow/45 backdrop-blur-md shadow-[0_0_20px_rgba(250,204,21,0.15)] max-w-[min(100%,14rem)]">
            <Sparkles className="w-3.5 h-3.5 text-neon-yellow shrink-0" />
            <span className="text-[10px] sm:text-xs font-semibold text-neon-yellow leading-tight">
              Wants to meet you
            </span>
          </div>
        ) : (
          <span />
        )}

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {inSession && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-white/10 text-white/70 border border-white/15 backdrop-blur-md">
              In session
            </span>
          )}
          {profileBadge && <PremiumBadge variant={profileBadge} />}
        </div>
      </div>

      {/* Profile info — full profile (lightweight: opens full user page) */}
      {!isBehind && (
        <button
          type="button"
          onClick={() => navigate(`/user/${profile.id}`)}
          className="absolute bottom-[min(42%,200px)] right-3 sm:right-4 z-30 w-11 h-11 rounded-full bg-black/50 hover:bg-black/65 border border-white/20 backdrop-blur-md flex items-center justify-center transition-colors shadow-lg"
          aria-label="Open full profile"
        >
          <Info className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Bottom content */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 sm:p-5 pb-5 space-y-2.5">
        {showTrustStrip && (
          <div className="flex flex-wrap gap-1.5">
            {photoVerified && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/20 text-cyan-200 border border-cyan-400/30">
                <ShieldCheck className="w-3 h-3" />
                Photo verified
              </span>
            )}
            {profile.has_met_before && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/10 text-white/85 border border-white/15">
                <HeartHandshake className="w-3 h-3 opacity-80" />
                Met before
              </span>
            )}
            {profile.is_already_connected && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/20 text-primary border border-primary/25">
                <Users className="w-3 h-3" />
                Connected
              </span>
            )}
            {sharedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/35">
                <Sparkles className="w-3 h-3" />
                {sharedCount} shared vibe{sharedCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight drop-shadow-sm">
              {profile.name}
            </h3>
            {profile.age != null ? (
              <span className="text-lg sm:text-xl font-medium text-white/75 tabular-nums">{profile.age}</span>
            ) : null}
          </div>
          {profile.tagline ? (
            <p className="text-sm text-white/80 font-medium mt-1 line-clamp-1">{profile.tagline}</p>
          ) : null}
        </div>

        {intentDisplay ? (
          <p className="text-[11px] sm:text-xs text-primary/90 font-medium line-clamp-1 border-l-2 border-primary/50 pl-2">
            <span className="mr-1" aria-hidden>
              {intentDisplay.emoji}
            </span>
            {intentDisplay.label}
          </p>
        ) : null}

        {(profile.job || profile.location || heightLabel) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
            {profile.job && (
              <span className="flex items-center gap-1 max-w-[48%]">
                <Briefcase className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="truncate">{profile.job}</span>
              </span>
            )}
            {profile.location && (
              <span className="flex items-center gap-1 max-w-[48%]">
                <MapPin className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="truncate">{profile.location}</span>
              </span>
            )}
            {heightLabel && <span className="text-white/45 tabular-nums">{heightLabel}</span>}
          </div>
        )}

        {profile.about_me ? (
          <p className="text-[13px] sm:text-sm text-white/65 line-clamp-2 leading-relaxed">{profile.about_me}</p>
        ) : null}
      </div>
    </div>
  );
};

export default LobbyProfileCard;
