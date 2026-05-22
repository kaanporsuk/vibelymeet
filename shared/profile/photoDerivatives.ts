export type ProfilePhotoDerivativeEntry = {
  thumb?: string;
  hero?: string;
  placeholderKind?: "dominant_color";
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

function cleanDominantColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : undefined;
}

export function normalizeProfilePhotoDerivatives(raw: unknown): ProfilePhotoDerivativeMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: ProfilePhotoDerivativeMap = {};
  for (const [rawOriginalPath, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const originalPath = cleanPath(rawOriginalPath);
    if (!originalPath || !rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;

    const value = rawValue as Record<string, unknown>;
    const thumb = cleanPath(value.thumb);
    const hero = cleanPath(value.hero);
    const dominantColor = cleanDominantColor(value.dominantColor);
    const placeholderKind = value.placeholderKind === "dominant_color" ? "dominant_color" : undefined;
    const placeholderHash = cleanDominantColor(value.placeholderHash);

    if (!thumb && !hero && !dominantColor) continue;
    out[originalPath] = {
      ...(thumb ? { thumb } : {}),
      ...(hero ? { hero } : {}),
      ...(placeholderKind ? { placeholderKind } : {}),
      ...(placeholderHash ? { placeholderHash } : {}),
      ...(dominantColor ? { dominantColor } : {}),
    };
  }
  return out;
}
