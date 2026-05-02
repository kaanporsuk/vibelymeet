/**
 * Hero Vibe Video upload controller — module-level singleton.
 *
 * Owns the full post-confirm lifecycle:
 *   credentials fetch → tus bytes to Bunny → profile status poll → terminal state
 *
 * Survives component unmounts, so upload continues after the recorder modal closes.
 * React components subscribe via heroVideoSubscribe() / useHeroVideoUpload().
 *
 * Phase model (post-confirm only; local_preview stays inside the recorder):
 *   idle       — no active session; profile is source of truth for display
 *   uploading  — tus in flight (progress 0–100)
 *   processing — tus complete; polling backend for transcoding result
 *   ready      — backend confirmed ready; profile cache invalidated
 *   stalled    — backend did not reach ready/failed inside the bounded poll window
 *   failed     — tus error OR backend reported failure; retry available
 */

import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { normalizeBunnyVideoStatus, resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { queryClient } from "@/lib/queryClient";
import { updateMyProfile } from "@/services/profileService";
import {
  captureVibeVideoException,
  trackStaleVibeVideoProcessing,
  trackVibeVideoEvent,
  VIBE_VIDEO_EVENTS,
} from "@/lib/vibeVideo/vibeVideoTelemetry";
import { syncCurrentVibeVideoStatus } from "@/lib/vibeVideo/syncVibeVideoStatus";

// ─── Public types ─────────────────────────────────────────────────────────────

export type HeroVideoPhase = "idle" | "uploading" | "processing" | "ready" | "stalled" | "failed";

export interface HeroVideoControllerState {
  phase: HeroVideoPhase;
  /** 0–100 during uploading; 100 after tus success */
  uploadProgress: number;
  /** Set once create-video-upload returns credentials */
  videoId: string | null;
  errorMessage: string | null;
}

type Subscriber = (state: HeroVideoControllerState) => void;
export type HeroVideoUploadContext = "onboarding" | "profile_studio";
type HeroVideoPollResumeSource = "profile_load" | "manual_refresh" | "manual_retry" | "visibility_active";
type HotImportMeta = ImportMeta & {
  hot?: {
    dispose: (callback: () => void) => void;
  };
};

// ─── Module-level state ───────────────────────────────────────────────────────

let _state: HeroVideoControllerState = {
  phase: "idle",
  uploadProgress: 0,
  videoId: null,
  errorMessage: null,
};

const _subscribers = new Set<Subscriber>();
let _activeTus: tus.Upload | null = null;
let _pollTimerId: ReturnType<typeof setInterval> | null = null;
let _pollAttempts = 0;
let _lastPollStatus: string | null = null;
let _activeRunStartedAt = 0;
let _visibilityListenerAttached = false;
let _visibilityChangeHandler: (() => void) | null = null;
let _visibilityResumeInFlight = false;
let _activePollVideoId: string | null = null;

/** 36 × 5 s = 3 min max poll window before silently going idle */
const POLL_MAX_ATTEMPTS = 36;
const POLL_INTERVAL_MS = 5_000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _setState(patch: Partial<HeroVideoControllerState>): void {
  _state = { ..._state, ...patch };
  _subscribers.forEach((cb) => cb(_state));
}

function _stopPoll(): void {
  if (_pollTimerId !== null) {
    clearInterval(_pollTimerId);
    _pollTimerId = null;
  }
  _pollAttempts = 0;
  _lastPollStatus = null;
  _activePollVideoId = null;
}

async function _pollTick(expectedVideoId: string): Promise<void> {
  _pollAttempts++;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await syncCurrentVibeVideoStatus(expectedVideoId, "processing_poll");

    const { data, error } = await supabase
      .from("profiles")
      .select("id, bunny_video_uid, bunny_video_status, updated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) return; // transient — keep polling

    const rowUid =
      typeof data?.bunny_video_uid === "string" ? data.bunny_video_uid.trim() : "";

    // If the profile reference was cleared, the user cancelled/deleted this
    // in-progress video elsewhere. Treat that as terminal so stale controller
    // state cannot resurrect a processing card on the profile page.
    if (!rowUid) {
      _stopPoll();
      _setState({ phase: "idle", uploadProgress: 0, videoId: null, errorMessage: null });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }

    // If the profile now points to a different video, the user replaced it elsewhere
    if (rowUid && rowUid !== expectedVideoId) {
      _stopPoll();
      _setState({ phase: "idle", videoId: null, errorMessage: null });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }

    const st = normalizeBunnyVideoStatus(data?.bunny_video_status);
    const resolved = resolveWebVibeVideoState({
      bunny_video_uid: rowUid,
      bunny_video_status: data?.bunny_video_status,
      updated_at: data?.updated_at,
    });
    if (resolved.state === "stale_processing") {
      trackStaleVibeVideoProcessing({
        source: "hero_video_controller",
        surface: "processing_poll",
        user_id: user.id,
        video_guid: expectedVideoId,
        status: resolved.normalizedStatus,
        age_ms: resolved.statusAgeMs,
        status_updated_at: resolved.statusUpdatedAt,
      });
    }
    if (st !== _lastPollStatus) {
      _lastPollStatus = st;
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingStatusChanged, {
        source: "hero_video_controller",
        status: st,
        attempt: _pollAttempts,
        video_guid: expectedVideoId,
      });
    }

    if (st === "ready") {
      _stopPoll();
      _setState({ phase: "ready", errorMessage: null });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.readyObserved, {
        source: "hero_video_controller",
        video_guid: expectedVideoId,
        duration_ms: _activeRunStartedAt ? Date.now() - _activeRunStartedAt : null,
      });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }

    if (st === "failed") {
      _stopPoll();
      _setState({ phase: "failed", errorMessage: "Processing did not complete. Try uploading again." });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.failedObserved, {
        source: "hero_video_controller",
        video_guid: expectedVideoId,
        status: st,
      });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }
  } catch (error) {
    captureVibeVideoException(error, {
      source: "hero_video_controller",
      phase: "processing_poll",
      video_guid: expectedVideoId,
    });
    // transient network error — keep polling
  }

  // Timeout: keep the video visible as an in-progress asset and offer repair copy.
  if (_pollAttempts >= POLL_MAX_ATTEMPTS) {
    _stopPoll();
    _setState({
      phase: "stalled",
      errorMessage: "Your video is taking longer than expected. It is still saved; refresh later or replace it.",
    });
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.uploadStalled, {
      source: "hero_video_controller",
      video_guid: expectedVideoId,
      attempts: POLL_MAX_ATTEMPTS,
    });
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingStalled, {
      source: "hero_video_controller",
      video_guid: expectedVideoId,
      attempts: POLL_MAX_ATTEMPTS,
    });
    void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
  }
}

