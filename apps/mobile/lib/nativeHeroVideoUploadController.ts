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
 *   stalled    — backend did not reach ready/failed inside the bounded poll window
 *   failed     — tus error OR backend reported failure; retry available
 *
 * A monotonic generation counter invalidates in-flight async work after reset or a newer
 * nativeHeroVideoStart(), so late TUS/poll callbacks cannot resurrect stale phases.
 */

import {
  getCreateVideoUploadCredentials,
  uploadVibeVideoToBunny,
  type VibeVideoUploadSource,
} from '@/lib/vibeVideoApi';
import { pollVibeVideoUntilTerminal } from '@/lib/vibeVideoPoll';
import { updateMyProfile } from '@/lib/profileApi';
import { normalizeBunnyVideoStatus } from '@/lib/vibeVideoStatus';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';
import {
  captureVibeVideoException,
  trackVibeVideoEvent,
  VIBE_VIDEO_EVENTS,
} from '@/lib/vibeVideoTelemetry';

// ─── Public types ─────────────────────────────────────────────────────────────

export type NativeHeroVideoPhase = 'idle' | 'uploading' | 'processing' | 'ready' | 'stalled' | 'failed';

export interface NativeHeroVideoControllerState {
  phase: NativeHeroVideoPhase;
  /** 0–100 during uploading; 100 after tus success */
  uploadProgress: number;
  /** Set once credentials are returned */
  videoId: string | null;
  errorMessage: string | null;
}

type Subscriber = (state: NativeHeroVideoControllerState) => void;
type NativeVibeVideoProfileSnapshot = {
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
};
type PollStartSource = 'upload_complete' | 'app_state_active' | 'manual_retry' | 'manual_refresh';

const PROCESSING_POLL_INTERVAL_MS = 5000;
const PROCESSING_POLL_MAX_ATTEMPTS = 36;

// ─── Module-level state ───────────────────────────────────────────────────────

let _state: NativeHeroVideoControllerState = {
  phase: 'idle',
  uploadProgress: 0,
  videoId: null,
  errorMessage: null,
};

/** Bumped on every nativeHeroVideoStart and nativeHeroVideoReset to fence stale async work. */
let _generation = 0;
let _activeRunStartedAt = 0;
let _pollGeneration = 0;

const _subscribers = new Set<Subscriber>();
let _pollAbort: AbortController | null = null;
let _uploadAbort: AbortController | null = null;
let _activePoll:
  | {
      id: number;
      videoId: string;
      source: PollStartSource;
    }
  | null = null;

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

function inferNativeUploadSource(videoUri: string): VibeVideoUploadSource {
  const scheme = videoUri.trim().split(':')[0]?.toLowerCase();
  if (scheme === 'ph' || scheme === 'assets-library') return 'library';
  return 'unknown';
}

function profileVideoPhase(
  profile: NativeVibeVideoProfileSnapshot | null | undefined,
):
  | { kind: 'none' }
  | { kind: 'ready'; videoId: string }
  | { kind: 'failed'; videoId: string }
  | { kind: 'non_terminal'; videoId: string; phase: 'uploading' | 'processing' } {
  const videoId = typeof profile?.bunny_video_uid === 'string' ? profile.bunny_video_uid.trim() : '';
  if (!videoId) return { kind: 'none' };

  const status = normalizeBunnyVideoStatus(profile?.bunny_video_status);
  if (status === 'ready') return { kind: 'ready', videoId };
  if (status === 'failed') return { kind: 'failed', videoId };
  return {
    kind: 'non_terminal',
    videoId,
    phase: 'processing',
  };
}

function _isActivePoll(pollId: number, ownerRunId?: number): boolean {
  return _activePoll?.id === pollId && (ownerRunId == null || _isCurrent(ownerRunId));
}

function _abortPoll(): void {
  _pollAbort?.abort();
  _pollAbort = null;
  _activePoll = null;
  _pollGeneration++;
}

function _shouldPreserveActiveUpload(profileVideoId: string | null): boolean {
  const hasActiveUploadRun =
    _state.phase === 'uploading' ||
    (_state.phase === 'processing' && _activePoll?.source === 'upload_complete');
  if (!hasActiveUploadRun) return false;

  const currentVideoId = _state.videoId?.trim() || null;
  return !profileVideoId || currentVideoId !== profileVideoId;
}

