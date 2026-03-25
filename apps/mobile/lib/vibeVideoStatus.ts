/**
 * Single source of truth for Bunny vibe video status → UI surface mapping (native).
 * Backend may send null, legacy strings, or inconsistent uid/status pairs — normalize defensively.
 */

export type BunnyVideoStatusNormalized = 'none' | 'uploading' | 'processing' | 'ready' | 'failed' | 'unknown';

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

export type VibeVideoSurface =
  | { kind: 'empty' }
  | { kind: 'processing'; uid: string }
  | { kind: 'ready'; uid: string }
  | { kind: 'failed'; uid: string }
  | { kind: 'inconsistent_ready_no_uid' }
  | { kind: 'inconsistent_unknown_status'; uid: string };

/**
 * Map profile row fields to a single UI surface. Handles pathological DB states.
 */
export function getVibeVideoSurface(
  bunnyVideoUid: string | null | undefined,
  rawStatus: string | null | undefined,
): VibeVideoSurface {
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  const status = normalizeBunnyVideoStatus(rawStatus);

  if (!uid) {
    if (status === 'ready' || status === 'processing' || status === 'uploading' || status === 'failed') {
      return { kind: 'inconsistent_ready_no_uid' };
    }
    return { kind: 'empty' };
  }

  if (status === 'unknown') {
    return { kind: 'inconsistent_unknown_status', uid };
  }

  if (status === 'ready') return { kind: 'ready', uid };
  if (status === 'failed') return { kind: 'failed', uid };
  if (status === 'processing' || status === 'uploading') return { kind: 'processing', uid };

  // `none` but uid still set — often webhook lag or partial writes; treat as still in pipeline.
  if (status === 'none') {
    return { kind: 'processing', uid };
  }

  return { kind: 'empty' };
}

export function isVibeVideoReadySurface(surface: VibeVideoSurface): surface is { kind: 'ready'; uid: string } {
  return surface.kind === 'ready';
}
