/**
 * Resolve profile/event image paths to full URLs.
 * Same logic as web src/utils/imageUrl.ts — Bunny CDN for photos/, Supabase storage for legacy paths.
 *
 * Required for native: set EXPO_PUBLIC_BUNNY_CDN_HOSTNAME in .env (same value as web VITE_BUNNY_CDN_HOSTNAME).
 * If unset, photos/ paths return a placeholder so we never build wrong Supabase URLs (Bunny assets
 * are not in Supabase storage).
 */
const BUNNY_CDN = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_CDN_HOSTNAME ?? '';
  const host = raw.replace(/^["']|["']$/g, '').trim();
  return host ? `https://${host}` : '';
})();
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

const PLACEHOLDER = 'https://placehold.co/200x200?text=Photo';

export function getImageUrl(
  path: string | null | undefined,
  opts?: { width?: number; height?: number; quality?: number }
): string {
  if (!path || path.trim() === '') {
    return PLACEHOLDER;
  }
  const p = path.trim();
  if (p.includes('supabase.co') || p.includes('supabase.in')) return p;
  if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) return p;
  if (p.startsWith('photos/')) {
    if (!BUNNY_CDN) {
      return PLACEHOLDER;
    }
    const params = new URLSearchParams();
    if (opts?.width) params.set('width', String(opts.width));
    if (opts?.height) params.set('height', String(opts.height));
    params.set('quality', String(opts?.quality ?? 85));
    return `${BUNNY_CDN}/${p}?${params.toString()}`;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${p}`;
}

export const avatarUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 200, height: 200 });

export const eventCoverUrl = (path: string | null | undefined) =>
  getImageUrl(path, { width: 600, quality: 85 });
