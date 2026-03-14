/**
 * Vibe video HLS playback URL (Bunny Stream CDN).
 * Same contract as web: https://${BUNNY_STREAM_CDN_HOSTNAME}/${bunnyVideoUid}/playlist.m3u8
 * Set EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME in .env (same as web VITE_BUNNY_STREAM_CDN_HOSTNAME).
 */
const BUNNY_STREAM_CDN = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME ?? '';
  return raw.replace(/^["']|["']$/g, '').trim();
})();

export function getVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  if (!bunnyVideoUid || !BUNNY_STREAM_CDN) return null;
  return `https://${BUNNY_STREAM_CDN}/${bunnyVideoUid}/playlist.m3u8`;
}
