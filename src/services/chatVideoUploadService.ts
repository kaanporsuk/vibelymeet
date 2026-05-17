import {
  VIBE_CLIP_MAX_UPLOAD_BYTES,
  VIBE_CLIP_UPLOAD_EMPTY_FILE,
  VIBE_CLIP_UPLOAD_TOO_LARGE,
  vibeClipMultipartFitsEdgeLimit,
} from "../../shared/chat/vibeClipCaptureCopy";
import {
  GENERIC_UPLOAD_MIME_TYPE,
  uploadFileNameForMimeType,
  videoMimeTypeForUpload,
} from "@/lib/webUploadMime";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export type ChatVideoUploadResult = {
  videoUrl: string;
  thumbnailUrl: string | null;
  posterSource: "uploaded_thumbnail" | "first_frame";
  aspectRatio: number | null;
};

async function createWebVideoThumbnail(videoBlob: Blob): Promise<{ blob: Blob; aspectRatio: number | null } | null> {
  if (typeof window === "undefined") return null;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const objectUrl = URL.createObjectURL(videoBlob);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("video_metadata_timeout")), 4500);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("video_metadata_failed"));
      };
      video.src = objectUrl;
    });
    const ratio =
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null;
    const targetTime = Number.isFinite(video.duration) && video.duration > 0.5 ? 0.5 : 0.01;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      }, 800);
      const onSeeked = () => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      try {
        video.currentTime = targetTime;
      } catch {
        window.clearTimeout(timer);
        resolve();
      }
    });
    const canvas = document.createElement("canvas");
    const width = Math.max(240, video.videoWidth || 320);
    const height = video.videoWidth && video.videoHeight ? Math.round(width / (video.videoWidth / video.videoHeight)) : 180;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return null;
    return { blob, aspectRatio: ratio };
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function videoMimeTypeForBlob(videoBlob: Blob): string {
  const name = typeof File !== "undefined" && videoBlob instanceof File ? videoBlob.name : undefined;
  return videoMimeTypeForUpload(videoBlob.type, name) ?? GENERIC_UPLOAD_MIME_TYPE;
}

export async function uploadChatVideoToBunny(
  videoBlob: Blob,
  accessToken: string,
  matchId: string
): Promise<ChatVideoUploadResult> {
  if (videoBlob.size <= 0) {
    throw new Error(VIBE_CLIP_UPLOAD_EMPTY_FILE);
  }
  if (videoBlob.size > VIBE_CLIP_MAX_UPLOAD_BYTES) {
    throw new Error(VIBE_CLIP_UPLOAD_TOO_LARGE());
  }

  const formData = new FormData();
  const mimeType = videoMimeTypeForBlob(videoBlob);
  const fileName =
    typeof File !== "undefined" && videoBlob instanceof File ? videoBlob.name : undefined;
  formData.append("file", videoBlob, uploadFileNameForMimeType("video", "chat-video", mimeType, fileName));
  formData.append("match_id", matchId);
  const thumb = await createWebVideoThumbnail(videoBlob);
  if (
    thumb?.blob &&
    thumb.blob.size > 0 &&
    vibeClipMultipartFitsEdgeLimit(videoBlob.size, thumb.blob.size)
  ) {
    formData.append("thumbnail", thumb.blob, "chat-video-thumb.jpg");
  }
  if (thumb?.aspectRatio && Number.isFinite(thumb.aspectRatio) && thumb.aspectRatio > 0) {
    formData.append("aspect_ratio", String(thumb.aspectRatio));
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/upload-chat-video`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    }
  );

  let data: {
    success?: boolean;
    path?: string;
    url?: string;
    thumbnail_path?: string | null;
    thumbnail_url?: string | null;
    poster_source?: "uploaded_thumbnail" | "first_frame";
    aspect_ratio?: number | null;
    error?: string;
  };
  try {
    data = await res.json();
  } catch {
    throw new Error("Upload service unavailable. Please try again.");
  }

  if (!data.success) {
    throw new Error(data.error || "Video upload failed");
  }

  const videoRef = data.path || data.url;
  if (!videoRef) {
    throw new Error("Video upload failed");
  }

  return {
    videoUrl: videoRef,
    thumbnailUrl:
      typeof data.thumbnail_path === "string" && data.thumbnail_path
        ? data.thumbnail_path
        : typeof data.thumbnail_url === "string" && data.thumbnail_url
          ? data.thumbnail_url
          : null,
    posterSource: data.poster_source === "uploaded_thumbnail" ? "uploaded_thumbnail" : "first_frame",
    aspectRatio:
      typeof data.aspect_ratio === "number" && Number.isFinite(data.aspect_ratio) && data.aspect_ratio > 0
        ? data.aspect_ratio
        : thumb?.aspectRatio ?? null,
  };
}
