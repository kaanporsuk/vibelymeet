import {
  VIBE_CLIP_MAX_DURATION_SEC,
  VIBE_CLIP_MAX_UPLOAD_BYTES,
  VIBE_CLIP_UPLOAD_DURATION_UNREADABLE,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_INVALID_TYPE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
  VIBE_CLIP_UPLOAD_TOO_LONG,
} from "../../shared/chat/vibeClipCaptureCopy";
import type { CaptureSource } from "../../shared/chat/vibeClipAnalytics";

export type WebVibeClipCompleteMeta = {
  captureSource?: CaptureSource;
  mimeType?: string;
  aspectRatio?: number | null;
};

type SelectedVideoMetadata = {
  durationSeconds: number;
  aspectRatio: number | null;
};

export type PreparedWebVibeClipLibraryUpload = {
  file: File;
  durationSeconds: number;
  meta: WebVibeClipCompleteMeta;
};

export function looksLikeVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|webm|avi|mkv)$/i.test(file.name);
}

export function readSelectedVideoMetadata(file: File): Promise<SelectedVideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    const fail = () => {
      if (settled) return;
      cleanup();
      reject(new Error("duration_unreadable"));
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      if (settled) return;
      const durationSeconds = video.duration;
      const aspectRatio =
        video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        fail();
        return;
      }
      cleanup();
      resolve({ durationSeconds, aspectRatio });
    };
    video.onerror = fail;
    timeoutId = window.setTimeout(fail, 4500);
    video.src = objectUrl;
  });
}

export async function prepareWebVibeClipLibraryFile(file: File): Promise<PreparedWebVibeClipLibraryUpload> {
  if (!looksLikeVideoFile(file)) {
    throw new Error(VIBE_CLIP_UPLOAD_INVALID_TYPE);
  }

  if (file.size <= 0) {
    throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
  }

  if (file.size > VIBE_CLIP_MAX_UPLOAD_BYTES) {
    throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());
  }

  let metadata: SelectedVideoMetadata;
  try {
    metadata = await readSelectedVideoMetadata(file);
  } catch {
    throw new Error(VIBE_CLIP_UPLOAD_DURATION_UNREADABLE);
  }

  if (metadata.durationSeconds > VIBE_CLIP_MAX_DURATION_SEC + 0.25) {
    throw new Error(VIBE_CLIP_UPLOAD_TOO_LONG());
  }

  return {
    file,
    durationSeconds: metadata.durationSeconds,
    meta: {
      captureSource: "library",
      mimeType: file.type || undefined,
      aspectRatio: metadata.aspectRatio,
    },
  };
}
