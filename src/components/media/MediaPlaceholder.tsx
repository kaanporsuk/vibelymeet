import { useEffect, useMemo, useState } from "react";
import { decode } from "blurhash";
import { cn } from "@/lib/utils";
import {
  normalizeMediaPlaceholderDominantColor,
  normalizeMediaPlaceholderHash,
  normalizeMediaPlaceholderKind,
  type MediaPlaceholderKind,
} from "@clientShared/media/placeholders";

type MediaPlaceholderProps = {
  kind?: MediaPlaceholderKind | null;
  hash?: string | null;
  dominantColor?: string | null;
  className?: string;
};

const BLURHASH_SIZE = 32;
const BLURHASH_CACHE_LIMIT = 200;
const blurhashDataUrlCache = new Map<string, string>();

function blurhashToDataUrl(hash: string): string | null {
  const cached = blurhashDataUrlCache.get(hash);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  try {
    const pixels = decode(hash, BLURHASH_SIZE, BLURHASH_SIZE);
    const canvas = document.createElement("canvas");
    canvas.width = BLURHASH_SIZE;
    canvas.height = BLURHASH_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.createImageData(BLURHASH_SIZE, BLURHASH_SIZE);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    if (blurhashDataUrlCache.size >= BLURHASH_CACHE_LIMIT) {
      const oldest = blurhashDataUrlCache.keys().next().value;
      if (oldest) blurhashDataUrlCache.delete(oldest);
    }
    blurhashDataUrlCache.set(hash, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export function MediaPlaceholder({
  kind,
  hash,
  dominantColor,
  className,
}: MediaPlaceholderProps) {
  const normalizedKind = normalizeMediaPlaceholderKind(kind);
  const normalizedHash = normalizeMediaPlaceholderHash(normalizedKind, hash);
  const normalizedColor = normalizeMediaPlaceholderDominantColor(
    normalizedKind,
    normalizedHash,
    dominantColor,
  ) ?? "hsl(var(--muted))";
  const [blurData, setBlurData] = useState<{ hash: string; url: string } | null>(() => {
    const cached = normalizedKind === "blurhash" && normalizedHash ? blurhashDataUrlCache.get(normalizedHash) : null;
    return cached && normalizedHash ? { hash: normalizedHash, url: cached } : null;
  });

  useEffect(() => {
    if (normalizedKind !== "blurhash" || !normalizedHash) {
      setBlurData(null);
      return;
    }
    const next = blurhashToDataUrl(normalizedHash);
    setBlurData(next ? { hash: normalizedHash, url: next } : null);
  }, [normalizedHash, normalizedKind]);

  const style = useMemo(
    () => ({ backgroundColor: normalizedColor }),
    [normalizedColor],
  );
  const blurDataUrl = normalizedKind === "blurhash" && normalizedHash
    ? blurhashDataUrlCache.get(normalizedHash) ?? (blurData?.hash === normalizedHash ? blurData.url : null)
    : null;

  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={style}>
      {blurDataUrl ? (
        <img
          alt=""
          src={blurDataUrl}
          className="h-full w-full scale-110 object-cover blur-xl"
          draggable={false}
        />
      ) : null}
    </div>
  );
}
