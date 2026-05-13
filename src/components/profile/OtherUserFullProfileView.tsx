import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Dumbbell,
  Heart,
  Loader2,
  Mail,
  MapPin,
  PawPrint,
  Phone,
  Play,
  Ruler,
  ShieldCheck,
  Sparkles,
  Utensils,
  Video,
  Wine,
  X,
} from "lucide-react";
import type { OtherUserFullProfileViewModel } from "@clientShared/profile/otherUserProfileViewModel";
import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import { Button } from "@/components/ui/button";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";
import { ProfilePrompt } from "@/components/ProfilePrompt";
import { VibeTag } from "@/components/VibeTag";
import { VibePlayer } from "@/components/vibe-video/VibePlayer";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { cn } from "@/lib/utils";
import { AdaptiveProfileMedia } from "./AdaptiveProfileMedia";

type OtherUserFullProfileViewProps = {
  profile: OtherUserFullProfileViewModel;
  onClose?: () => void;
  className?: string;
  actions?: ReactNode;
  compatibilityPercent?: number | null;
  closeLabel?: string;
};

type DetailIcon = typeof Briefcase;

const lifestyleIconByKey: Record<string, DetailIcon> = {
  smoking: Sparkles,
  drinking: Wine,
  exercise: Dumbbell,
  diet: Utensils,
  pets: PawPrint,
  children: Heart,
};

