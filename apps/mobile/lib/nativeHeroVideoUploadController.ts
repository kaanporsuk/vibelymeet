/**
 * Native Hero Vibe Video upload controller — module-level singleton.
 *
 * Mirrors the web heroVideoUploadController contract exactly:
 *   credentials fetch → tus bytes to Bunny → profile status poll → terminal state
 *
 * Survives screen unmounts so upload continues after the recorder closes.
 * React components subscribe via nativeHeroVideoSubscribe() / useNativeHeroVideoUpload().
 *
 * Phase model (post-confirm only; local_preview stays inside the recorder):
 *   idle       — no active session; profile is source of truth for display
 *   uploading  — tus in flight (progress 0–100)
 *   processing — tus complete; polling backend for transcoding result
 *   ready      — backend confirmed ready; query cache invalidated
 *   failed     — tus error OR backend reported failure; retry available
 *
 * A monotonic generation counter invalidates in-flight async work after reset or a newer
 * nativeHeroVideoStart(), so late TUS/poll callbacks cannot resurrect stale phases.
 */

import { getCreateVideoUploadCredentials, uploadVibeVideoToBunny } from '@/lib/vibeVideoApi';
import { pollVibeVideoUntilTerminal } from '@/lib/vibeVideoPoll';
import { updateMyProfile } from '@/lib/profileApi';

// ─── Public types ─────────────────────────────────────────────────────────────

export type NativeHeroVideoPhase = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface NativeHeroVideoControllerState {
  phase: NativeHeroVideoPhase;
  /** 0–100 during uploading; 100 after tus success */
  uploadProgress: number;
  /** Set once credentials are returned */
  videoId: string | null;
  errorMessage: string | null;
}

type Subscriber = (state: NativeHeroVideoControllerState) => void;

// ─── Module-level state ───────────────────────────────────────────────────────

let _state: NativeHeroVideoControllerState = {
  phase: 'idle',
  uploadProgress: 0,
  videoId: null,
  errorMessage: null,
};

/** Bumped on every nativeHeroVideoStart and nativeHeroVideoReset to fence stale async work. */
let _generation = 0;

const _subscribers = new Set<Subscriber>();
let _pollAbort: AbortController | null = null;
let _uploadAbort: AbortController | null = null;

// ─── Query client reference (injected at startup) ─────────────────────────────

type QueryClientLike = { invalidateQueries: (opts: { queryKey: string[] }) => unknown };
let _queryClient: QueryClientLike | null = null;