function _startPoll(videoId: string): void {
  _stopPoll();
  _activePollVideoId = videoId;
  _pollAttempts = 0;
  _lastPollStatus = null;
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.processingPollStarted, {
    source: "hero_video_controller",
    video_guid: videoId,
    interval_ms: POLL_INTERVAL_MS,
    max_attempts: POLL_MAX_ATTEMPTS,
  });
  _pollTimerId = setInterval(() => {
    void _pollTick(videoId);
  }, POLL_INTERVAL_MS);
  void _pollTick(videoId);
}

export function heroVideoResumePollingForProfile(
  profile: {
    id?: string | null;
    bunnyVideoUid?: string | null;
    bunnyVideoStatus?: string | null;
    bunnyVideoUpdatedAt?: string | number | Date | null;
    updatedAt?: string | number | Date | null;
    bunny_video_uid?: string | null;
    bunny_video_status?: string | null;
    bunny_video_updated_at?: string | number | Date | null;
    updated_at?: string | number | Date | null;
  } | null | undefined,
  options: {
    source?: HeroVideoPollResumeSource;
  } = {},
): boolean {
  const source = options.source ?? "profile_load";
  const info = resolveWebVibeVideoState(profile);
  if (!info.uid || (info.state !== "processing" && info.state !== "stale_processing")) return false;

  if (_state.phase === "uploading") return false;
  if (_pollTimerId !== null && _activePollVideoId === info.uid) return false;
  if (_state.phase === "stalled" && _state.videoId === info.uid && source === "profile_load") return false;

  if (info.state === "stale_processing") {
    trackStaleVibeVideoProcessing({
      source: "hero_video_controller",
      surface: source,
      user_id: profile?.id ?? null,
      video_guid: info.uid,
      status: info.normalizedStatus,
      age_ms: info.statusAgeMs,
      status_updated_at: info.statusUpdatedAt,
    });
  }

  _setState({
    phase: "processing",
    uploadProgress: 100,
    videoId: info.uid,
    errorMessage: null,
  });
  _startPoll(info.uid);
  void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
  return true;
}

