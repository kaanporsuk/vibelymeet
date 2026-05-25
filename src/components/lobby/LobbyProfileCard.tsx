import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Briefcase,
  MapPin,
  Info,
  ShieldCheck,
  Users,
  HeartHandshake,
  TimerReset,
} from "lucide-react";
import { DeckProfile } from "@/hooks/useEventDeck";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { PremiumBadge } from "@/components/premium/PremiumBadge";
import { cn } from "@/lib/utils";
import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import { fetchUserProfile } from "@/services/fetchUserProfile";
import { prewarmMediaAssets } from "@/lib/mediaAssetResolver";
import { markProfileVibeVideoTtffPrewarm } from "@/lib/vibeVideo/profileVibeVideoTtff";

interface LobbyProfileCardProps {
  profile: DeckProfile;
  userVibes: string[];
  isBehind?: boolean;
  retryState?: {
    remainingSeconds: number;
  } | null;
}

function formatHeightCm(cm: number | null | undefined): string | null {
  if (cm == null || cm <= 0) return null;
  return `${cm} cm`;
}

const LobbyProfileCard = ({ profile, userVibes, isBehind = false, retryState = null }: LobbyProfileCardProps) => {
  void userVibes; // Partner vibe tags come from `get_event_deck.shared_vibe_count` only (avoid per-card profile_vibes fetches).
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profileBadge = profile.premium_badge;
  const photoVerified = profile.photo_verified === true;

  const sharedCount = profile.shared_vibe_count;

  const inSession = profile.queue_status && !["browsing", "idle"].includes(profile.queue_status);
  const heightLabel = formatHeightCm(profile.height_cm);
  const showTrustStrip =
    profile.has_met_before || profile.is_already_connected || photoVerified || sharedCount > 0;

  const intentRaw = profile.looking_for?.trim();
  const intentDisplay = intentRaw ? getRelationshipIntentDisplaySafe(intentRaw) : null;
  const prewarmFullProfile = useCallback((trigger: "hover" | "pointer_down" | "touch_start" | "focus" | "click" = "hover") => {
    if (trigger !== "hover") {
      markProfileVibeVideoTtffPrewarm(profile.id, {
        surface: "lobby_card",
        trigger,
      });
    }
    void queryClient.fetchQuery({
      queryKey: ["user-profile", profile.id],
      queryFn: () => fetchUserProfile(profile.id),
      staleTime: 60_000,
    }).then((fullProfile) => {
      const playbackRef = fullProfile?.vibe_video_playback_ref?.trim();
      if (!playbackRef) return;
      if (trigger !== "hover") {
        markProfileVibeVideoTtffPrewarm(profile.id, {
          surface: "lobby_card",
          trigger,
          sourceRef: playbackRef,
          usesSignedProfileRef: true,
        });
      }
      void prewarmMediaAssets(
        [{ kind: "profile_vibe_video", sourceRef: playbackRef }],
        { concurrency: 1 },
      ).catch(() => {});
    }).catch(() => {});
  }, [profile.id, queryClient]);
  const openFullProfile = useCallback(() => {
    prewarmFullProfile("click");
    navigate(`/user/${profile.id}`);
  }, [navigate, prewarmFullProfile, profile.id]);

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
          primaryPhotoPath={profile.primary_photo_path}
          name={profile.name}
          size="full"
          rounded="2xl"
          loading="eager"
          mediaVersion={profile.media_version}
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

      {!isBehind && retryState && retryState.remainingSeconds > 0 ? (
        <div
          className="absolute left-3 right-3 top-16 z-30 flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-black/65 px-3 py-2 text-xs font-semibold text-amber-100 shadow-lg backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          <TimerReset className="h-4 w-4 shrink-0 text-amber-200" />
          <span className="min-w-0 truncate tabular-nums">Retry in {retryState.remainingSeconds}s</span>
        </div>
      ) : null}

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
          onPointerEnter={() => prewarmFullProfile("hover")}
          onPointerDown={(event) => {
            if (event.pointerType !== "touch") prewarmFullProfile("pointer_down");
          }}
          onTouchStart={() => prewarmFullProfile("touch_start")}
          onFocus={() => prewarmFullProfile("focus")}
          onClick={openFullProfile}
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
          <div className="flex min-w-0 items-baseline gap-2 flex-wrap">
            <h3 className="min-w-0 max-w-full break-words text-2xl sm:text-3xl font-display font-bold text-white tracking-tight drop-shadow-sm">
              {profile.name}
            </h3>
            {profile.age != null ? (
              <span className="text-lg sm:text-xl font-medium text-white/75 tabular-nums">{profile.age}</span>
            ) : null}
          </div>
          {profile.tagline ? (
            <p className="text-sm text-white/80 font-medium mt-1 line-clamp-1 break-words">{profile.tagline}</p>
          ) : null}
        </div>

        {intentDisplay ? (
          <p className="text-[11px] sm:text-xs text-primary/90 font-medium line-clamp-1 break-words border-l-2 border-primary/50 pl-2">
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
