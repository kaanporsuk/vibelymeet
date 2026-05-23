export type MediaPlaceholderKind = "dominant_color" | "blurhash";

export type MediaPlaceholderPayload = {
  kind: MediaPlaceholderKind;
  hash: string;
  dominantColor?: string | null;
};

const DOMINANT_COLOR_RE = /^#[0-9a-f]{6}$/i;
const BLURHASH_RE = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,120}$/;

export function normalizeDominantColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return DOMINANT_COLOR_RE.test(color) ? color.toLowerCase() : null;
}

export function normalizeBlurhash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hash = value.trim();
  return BLURHASH_RE.test(hash) ? hash : null;
}

export function normalizeMediaPlaceholderKind(value: unknown): MediaPlaceholderKind | null {
  return value === "dominant_color" || value === "blurhash" ? value : null;
}

export function normalizeMediaPlaceholderHash(
  kind: MediaPlaceholderKind | null,
  value: unknown,
): string | null {
  if (kind === "dominant_color") return normalizeDominantColor(value);
  if (kind === "blurhash") return normalizeBlurhash(value);
  return null;
}

export function normalizeMediaPlaceholderDominantColor(
  kind: MediaPlaceholderKind | null,
  hash: unknown,
  dominantColor: unknown,
): string | null {
  const normalizedDominantColor = normalizeDominantColor(dominantColor);
  if (normalizedDominantColor) return normalizedDominantColor;
  return kind === "dominant_color" ? normalizeMediaPlaceholderHash(kind, hash) : null;
}

export function normalizeMediaPlaceholderPayload(raw: unknown): MediaPlaceholderPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kind = normalizeMediaPlaceholderKind(record.kind);
  const hash = normalizeMediaPlaceholderHash(kind, record.hash);
  if (!kind || !hash) return null;
  const dominantColor = normalizeMediaPlaceholderDominantColor(
    kind,
    hash,
    record.dominantColor ?? record.dominant_color,
  );
  return {
    kind,
    hash,
    ...(dominantColor ? { dominantColor } : {}),
  };
}
