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
 *   failed     — tus error OR backend reported failure; retry available
 */

import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { normalizeBunnyVideoStatus } from "@/lib/vibeVideo/webVibeVideoState";
import { queryClient } from "@/lib/queryClient";
import { updateMyProfile } from "@/services/profileService";

// ─── Public types ─────────────────────────────────────────────────────────────

export type HeroVideoPhase = "idle" | "uploading" | "processing" | "ready" | "failed";

export interface HeroVideoControllerState {
  phase: HeroVideoPhase;
  /** 0–100 during uploading; 100 after tus success */
  uploadProgress: number;
  /** Set once create-video-upload returns credentials */
  videoId: string | null;
  errorMessage: string | null;
}

type Subscriber = (state: HeroVideoControllerState) => void;

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
}

async function _pollTick(expectedVideoId: string): Promise<void> {
  _pollAttempts++;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("bunny_video_uid, bunny_video_status")
      .eq("id", user.id)
      .maybeSingle();

    if (error) return; // transient — keep polling

    const rowUid =
      typeof data?.bunny_video_uid === "string" ? data.bunny_video_uid.trim() : "";

    // If the profile now points to a different video, the user replaced it elsewhere
    if (rowUid && rowUid !== expectedVideoId) {
      _stopPoll();
      _setState({ phase: "idle", videoId: null, errorMessage: null });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }

    const st = normalizeBunnyVideoStatus(data?.bunny_video_status);

    if (st === "ready") {
      _stopPoll();
      _setState({ phase: "ready", errorMessage: null });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }

    if (st === "failed") {
      _stopPoll();
      _setState({ phase: "failed", errorMessage: "Processing did not complete. Try uploading again." });
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      return;
    }
  } catch {
    // transient network error — keep polling
  }

  // Timeout: go idle and let the profile be the authoritative display
  if (_pollAttempts >= POLL_MAX_ATTEMPTS) {
    _stopPoll();
    _setState({ phase: "idle", videoId: null, errorMessage: null });
    void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
  }
}

function _startPoll(videoId: string): void {
  _stopPoll();
  _pollAttempts = 0;
  _pollTimerId = setInterval(() => {
    void _pollTick(videoId);
  }, POLL_INTERVAL_MS);
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
export function heroVideoStart(file: File | Blob, caption?: string): void {
  // Cancel existing upload if any
  if (_activeTus) {
    try {
      _activeTus.abort();
    } catch {
      /* ignore */
    }
    _activeTus = null;
  }
  _stopPoll();

  _setState({ phase: "uploading", uploadProgress: 0, videoId: null, errorMessage: null });

  // Run async in background
  void _run(file, caption);
}

async function _run(file: File | Blob, caption?: string): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      _setState({ phase: "failed", errorMessage: "Not authenticated. Please sign in." });
      return;
    }

    // ── Get tus credentials from create-video-upload edge function ────────────
    let credRes: Response;
    try {
      credRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ context: "profile_studio" }),
        },
      );
    } catch {
      _setState({ phase: "failed", errorMessage: "Network error. Check your connection and try again." });
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
      return;
    }

    const videoId = String(creds.videoId ?? "");
    const libraryId = creds.libraryId;
    const expirationTime = creds.expirationTime;
    const signature = String(creds.signature ?? "");

    if (!videoId || !signature || libraryId == null || expirationTime == null) {
      _setState({ phase: "failed", errorMessage: "Incomplete upload credentials. Please try again." });
      return;
    }

    _setState({ videoId });

    // ── TUS upload to Bunny ───────────────────────────────────────────────────
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

    // ── Caption save (best-effort after tus) ─────────────────────────────────
    if (caption !== undefined && caption !== null) {
      const trimmed = caption.trim() || null;
      try {
        await updateMyProfile({ vibeCaption: trimmed ?? undefined });
      } catch {
        console.warn("[HeroVideo] Caption save failed after upload; video upload continues.");
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