function _beginStatusPoll(options: {
  videoId: string;
  source: PollStartSource;
  uploadContext?: 'onboarding' | 'profile_studio';
  uploadSource?: VibeVideoUploadSource;
  ownerRunId?: number;
  phase?: 'uploading' | 'processing';
}): { started: boolean; promise: Promise<void> | null } {
  const {
    videoId,
    source,
    uploadContext = 'profile_studio',
    uploadSource = 'unknown',
    ownerRunId,
    phase = 'processing',
  } = options;

  if (_activePoll?.videoId === videoId && _pollAbort && !_pollAbort.signal.aborted) {
    vibeVideoDiagVerbose('poll.resume_skip_duplicate', { videoId, source, activeSource: _activePoll.source });
    return { started: false, promise: null };
  }

  _abortPoll();
  _pollAbort = new AbortController();
  const pollId = ++_pollGeneration;
  _activePoll = { id: pollId, videoId, source };

  _setState({
    phase,
    uploadProgress: phase === 'processing' ? 100 : _state.uploadProgress,
    videoId,
    errorMessage: null,
  });
  _invalidateProfile();

  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingPollStarted, {
    source: source === 'upload_complete' ? 'native_hero_video_controller' : 'native_hero_video_resume',
    upload_context: uploadContext,
    upload_source: uploadSource,
    video_guid: videoId,
    interval_ms: PROCESSING_POLL_INTERVAL_MS,
    max_attempts: PROCESSING_POLL_MAX_ATTEMPTS,
    resume_source: source,
  });

  const signal = _pollAbort.signal;
  const promise = (async () => {
    const result = await pollVibeVideoUntilTerminal({
      expectedVideoId: videoId,
      maxAttempts: PROCESSING_POLL_MAX_ATTEMPTS,
      intervalMs: PROCESSING_POLL_INTERVAL_MS,
      signal,
      onStatus: (status, attempt) => {
        if (!_isActivePoll(pollId, ownerRunId)) return;
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingStatusChanged, {
          source: source === 'upload_complete' ? 'native_hero_video_controller' : 'native_hero_video_resume',
          upload_context: uploadContext,
          upload_source: uploadSource,
          video_guid: videoId,
          status,
          attempt,
          resume_source: source,
        });
      },
    });

    if (!_isActivePoll(pollId, ownerRunId)) return;

    if (result === 'ready') {
      _setState({ phase: 'ready', uploadProgress: 100, videoId, errorMessage: null });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.readyObserved, {
        source: source === 'upload_complete' ? 'native_hero_video_controller' : 'native_hero_video_resume',
        upload_context: uploadContext,
        upload_source: uploadSource,
        video_guid: videoId,
        duration_ms: source === 'upload_complete' && _activeRunStartedAt ? Date.now() - _activeRunStartedAt : null,
        resume_source: source,
      });
    } else if (result === 'failed') {
      _setState({
        phase: 'failed',
        uploadProgress: 100,
        videoId,
        errorMessage: 'Processing did not complete. Try uploading again.',
      });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.failedObserved, {
        source: source === 'upload_complete' ? 'native_hero_video_controller' : 'native_hero_video_resume',
        upload_context: uploadContext,
        upload_source: uploadSource,
        video_guid: videoId,
        resume_source: source,
      });
    } else if (result === 'superseded') {
      _setState({ phase: 'idle', uploadProgress: 0, videoId: null, errorMessage: null });
    } else if (result !== 'aborted') {
      _setState({
        phase: 'stalled',
        uploadProgress: 100,
        videoId,
        errorMessage: 'Your video is taking longer than expected. It is still saved; retry to check again or replace it.',
      });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.uploadStalled, {
        source: source === 'upload_complete' ? 'native_hero_video_controller' : 'native_hero_video_resume',
        upload_context: uploadContext,
        upload_source: uploadSource,
        video_guid: videoId,
        attempts: PROCESSING_POLL_MAX_ATTEMPTS,
        resume_source: source,
      });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingStalled, {
        source: source === 'upload_complete' ? 'native_hero_video_controller' : 'native_hero_video_resume',
        upload_context: uploadContext,
        upload_source: uploadSource,
        video_guid: videoId,
        attempts: PROCESSING_POLL_MAX_ATTEMPTS,
        resume_source: source,
      });
    }

    _invalidateProfile();
  })()
    .catch((err) => {
      if (!_isActivePoll(pollId, ownerRunId)) return;
      const isAbort =
        err !== null &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name?: string }).name === 'AbortError';
      if (isAbort) return;

      _setState({
        phase: 'failed',
        videoId,
        errorMessage: err instanceof Error ? err.message : 'Processing poll failed. Try again.',
      });
      captureVibeVideoException(err, {
        source: 'native_hero_video_controller',
        phase: 'processing_poll',
        upload_source: uploadSource,
      });
      _invalidateProfile();
    })
    .finally(() => {
      if (_activePoll?.id === pollId) {
        _activePoll = null;
        _pollAbort = null;
      }
    });

  return { started: true, promise };
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

