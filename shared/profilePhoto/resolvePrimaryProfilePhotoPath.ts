function sanitizePhotoCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let out = value.trim();
  if (!out) return null;

  // Tolerate DB values accidentally stored with wrapping quotes.
  while (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) ||
      (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }

  return out.length > 0 ? out : null;
}

function coercePhotosArray(photos: unknown): unknown[] {
  if (Array.isArray(photos)) return photos;
  if (typeof photos === "string") {
    const trimmed = photos.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Ignore malformed JSON and fall through.
      }
    }
  }
  return [];
}

export function resolvePrimaryProfilePhotoPath(input: {
  photos?: unknown;
  avatar_url?: unknown;
}): string | null {
  const photos = coercePhotosArray(input.photos);
  for (const candidate of photos) {
    const sanitized = sanitizePhotoCandidate(candidate);
    if (sanitized) return sanitized;
  }

  return sanitizePhotoCandidate(input.avatar_url);
}