function Section({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon?: DetailIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 text-primary" aria-hidden /> : null}
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function DetailChip({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: DetailIcon;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card/60 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </span>
      </div>
      <p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function VerificationBadge({
  label,
  icon: Icon,
}: {
  label: string;
  icon: DetailIcon;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function OtherUserFullProfileView({
  profile,
  onClose,
  className,
  actions,
  compatibilityPercent,
  closeLabel = "Back",
}: OtherUserFullProfileViewProps) {
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [photoPreviewIndex, setPhotoPreviewIndex] = useState<number | null>(null);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);

  useEffect(() => {
    setCurrentPhotoIndex(0);
    setPhotoPreviewIndex(null);
    setShowVideoPlayer(false);
  }, [profile.id]);

  const photos = profile.photos;
  const heroPhoto = photos[currentPhotoIndex] ?? photos[0] ?? profile.avatarUrl ?? "";
  const displayName = profile.name ?? "Vibely member";
  const title = profile.age ? `${displayName}, ${profile.age}` : displayName;
  const locationText = [profile.location, profile.distanceLabel].filter(Boolean).join(" • ");
  const intentRaw = profile.relationshipIntent || profile.lookingFor;
  const intentDisplay = intentRaw ? getRelationshipIntentDisplaySafe(intentRaw) : null;

  const vibeVideo = useMemo(
    () =>
      resolveWebVibeVideoState({
        bunny_video_uid: profile.vibeVideo.uid,
        bunny_video_status: profile.vibeVideo.status,
        updated_at: profile.updatedAt,
        vibe_caption: profile.vibeVideo.caption,
      }),
    [profile.vibeVideo.uid, profile.vibeVideo.status, profile.updatedAt, profile.vibeVideo.caption],
  );
  const hasPlayableVibeVideo = vibeVideo.state === "ready" && !!vibeVideo.playbackUrl;
  const verificationBadges = [
    profile.verification.email ? { label: "Email verified", icon: Mail } : null,
    profile.verification.phone ? { label: "Phone verified", icon: Phone } : null,
    profile.verification.photo ? { label: "Photo verified", icon: ShieldCheck } : null,
  ].filter(Boolean) as Array<{ label: string; icon: DetailIcon }>;

  const detailRows = [
    profile.zodiac ? { label: "Zodiac", value: profile.zodiac, icon: Sparkles } : null,
    profile.workLabel ? { label: "Work", value: profile.workLabel, icon: Briefcase } : null,
    profile.heightCm ? { label: "Height", value: `${profile.heightCm} cm`, icon: Ruler } : null,
    ...profile.lifestyleDetails.map((detail) => ({
      label: detail.label,
      value: detail.value,
      icon: lifestyleIconByKey[detail.key] ?? CheckCircle2,
    })),
  ].filter(Boolean) as Array<{ label: string; value: string; icon: DetailIcon }>;

  return (
    <div className={cn("min-h-full bg-background text-foreground", className)}>
      <div className="relative">
        {heroPhoto ? (
          <AdaptiveProfileMedia
            src={heroPhoto}
            alt={`${displayName}'s profile photo`}
            variant="hero"
            className="border-x-0 border-t-0"
            onClick={() => setPhotoPreviewIndex(currentPhotoIndex)}
          />
        ) : (
          <div className="flex h-[clamp(360px,62dvh,680px)] items-center justify-center rounded-b-[28px] bg-secondary text-muted-foreground">
            <span className="text-sm font-medium">No photo yet</span>
          </div>
        )}

        {onClose ? (
          <Button
            type="button"
            variant="glass"
            size="sm"
            onClick={onClose}
            className="absolute left-4 top-4 z-20 h-11 min-h-11 rounded-full px-3 sm:hidden"
            aria-label={closeLabel}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{closeLabel}</span>
          </Button>
        ) : null}

        {onClose ? (
          <Button
            type="button"
            variant="glass"
            size="icon"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 hidden h-11 min-h-11 w-11 rounded-full sm:inline-flex"
            aria-label="Close profile"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}

        {photos.length > 1 ? (
          <>
            <div className="absolute inset-x-4 top-16 z-20 flex gap-1.5">
              {photos.map((photo, index) => (
                <button
                  key={`${photo}-${index}`}
                  type="button"
                  className="flex h-11 min-h-11 flex-1 items-start rounded-full pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  aria-label={`Show photo ${index + 1}`}
                  onClick={() => setCurrentPhotoIndex(index)}
                >
                  <span
                    className={cn(
                      "block h-1.5 w-full rounded-full transition-colors",
                      index === currentPhotoIndex ? "bg-white" : "bg-white/35",
                    )}
                  />
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-20 flex items-center justify-between px-3">
              <button
                type="button"
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-md transition hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Previous photo"
                disabled={currentPhotoIndex === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  setCurrentPhotoIndex((index) => Math.max(0, index - 1));
                }}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-md transition hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Next photo"
                disabled={currentPhotoIndex >= photos.length - 1}
                onClick={(event) => {
                  event.stopPropagation();
                  setCurrentPhotoIndex((index) => Math.min(photos.length - 1, index + 1));
                }}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </>
        ) : null}
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-5 sm:px-6 lg:px-8">
        <div className="space-y-7">
          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="break-words text-3xl font-display font-bold leading-tight">
                    {title}
                  </h1>
                  {verificationBadges.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      Verified
                    </span>
                  ) : null}
                  {profile.isPremium ? (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                      Premium
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  {locationText ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4" aria-hidden />
                      {locationText}
                    </span>
                  ) : null}
                  {profile.workLabel ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase className="h-4 w-4" aria-hidden />
                      {profile.workLabel}
                    </span>
                  ) : null}
                </div>

                {profile.tagline ? (
                  <p className="max-w-2xl text-sm font-medium italic text-primary">
                    "{profile.tagline}"
                  </p>
                ) : null}
              </div>

              {typeof compatibilityPercent === "number" && compatibilityPercent > 0 ? (
                <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-primary">{compatibilityPercent}%</p>
                  <p className="text-xs font-medium text-muted-foreground">Match</p>
                </div>
              ) : null}
            </div>
          </section>

          {vibeVideo.state !== "none" ? (
            <Section title="Vibe Video" icon={Video}>
              {hasPlayableVibeVideo && vibeVideo.playbackUrl ? (
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  {showVideoPlayer ? (
                    <VibePlayer
                      videoUrl={vibeVideo.playbackUrl}
                      thumbnailUrl={vibeVideo.thumbnailUrl ?? undefined}
                      vibeCaption={vibeVideo.caption ?? undefined}
                      className="aspect-video"
                      backendReportsReady
                    />
                  ) : (
                    <button
                      type="button"
                      className="relative block aspect-video w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => setShowVideoPlayer(true)}
                      aria-label="Watch Intro"
                    >
                      {vibeVideo.thumbnailUrl ? (
                        <img
                          src={vibeVideo.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-secondary" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur-md">
                          <Play className="ml-1 h-7 w-7" aria-hidden />
                        </span>
                      </div>
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                          Watch Intro
                        </p>
                        {vibeVideo.caption ? (
                          <p className="mt-1 text-sm font-semibold text-white">{vibeVideo.caption}</p>
                        ) : null}
                      </div>
                    </button>
                  )}
                </div>
              ) : null}

              {vibeVideo.state === "processing" || vibeVideo.state === "stale_processing" ? (
                <div className="rounded-2xl border border-border bg-card/70 p-4">
                  <div className="flex items-start gap-3">
                    {vibeVideo.state === "stale_processing" ? (
                      <AlertCircle className="mt-0.5 h-5 w-5 text-amber-400" aria-hidden />
                    ) : (
                      <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" aria-hidden />
                    )}
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {vibeVideo.state === "stale_processing"
                          ? "Vibe Video still processing"
                          : "Vibe Video processing"}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {vibeVideo.state === "stale_processing"
                          ? "Their clip is saved, but playback is taking longer than usual."
                          : "Their clip is saved and getting ready for playback."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {vibeVideo.state === "failed" || vibeVideo.state === "error" ? (
                <div className="rounded-2xl border border-amber-500/25 bg-card/70 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-amber-400" aria-hidden />
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {vibeVideo.state === "failed" ? "Vibe Video needs a fresh take" : "Vibe Video unavailable"}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {vibeVideo.state === "failed"
                          ? "This clip did not finish processing."
                          : "This intro is unavailable right now."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {vibeVideo.state === "ready" && !vibeVideo.playbackUrl ? (
                <div className="rounded-2xl border border-border bg-card/70 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-amber-400" aria-hidden />
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Vibe Video preview syncing
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The clip is ready on our side and playback should appear shortly.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </Section>
          ) : null}

          {profile.aboutMe ? (
            <Section title="About Me">
              <div className="rounded-2xl border border-border bg-card/70 p-4">
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                  {profile.aboutMe}
                </p>
              </div>
            </Section>
          ) : null}

          {intentDisplay ? (
            <Section title="Looking For" icon={Heart}>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3">
                <span className="text-lg" aria-hidden>
                  {intentDisplay.emoji}
                </span>
                <span className="text-sm font-semibold text-foreground">{intentDisplay.label}</span>
              </div>
            </Section>
          ) : null}

          {profile.prompts.length > 0 ? (
            <Section title="Conversation Starters" icon={BadgeCheck}>
              <div className="grid gap-3">
                {profile.prompts.map((prompt, index) => (
                  <ProfilePrompt
                    key={`${prompt.question}-${index}`}
                    prompt={prompt.question}
                    answer={prompt.answer}
                    index={index}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {profile.vibes.length > 0 ? (
            <Section title="My Vibes" icon={Sparkles}>
              <div className="flex flex-wrap gap-2">
                {profile.vibes.map((vibe) => (
                  <VibeTag
                    key={vibe.id ?? vibe.label}
                    label={vibe.label}
                    emoji={vibe.emoji}
                    variant="display"
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {detailRows.length > 0 ? (
            <Section title="Details" icon={CheckCircle2}>
              <div className="grid gap-3 sm:grid-cols-2">
                {detailRows.map((detail) => (
                  <DetailChip
                    key={`${detail.label}-${detail.value}`}
                    label={detail.label}
                    value={detail.value}
                    icon={detail.icon}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {verificationBadges.length > 0 ? (
            <Section title="Verification Status" icon={ShieldCheck}>
              <div className="flex flex-wrap gap-2">
                {verificationBadges.map((badge) => (
                  <VerificationBadge key={`status-${badge.label}`} label={badge.label} icon={badge.icon} />
                ))}
              </div>
            </Section>
          ) : null}

          {photos.length > 0 ? (
            <Section title="Photos" icon={BadgeCheck}>
              <div className="grid gap-3 md:grid-cols-2">
                {photos.map((photo, index) => (
                  <AdaptiveProfileMedia
                    key={`${photo}-${index}`}
                    src={photo}
                    alt={`${displayName}'s photo ${index + 1}`}
                    variant="gallery"
                    onClick={() => setPhotoPreviewIndex(index)}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {actions ? (
            <div className="sticky bottom-0 z-20 border-t border-border bg-background/90 py-3 backdrop-blur-xl">
              {actions}
            </div>
          ) : null}
        </div>
      </main>

      <PhotoPreviewModal
        photos={photos}
        initialIndex={photoPreviewIndex ?? 0}
        isOpen={photoPreviewIndex !== null}
        onClose={() => setPhotoPreviewIndex(null)}
      />
    </div>
  );
}