function _handleVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState !== "visible") return;
  if (_state.phase !== "stalled" || !_state.videoId) return;
  if (_visibilityResumeInFlight || _pollTimerId !== null) return;

  const videoId = _state.videoId;
  _visibilityResumeInFlight = true;
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.pollStalledVisible, {
    source: "hero_video_controller",
    video_guid: videoId,
  });
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.visibilityResumePoll, {
    source: "hero_video_controller",
    video_guid: videoId,
  });

  void _pollTick(videoId).finally(() => {
    _visibilityResumeInFlight = false;
  });
}

function _ensureVisibilityListener(): void {
  if (_visibilityListenerAttached || _visibilityChangeHandler || typeof document === "undefined") return;
  _visibilityChangeHandler = _handleVisibilityChange;
  _visibilityListenerAttached = true;
  document.addEventListener("visibilitychange", _visibilityChangeHandler);
}

_ensureVisibilityListener();

function _removeVisibilityListener(): void {
  if (typeof document !== "undefined" && _visibilityChangeHandler) {
    document.removeEventListener("visibilitychange", _visibilityChangeHandler);
  }
  _visibilityChangeHandler = null;
  _visibilityListenerAttached = false;
  _visibilityResumeInFlight = false;
}

const hot = (import.meta as HotImportMeta).hot;
if (hot) {
  hot.dispose(() => {
    _removeVisibilityListener();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Subscribe to state changes. Returns an unsubscribe function. */
export function heroVideoSubscribe(cb: Subscriber): () => void {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

/** Read the current controller state snapshot (no subscription). */
export function heroVideoGetState(): HeroVideoControllerState {
  return _state;
}

/**
 * Start a hero video upload. Aborts any in-flight upload first.
 * Resolves immediately — upload runs in the background.
 * After tus success, switches to `processing` and polls the backend.
 *
 * @param file    - Blob or File to upload
 * @param caption - Optional vibe caption saved after tus completes
 */
export function heroVideoStart(
  file: File | Blob,
  caption?: string,
  context: HeroVideoUploadContext = "profile_studio",
): void {
  // Cancel existing upload if any
  if (_activeTus) {
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.replaceStarted, {
      source: "hero_video_controller",
      upload_context: context,
      reason: "in_flight_upload_replaced",
    });
    try {
      _activeTus.abort();
    } catch {
      /* ignore */
    }
    _activeTus = null;
  }
  _stopPoll();

  _setState({ phase: "uploading", uploadProgress: 0, videoId: null, errorMessage: null });
  _activeRunStartedAt = Date.now();

  // Run async in background
  void _run(file, caption, context);
}

async function _run(
  file: File | Blob,
  caption?: string,
  context: HeroVideoUploadContext = "profile_studio",
): Promise<void> {
  let failurePhase: "credentials" | "tus" | "processing" = "credentials";
  let activeVideoId: string | null = null;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      _setState({ phase: "failed", errorMessage: "Not authenticated. Please sign in." });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestFailed, {
        source: "hero_video_controller",
        upload_context: context,
        error_code: "not_authenticated",
      });
      return;
    }

    // ── Get tus credentials from create-video-upload edge function ────────────
    let credRes: Response;
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestStarted, {
      source: "hero_video_controller",
      upload_context: context,
    });
    try {
      credRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ context }),
        },
      );
    } catch (error) {
      _setState({ phase: "failed", errorMessage: "Network error. Check your connection and try again." });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestFailed, {
        source: "hero_video_controller",
        upload_context: context,
        error_code: "network_error",
      });
      captureVibeVideoException(error, {
        source: "hero_video_controller",
        phase: "credentials_request",
      });
      return;
    }

    let creds: Record<string, unknown> = {};
    try {
      creds = (await credRes.json()) as Record<string, unknown>;
    } catch {
      /* empty body */
    }

    if (!credRes.ok || creds.success !== true) {
      const msg = String(creds.error ?? creds.message ?? `Upload service error (${credRes.status})`);
      _setState({ phase: "failed", errorMessage: msg });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestFailed, {
        source: "hero_video_controller",
        upload_context: context,
        error_code: String(creds.code ?? `http_${credRes.status}`),
        http_status: credRes.status,
      });
      return;
    }

    const videoId = String(creds.videoId ?? "");
    const libraryId = creds.libraryId;
    const expirationTime = creds.expirationTime;
    const signature = String(creds.signature ?? "");

    if (!videoId || !signature || libraryId == null || expirationTime == null) {
      _setState({ phase: "failed", errorMessage: "Incomplete upload credentials. Please try again." });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestFailed, {
        source: "hero_video_controller",
        upload_context: context,
        error_code: "incomplete_credentials",
      });
      return;
    }

    _setState({ videoId });
    activeVideoId = videoId;
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestSucceeded, {
      source: "hero_video_controller",
      upload_context: context,
      video_guid: videoId,
      has_library_id: libraryId != null,
    });

    // ── TUS upload to Bunny ───────────────────────────────────────────────────
    failurePhase = "tus";
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tusUploadStarted, {
      source: "hero_video_controller",
      upload_context: context,
      video_guid: videoId,
    });
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: "https://video.bunnycdn.com/tusupload",
        retryDelays: [0, 3000, 5000, 10000],
        chunkSize: 5 * 1024 * 1024,
        headers: {
          AuthorizationSignature: signature,
          AuthorizationExpire: String(expirationTime),
          VideoId: videoId,
          LibraryId: String(libraryId),
        },
        metadata: {
          filetype: (file as File).type || "video/mp4",
          title: `vibe-video-${Date.now()}`,
        },
        onError: (error: unknown) => {
          const msg = error instanceof Error ? error.message : "Upload failed. Please try again.";
          reject(new Error(msg));
        },
        onProgress: (bytesUploaded: number, bytesTotal: number) => {
          if (bytesTotal > 0) {
            _setState({ uploadProgress: Math.round((bytesUploaded / bytesTotal) * 100) });
          }
        },
        onSuccess: () => {
          resolve();
        },
      });

      _activeTus = upload;
      upload.start();
    });

    _activeTus = null;
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tusUploadSucceeded, {
      source: "hero_video_controller",
      upload_context: context,
      video_guid: videoId,
      duration_ms: _activeRunStartedAt ? Date.now() - _activeRunStartedAt : null,
    });

    // ── Caption save (best-effort after tus) ─────────────────────────────────
    failurePhase = "processing";
    if (caption !== undefined && caption !== null) {
      const trimmed = caption.trim();
      try {
        await updateMyProfile({ vibeCaption: trimmed.length > 0 ? trimmed : null });
      } catch (error) {
        console.warn("[HeroVideo] Caption save failed after upload; video upload continues.");
        captureVibeVideoException(error, {
          source: "hero_video_controller",
          phase: "caption_save",
        });
      }
    }

    // ── Move to processing, start backend poll ────────────────────────────────
    _setState({ phase: "processing", uploadProgress: 100 });
    _startPoll(videoId);
  } catch (err) {
    _activeTus = null;
    _stopPoll();
    const msg = err instanceof Error ? err.message : "Upload failed. Please try again.";
    _setState({ phase: "failed", errorMessage: msg });
    if (failurePhase === "credentials") {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.credentialsRequestFailed, {
        source: "hero_video_controller",
        upload_context: context,
        error_code: "credentials_exception",
      });
    } else if (failurePhase === "tus") {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tusUploadFailed, {
        source: "hero_video_controller",
        upload_context: context,
        video_guid: activeVideoId,
        error_code: "upload_exception",
      });
    } else {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.failedObserved, {
        source: "hero_video_controller",
        upload_context: context,
        video_guid: activeVideoId,
        error_code: "processing_exception",
      });
    }
    captureVibeVideoException(err, {
      source: "hero_video_controller",
      phase: "upload_run",
    });
    void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
  }
}

/**
 * Retry a failed upload with a new file. Call this when the user picks a new
 * take after a failure. Internally just calls heroVideoStart.
 */
export function heroVideoRetry(file: File | Blob, caption?: string): void {
  heroVideoStart(file, caption);
}

/**
 * Reset controller to idle without starting a new upload.
 * Aborts any in-flight tus and stops polling.
 */
export function heroVideoReset(): void {
  if (_activeTus) {
    try {
      _activeTus.abort();
    } catch {
      /* ignore */
    }
    _activeTus = null;
  }
  _stopPoll();
  _setState({ phase: "idle", uploadProgress: 0, videoId: null, errorMessage: null });
}
