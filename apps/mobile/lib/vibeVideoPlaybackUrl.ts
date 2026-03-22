/**
 * Bunny Stream playback URLs — must match web `ProfileStudio` / `VibeStudioModal`:
 *   `https://${VITE_BUNNY_STREAM_CDN_HOSTNAME}/${bunnyVideoUid}/playlist.m3u8`
 *   thumbnail: `.../${uid}/thumbnail.jpg`
 *
 * Mobile uses `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` with the **same hostname string** as web
 * (e.g. `vz-xxxxx.b-cdn.net`). No path prefix. No Supabase signed URLs for stream delivery.
 *
 * If playback fails with HTTP 403 on device but works in Safari:
 * - Bunny Stream / CDN zone may enforce **hotlink / referrer** rules that block requests
 *   without a browser Referer. Fix in Bunny dashboard (allow app User-Agents / disable
 *   hotlink blocking for the stream zone) or use **token authentication** with signed URLs.
 * - This is infrastructure; native builds the same URL shape as web.
 */
const BUNNY_STREAM_CDN = (() => {
  const raw = process.env.EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME ?? '';
  return raw.replace(/^["']|["']$/g, '').trim();
})();

export function getVibeVideoPlaybackUrl(bunnyVideoUid: string | null | undefined): string | null {
  if (!bunnyVideoUid || !BUNNY_STREAM_CDN) return null;
  return `https://${BUNNY_STREAM_CDN}/${bunnyVideoUid}/playlist.m3u8`;
}

export function getVibeVideoThumbnailUrl(bunnyVideoUid: string | null | undefined): string | null {
  if (!bunnyVideoUid || !BUNNY_STREAM_CDN) return null;
  return `https://${BUNNY_STREAM_CDN}/${bunnyVideoUid}/thumbnail.jpg`;
}