/** Call once at app startup (e.g. in _layout.tsx) to wire up query invalidation. */
export function nativeHeroVideoSetQueryClient(qc: QueryClientLike): void {
  _queryClient = qc;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _isCurrent(runId: number): boolean {
  return runId === _generation;
}

function _setState(patch: Partial<NativeHeroVideoControllerState>): void {
  _state = { ..._state, ...patch };
  _subscribers.forEach((cb) => cb(_state));
}

function _setStateIfCurrent(runId: number, patch: Partial<NativeHeroVideoControllerState>): void {
  if (!_isCurrent(runId)) return;
  _setState(patch);
}

function _invalidateProfile(): void {
  void _queryClient?.invalidateQueries({ queryKey: ['my-profile'] });
}

function _invalidateProfileIfCurrent(runId: number): void {
  if (!_isCurrent(runId)) return;
  _invalidateProfile();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Subscribe to state changes. Returns an unsubscribe function. */
export function nativeHeroVideoSubscribe(cb: Subscriber): () => void {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

/** Read the current controller state snapshot (no subscription). */
export function nativeHeroVideoGetState(): NativeHeroVideoControllerState {
  return _state;
}

/**
 * Start a hero video upload. Aborts any in-flight upload first.
 * Resolves immediately — upload runs in the background.
 *
 * @param videoUri  - local file:// or ph:// URI
 * @param caption   - optional vibe caption saved after tus completes
 * @param context   - 'onboarding' | 'profile_studio'
 */
export function nativeHeroVideoStart(
  videoUri: string,
  caption?: string,
  context?: 'onboarding' | 'profile_studio',
): void {
  // Cancel existing upload/poll if any
  _uploadAbort?.abort();
  _pollAbort?.abort();
  _uploadAbort = new AbortController();
  _pollAbort = new AbortController();

  _generation++;
  const runId = _generation;

  _setState({ phase: 'uploading', uploadProgress: 0, videoId: null, errorMessage: null });

  void _run(videoUri, caption, context ?? 'profile_studio', _uploadAbort, _pollAbort, runId);
}

async function _run(
  videoUri: string,
  caption: string | undefined,
  context: 'onboarding' | 'profile_studio',
  uploadAc: AbortController,
  pollAc: AbortController,
  runId: number,
): Promise<void> {
  try {
    // ── Get tus credentials ───────────────────────────────────────────────────
    const creds = await getCreateVideoUploadCredentials({ context });
    if (!_isCurrent(runId)) return;

    _setStateIfCurrent(runId, { videoId: creds.videoId });
    if (!_isCurrent(runId)) return;

    // ── TUS upload to Bunny ───────────────────────────────────────────────────
    await uploadVibeVideoToBunny(
      videoUri,
      creds,
      (bytesUploaded, bytesTotal) => {
        if (uploadAc.signal.aborted) return;
        if (!_isCurrent(runId)) return;
        if (bytesTotal > 0) {
          _setStateIfCurrent(runId, { uploadProgress: Math.round((bytesUploaded / bytesTotal) * 100) });
        }
      },
      { signal: uploadAc.signal, uploadSource: 'unknown' },
    );

    if (!_isCurrent(runId)) return;

    // ── Caption save (best-effort after tus) ─────────────────────────────────
    if (caption !== undefined && caption !== null) {
      const trimmed = caption.trim() || null;
      try {
        await updateMyProfile({ vibe_caption: trimmed });
      } catch {
        console.warn('[NativeHeroVideo] Caption save failed after upload; video upload continues.');
      }
    }

    if (!_isCurrent(runId)) return;

    // ── Move to processing, start backend poll ────────────────────────────────
    _setStateIfCurrent(runId, { phase: 'processing', uploadProgress: 100 });
    if (!_isCurrent(runId)) return;

    _invalidateProfileIfCurrent(runId);
    if (!_isCurrent(runId)) return;

    const result = await pollVibeVideoUntilTerminal({
      expectedVideoId: creds.videoId,
      maxAttempts: 36,
      intervalMs: 5000,
      signal: pollAc.signal,
    });

    if (!_isCurrent(runId)) return;

    if (result === 'ready') {
      _setStateIfCurrent(runId, { phase: 'ready', errorMessage: null });
    } else if (result === 'failed') {
      _setStateIfCurrent(runId, {
        phase: 'failed',
        errorMessage: 'Processing did not complete. Try uploading again.',
      });
    } else if (result === 'aborted') {
      // Signal was aborted — a new upload started or reset; do nothing
      return;
    } else {
      // timeout or superseded — go idle and let profile be authoritative
      _setStateIfCurrent(runId, { phase: 'idle', videoId: null, errorMessage: null });
    }

    _invalidateProfileIfCurrent(runId);
  } catch (err) {
    const isAbort =
      err !== null &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: string }).name === 'AbortError';
    if (isAbort) return;

    if (!_isCurrent(runId)) return;

    const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
    _setStateIfCurrent(runId, { phase: 'failed', errorMessage: msg });
    _invalidateProfileIfCurrent(runId);
  }
}

/**
 * Reset controller to idle without starting a new upload.
 * Aborts any in-flight tus and stops polling.
 */
export function nativeHeroVideoReset(): void {
  _uploadAbort?.abort();
  _pollAbort?.abort();
  _uploadAbort = null;
  _pollAbort = null;
  _generation++;
  _setState({ phase: 'idle', uploadProgress: 0, videoId: null, errorMessage: null });
}
