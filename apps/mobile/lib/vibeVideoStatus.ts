/**
 * Bunny `bunny_video_status` normalization for native — matches web
 * `normalizeBunnyVideoStatus` in `src/lib/vibeVideo/webVibeVideoState.ts`.
 */

export type BunnyVideoStatusNormalized =
  | 'none'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'unknown';

const ALLOWED: ReadonlySet<string> = new Set([
  'none',
  'uploading',
  'processing',
  'ready',
  'failed',
]);

export function normalizeBunnyVideoStatus(raw: string | null | undefined): BunnyVideoStatusNormalized {
  const s = String(raw ?? 'none')
    .toLowerCase()
    .trim();
  if (!s || s === 'null' || s === 'undefined') return 'none';
  // Bunny Stream numeric status codes (defensive — webhook usually maps to strings before DB).
  if (s === '1' || s === '2') return 'processing';
  if (s === '3' || s === '4') return 'ready';
  if (s === '5') return 'failed';
  if (ALLOWED.has(s)) return s as BunnyVideoStatusNormalized;
  return 'unknown';
}
