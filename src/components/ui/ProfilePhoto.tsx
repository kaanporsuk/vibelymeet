import { useState } from "react";
import { cn } from "@/lib/utils";
import { getImageUrl, avatarUrl as avatarPreset, thumbnailUrl as thumbPreset } from "@/utils/imageUrl";

const BUNNY_CDN = import.meta.env.VITE_BUNNY_CDN_HOSTNAME ?? "";

function appendCdnParams(src: string, params: string): string {
  if (!src || !BUNNY_CDN || !src.includes(BUNNY_CDN)) return src;
  return src.includes("?") ? src : `${src}?${params}`;
}

interface ProfilePhotoProps {
  photos?: string[] | null;
  avatarUrl?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  rounded?: "full" | "xl" | "2xl";
  loading?: "eager" | "lazy";
}

const sizeClasses: Record<string, string> = {
  sm: "w-10 h-10",
  md: "w-16 h-16",
  lg: "w-24 h-24",
  xl: "w-32 h-32",
  full: "w-full h-full",
};

const roundedClasses: Record<string, string> = {
  full: "rounded-full",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
};

const textSizes: Record<string, string> = {
  sm: "text-sm",
  md: "text-xl",
  lg: "text-3xl",
  xl: "text-4xl",
  full: "text-5xl",
};

const gradients = [
  "from-primary/40 to-accent/40",
  "from-primary/30 to-neon-cyan/30",
  "from-accent/30 to-primary/30",
];

function getInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const ProfilePhoto = ({
  photos,
  avatarUrl,
  name,
  size = "md",
  className,
  rounded = "full",
  loading = "lazy",
}: ProfilePhotoProps) => {
  const [stage, setStage] = useState<"primary" | "avatar" | "fallback">("primary");
  const [isLoaded, setIsLoaded] = useState(false);

  const sizePreset = size === "sm" || size === "md" ? avatarPreset : thumbPreset;
  const primaryUrl = sizePreset(photos?.[0]);
  const fallbackUrl = sizePreset(avatarUrl);

  const currentSrc =
    stage === "primary" && primaryUrl
      ? primaryUrl
      : stage === "avatar" && fallbackUrl
      ? fallbackUrl
      : null;

  // If no primary URL exists, jump to avatar or fallback
  const effectiveSrc =
    stage === "primary" && !primaryUrl
      ? fallbackUrl || null
      : currentSrc;

  const handleError = () => {
    if (stage === "primary" && fallbackUrl) {
      setStage("avatar");
      setIsLoaded(false);
    } else {
      setStage("fallback");
    }
  };

  const gradientIdx = (name?.charCodeAt(0) || 0) % gradients.length;

  const containerClass = cn(
    sizeClasses[size],
    roundedClasses[rounded],
    "overflow-hidden relative shrink-0",
    className
  );

  if (!effectiveSrc || stage === "fallback") {
    return (
      <div
        className={cn(
          containerClass,
          "bg-gradient-to-br flex items-center justify-center",
          gradients[gradientIdx]
        )}
      >
        <span className={cn("font-display font-bold text-foreground/60", textSizes[size])}>
          {getInitials(name)}
        </span>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {/* Shimmer placeholder */}
      {!isLoaded && (
        <div className="absolute inset-0 shimmer-effect" />
      )}
      <img
        src={effectiveSrc}
        alt={name || "Profile photo"}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0"
        )}
        loading={loading}
        onLoad={() => setIsLoaded(true)}
        onError={handleError}
      />
    </div>
  );
};

/**
 * Event cover image with gradient fallback
 */
interface EventCoverProps {
  src?: string | null;
  title?: string;
  className?: string;
  aspectRatio?: "video" | "square";
  /** Hint for CDN resizing: "hero" = 1200w, "card" = 600w, "thumb" = 300w */
  sizeHint?: "hero" | "card" | "thumb";
}

export const EventCover = ({
  src,
  title,
  className,
  aspectRatio = "video",
  sizeHint = "card",
}: EventCoverProps) => {
  const [error, setError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const cdnParams: Record<string, string> = {
    hero: "width=1200&quality=85",
    card: "width=600&height=338&quality=85",
    thumb: "width=300&quality=80",
  };
  const optimizedSrc = src ? appendCdnParams(src, cdnParams[sizeHint]) : null;

  const arClass = aspectRatio === "video" ? "aspect-video" : "aspect-square";

  if (!optimizedSrc || error) {
    return (
      <div
        className={cn(
          arClass,
          "bg-gradient-to-br from-primary/20 via-accent/10 to-secondary flex items-center justify-center",
          className
        )}
      >
        <span className="text-lg font-display font-semibold text-foreground/40 text-center px-4 line-clamp-2">
          {title || "Event"}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(arClass, "relative overflow-hidden", className)}>
      {!isLoaded && <div className="absolute inset-0 shimmer-effect" />}
      <img
        src={src}
        alt={title || "Event cover"}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0"
        )}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
};