export function nativeHeroVideoResumePollingForProfile(
  profile: NativeVibeVideoProfileSnapshot | null | undefined,
  options: {
    source?: PollStartSource;
  } = {},
): boolean {
  const profilePhase = profileVideoPhase(profile);
  const source = options.source ?? 'manual_refresh';
  const profileVideoId = profilePhase.kind === 'none' ? null : profilePhase.videoId;

  if (_shouldPreserveActiveUpload(profileVideoId)) {
    vibeVideoDiagVerbose('poll.resume_preserve_active_upload', {
      source,
      controllerPhase: _state.phase,
      controllerVideoId: _state.videoId,
      profileVideoId,
    });
    return false;
  }

  if (profilePhase.kind === 'none') {
    if (_state.phase === 'stalled' || _state.phase === 'processing' || _state.phase === 'uploading') {
      _abortPoll();
      _setState({ phase: 'idle', uploadProgress: 0, videoId: null, errorMessage: null });
    }
    return false;
  }

  if (profilePhase.kind === 'ready') {
    _abortPoll();
    _setState({ phase: 'ready', uploadProgress: 100, videoId: profilePhase.videoId, errorMessage: null });
    _invalidateProfile();
    return false;
  }

  if (profilePhase.kind === 'failed') {
    _abortPoll();
    _setState({
      phase: 'failed',
      uploadProgress: 100,
      videoId: profilePhase.videoId,
      errorMessage: 'Processing did not complete. Try uploading again.',
    });
    _invalidateProfile();
    return false;
  }

  return _beginStatusPoll({
    videoId: profilePhase.videoId,
    source,
    phase: profilePhase.phase,
  }).started;
}

/**
 * Start a hero video upload. Aborts any in-flight upload first.
 * Resolves immediately — upload runs in the background.
 *
 * @param videoUri  - local file:// or ph:// URI
 * @param caption   - optional vibe caption saved after tus completes
 * @param context   - 'onboarding' | 'profile_studio'
 * @param uploadSource - camera/library/drawer source for telemetry and upload preparation diagnostics
 */
export function nativeHeroVideoStart(
  videoUri: string,
  caption?: string,
  context?: 'onboarding' | 'profile_studio',
  uploadSource?: VibeVideoUploadSource,
): void {
  const uploadContext = context ?? 'profile_studio';
  const resolvedUploadSource = uploadSource ?? inferNativeUploadSource(videoUri);
  const replacingInFlight = _state.phase !== 'idle' || !!_state.videoId;

  // Cancel existing upload/poll if any
  _uploadAbort?.abort();
  _abortPoll();
  _uploadAbort = new AbortController();

  _generation++;
  const runId = _generation;

  if (replacingInFlight) {
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.replaceStarted, {
      source: 'native_hero_video_controller',
      upload_context: uploadContext,
      upload_source: resolvedUploadSource,
      reason: 'in_flight_upload_replaced',
    });
  }

  _activeRunStartedAt = Date.now();
  _setState({ phase: 'uploading', uploadProgress: 0, videoId: null, errorMessage: null });

  void _run(videoUri, caption, uploadContext, resolvedUploadSource, _uploadAbort, runId);
}

