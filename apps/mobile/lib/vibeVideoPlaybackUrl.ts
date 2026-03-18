/**
 * Vibe video HLS playback URL (Bunny Stream CDN).
 * Same contract as web: https://${BUNNY_STREAM_CDN_HOSTNAME}/${bunnyVideoUid}/playlist.m3u8
 * Set EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME in .env (same as web VITE_BUNNY_STREAM_CDN_HOSTNAME).
 *
 * NOTE: Bunny Stream hotlink protection returns 403 for native requests (no Referer header).
 * Fix options: 1) Enable Bunny token authentication and generate signed URLs
 * 2) Whitelist empty referer in Bunny Stream CDN zone settings
 * 3) Disable hotlink protection for the stream CDN zone
 * For now, consumers should handle playback errors gracefully.
 */
const BUNNY_STREAM_CDN = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME ?? '';
  return raw.replace(/^["']|["']$/g, '').trim();
})();

export function getVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  if (!bunnyVideoUid || !BUNNY_STREAM_CDN) return null;
  return `https://${BUNNY_STREAM_CDN}/${bunnyVideoUid}/playlist.m3u8`;
}

/** Thumbnail image URL for 16:9 card (web parity). */
export function getVibeVideoThumbnailUrl(bunnyVideoUid: string | null | undefined): string | null {
  if (!bunnyVideoUid || !BUNNY_STREAM_CDN) return null;
  return `https://${BUNNY_STREAM_CDN}/${bunnyVideoUid}/thumbnail.jpg`;
}
