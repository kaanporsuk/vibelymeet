import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/utils/imageUrl";

type AdaptiveProfileMediaVariant = "hero" | "gallery" | "thumbnail" | "fullscreen";

type AdaptiveProfileMediaProps = {
  src: string;
  alt: string;
  variant: AdaptiveProfileMediaVariant;
  className?: string;
  onClick?: () => void;
};

const variantClasses: Record<AdaptiveProfileMediaVariant, string> = {
  hero: "h-[clamp(360px,62dvh,680px)] rounded-b-[28px]",
  gallery: "h-[clamp(260px,48dvh,520px)] rounded-2xl",
  thumbnail: "h-24 rounded-xl",
  fullscreen: "h-[90dvh] max-h-[90dvh] max-w-[96vw] rounded-2xl",
};

const imageOptions: Record<AdaptiveProfileMediaVariant, Parameters<typeof getImageUrl>[1]> = {
  hero: { width: 1400, quality: 88 },
  gallery: { width: 1200, quality: 88 },
  thumbnail: { width: 360, height: 360, quality: 82 },
  fullscreen: { width: 1600, quality: 90 },
};

export function AdaptiveProfileMedia({
  src,
  alt,
  variant,
  className,
  onClick,
}: AdaptiveProfileMediaProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useMemo(() => getImageUrl(src, imageOptions[variant]), [src, variant]);
  const isInteractive = typeof onClick === "function";
  const Wrapper = isInteractive ? "button" : "div";

  return (
    <Wrapper
      type={isInteractive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative block w-full max-w-full overflow-hidden border border-white/10 bg-secondary/70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        variantClasses[variant],
        isInteractive && "cursor-zoom-in",
        className,
      )}
      aria-label={isInteractive ? `Open ${alt}` : undefined}
    >
      {!failed ? (
        <>
          <img
            src={resolvedSrc}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
            onError={() => setFailed(true)}
          />
          <div className="absolute inset-0 bg-black/35" />
          {!loaded ? (
            <div className="absolute inset-0 animate-pulse bg-muted/40" aria-hidden />
          ) : null}
          <img
            src={resolvedSrc}
            alt={alt}
            className={cn(
              "relative z-10 h-full w-full object-contain transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <ImageOff className="h-8 w-8" aria-hidden />
          <span className="text-sm font-medium">Photo unavailable</span>
        </div>
      )}
    </Wrapper>
  );
}
