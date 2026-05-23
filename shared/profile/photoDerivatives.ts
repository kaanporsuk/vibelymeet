import {
  normalizeMediaPlaceholderDominantColor,
  normalizeMediaPlaceholderHash,
  normalizeMediaPlaceholderKind,
  type MediaPlaceholderKind,
} from "../media/placeholders";

export type ProfilePhotoDerivativeEntry = {
  thumb?: string;
  display?: string;
  hero?: string;
  placeholderKind?: MediaPlaceholderKind;
  placeholderHash?: string;
  dominantColor?: string;
};

export type ProfilePhotoDerivativeMap = Record<string, ProfilePhotoDerivativeEntry>;

function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("://")) return null;
  return path;
}

export function normalizeProfilePhotoDerivatives(raw: unknown): ProfilePhotoDerivativeMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: ProfilePhotoDerivativeMap = {};
  for (const [rawOriginalPath, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const originalPath = cleanPath(rawOriginalPath);
    if (!originalPath || !rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;

    const value = rawValue as Record<string, unknown>;
    const thumb = cleanPath(value.thumb);
    const display = cleanPath(value.display);
    const hero = cleanPath(value.hero);
    const placeholderKind = normalizeMediaPlaceholderKind(value.placeholderKind) ?? undefined;
    const placeholderHash = normalizeMediaPlaceholderHash(placeholderKind ?? null, value.placeholderHash) ?? undefined;
    const effectivePlaceholderKind = placeholderHash ? placeholderKind : undefined;
    const dominantColor = normalizeMediaPlaceholderDominantColor(
      placeholderKind ?? null,
      placeholderHash,
      value.dominantColor,
    ) ?? undefined;

    if (!thumb && !display && !hero && !dominantColor && !placeholderHash) continue;
    out[originalPath] = {
      ...(thumb ? { thumb } : {}),
      ...(display ? { display } : {}),
      ...(hero ? { hero } : {}),
      ...(effectivePlaceholderKind ? { placeholderKind: effectivePlaceholderKind } : {}),
      ...(placeholderHash ? { placeholderHash } : {}),
      ...(dominantColor ? { dominantColor } : {}),
    };
  }
  return out;
}
