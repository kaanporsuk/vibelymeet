import { getSignedVideoUrl } from "@/services/videoStorageService";

// Cache signed URLs for 25 minutes to avoid excessive Supabase calls.
// Signed URLs last 1 hour, so 25 min cache gives ample margin.
const urlCache = new Map<string, { url: string; cachedAt: number }>();
const CACHE_TTL = 25 * 60 * 1000; // 25 minutes
const MAX_CACHE_SIZE = 100;

function evictStaleEntries() {
  const now = Date.now();
  for (const [key, entry] of urlCache) {
    if (now - entry.cachedAt > CACHE_TTL) {
      urlCache.delete(key);
    }
  }
  // If still over limit after evicting stale, remove oldest entries
  if (urlCache.size > MAX_CACHE_SIZE) {
    const entries = [...urlCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const toRemove = entries.slice(0, urlCache.size - MAX_CACHE_SIZE);
    for (const [key] of toRemove) {
      urlCache.delete(key);
    }
  }
}

export async function resolveVibeVideoUrl(storedPath: string | null | undefined): Promise<string | null> {
  if (!storedPath) return null;

  // Check cache (keyed by raw stored value)
  const cached = urlCache.get(storedPath);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
    return cached.url;
  }

  // Evict stale entries periodically
  evictStaleEntries();

  // Resolve fresh signed URL
  const signedUrl = await getSignedVideoUrl(storedPath);
  if (signedUrl) {
    urlCache.set(storedPath, { url: signedUrl, cachedAt: Date.now() });
  }
  return signedUrl;
}
