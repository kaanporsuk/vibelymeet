export type VibeVideoProcessingCopy = {
  title: string;
  description: string;
  detail?: string;
};

export type VibeVideoProcessingCopyKey =
  | "uploading_starting"
  | "uploading_early"
  | "uploading_mid"
  | "uploading_late"
  | "processing"
  | "processing_late"
  | "failed"
  | "stalled";

export const VIBE_VIDEO_PROCESSING_COPY: Record<VibeVideoProcessingCopyKey, VibeVideoProcessingCopy> = {
  uploading_starting: {
    title: "Warming up your upload",
    description: "Keep this screen open or move around the app. Your upload will continue in the background.",
    detail: "Starting upload",
  },
  uploading_early: {
    title: "Sending your first frames",
    description: "Your local preview stays here while the video uploads.",
  },
  uploading_mid: {
    title: "Uploading your best take",
    description: "The video is moving to Vibely. You can keep browsing while it finishes.",
  },
  uploading_late: {
    title: "Almost uploaded",
    description: "Your clip is nearly on file. We will start preparing playback next.",
  },
  processing: {
    title: "Keeping your take on screen",
    description: "Your video uploaded and is being prepared for playback. This can take a few minutes.",
  },
  processing_late: {
    title: "Still preparing your Vibe Video",
    description: "Your video is still saved. Refresh later or replace it if it does not finish.",
  },
  failed: {
    title: "Upload or processing failed",
    description: "The video did not reach a playable state. Try uploading again.",
  },
  stalled: {
    title: "Still preparing your Vibe Video",
    description: "Your video is taking longer than expected. It is still saved.",
  },
};

export function vibeVideoUploadingCopy(progress: number | null | undefined): VibeVideoProcessingCopy {
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, Number(progress))) : 0;
  if (safeProgress <= 0) return VIBE_VIDEO_PROCESSING_COPY.uploading_starting;
  if (safeProgress < 25) return VIBE_VIDEO_PROCESSING_COPY.uploading_early;
  if (safeProgress < 75) return VIBE_VIDEO_PROCESSING_COPY.uploading_mid;
  return VIBE_VIDEO_PROCESSING_COPY.uploading_late;
}

export function vibeVideoProcessingCopy(isLate = false): VibeVideoProcessingCopy {
  return isLate ? VIBE_VIDEO_PROCESSING_COPY.processing_late : VIBE_VIDEO_PROCESSING_COPY.processing;
}

export function vibeVideoFailedCopy(message?: string | null): VibeVideoProcessingCopy {
  return {
    ...VIBE_VIDEO_PROCESSING_COPY.failed,
    description: message?.trim() || VIBE_VIDEO_PROCESSING_COPY.failed.description,
  };
}

export function vibeVideoStalledCopy(message?: string | null): VibeVideoProcessingCopy {
  return {
    ...VIBE_VIDEO_PROCESSING_COPY.stalled,
    description: message?.trim() || VIBE_VIDEO_PROCESSING_COPY.stalled.description,
  };
}