async function _run(
  videoUri: string,
  caption: string | undefined,
  context: 'onboarding' | 'profile_studio',
  uploadSource: VibeVideoUploadSource,
  uploadAc: AbortController,
  runId: number,
): Promise<void> {
  let failurePhase: 'credentials' | 'tus' | 'processing' = 'credentials';
  let activeVideoId: string | null = null;
  try {
    // ── Get tus credentials ───────────────────────────────────────────────────
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestStarted, {
      source: 'native_hero_video_controller',
      upload_context: context,
      upload_source: uploadSource,
    });
    const creds = await getCreateVideoUploadCredentials({ context });
    if (!_isCurrent(runId)) return;
    activeVideoId = creds.videoId;

    _setStateIfCurrent(runId, { videoId: creds.videoId });
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestSucceeded, {
      source: 'native_hero_video_controller',
      upload_context: context,
      upload_source: uploadSource,
      video_guid: creds.videoId,
      has_library_id: true,
    });
    if (!_isCurrent(runId)) return;
    failurePhase = 'tus';

    // ── TUS upload to Bunny ───────────────────────────────────────────────────
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tusUploadStarted, {
      source: 'native_hero_video_controller',
      upload_context: context,
      upload_source: uploadSource,
      video_guid: creds.videoId,
    });
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
      { signal: uploadAc.signal, uploadSource },
    );

    if (!_isCurrent(runId)) return;
    failurePhase = 'processing';
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tusUploadSucceeded, {
      source: 'native_hero_video_controller',
      upload_context: context,
      upload_source: uploadSource,
      video_guid: creds.videoId,
      duration_ms: _activeRunStartedAt ? Date.now() - _activeRunStartedAt : null,
    });

    // ── Caption save (best-effort after tus) ─────────────────────────────────
    if (caption !== undefined && caption !== null) {
      const trimmed = caption.trim() || null;
      try {
        await updateMyProfile({ vibe_caption: trimmed });
      } catch (error) {
        console.warn('[NativeHeroVideo] Caption save failed after upload; video upload continues.');
        captureVibeVideoException(error, {
          source: 'native_hero_video_controller',
          phase: 'caption_save',
          upload_source: uploadSource,
        });
      }
    }

    if (!_isCurrent(runId)) return;

    // ── Move to processing, start backend poll ────────────────────────────────
    _setStateIfCurrent(runId, { phase: 'processing', uploadProgress: 100 });
    if (!_isCurrent(runId)) return;

    _invalidateProfileIfCurrent(runId);
    if (!_isCurrent(runId)) return;

    const { promise } = _beginStatusPoll({
      videoId: creds.videoId,
      source: 'upload_complete',
      uploadContext: context,
      uploadSource,
      ownerRunId: runId,
      phase: 'processing',
    });
    await promise;
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
    if (failurePhase === 'credentials') {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestFailed, {
        source: 'native_hero_video_controller',
        upload_context: context,
        upload_source: uploadSource,
        error_code: 'credentials_exception',
      });
    } else if (failurePhase === 'tus') {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tusUploadFailed, {
        source: 'native_hero_video_controller',
        upload_context: context,
        upload_source: uploadSource,
        video_guid: activeVideoId,
        error_code: 'upload_exception',
      });
    } else {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.failedObserved, {
        source: 'native_hero_video_controller',
        upload_context: context,
        upload_source: uploadSource,
        video_guid: activeVideoId,
        error_code: 'processing_poll_exception',
      });
    }
    captureVibeVideoException(err, {
      source: 'native_hero_video_controller',
      phase: 'upload_run',
      upload_source: uploadSource,
    });
    _invalidateProfileIfCurrent(runId);
  }
}

/**
 * Reset controller to idle without starting a new upload.
 * Aborts any in-flight tus and stops polling.
 */
export function nativeHeroVideoReset(): void {
  _uploadAbort?.abort();
  _abortPoll();
  _uploadAbort = null;
  _generation++;
  _setState({ phase: 'idle', uploadProgress: 0, videoId: null, errorMessage: null });
}
