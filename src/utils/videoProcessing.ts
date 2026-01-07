/**
 * Video processing utilities for thumbnail generation and compression
 */

/**
 * Generate a thumbnail from a video file/blob
 * Returns a base64 data URL of the first frame
 */
export const generateVideoThumbnail = (
  videoSource: File | Blob | string,
  seekTime: number = 0.5
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const cleanup = () => {
      video.pause();
      video.src = "";
      video.load();
      if (typeof videoSource === "string" && videoSource.startsWith("blob:")) {
        // Don't revoke if it's a user-provided blob URL
      }
    };

    video.onloadedmetadata = () => {
      // Seek to the specified time or 10% into the video
      video.currentTime = Math.min(seekTime, video.duration * 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        // Use reasonable dimensions for thumbnail
        const maxWidth = 640;
        const maxHeight = 360;
        
        let width = video.videoWidth;
        let height = video.videoHeight;
        
        // Scale down if needed
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          reject(new Error("Failed to get canvas context"));
          return;
        }
        
        ctx.drawImage(video, 0, 0, width, height);
        const thumbnailDataUrl = canvas.toDataURL("image/jpeg", 0.8);
        cleanup();
        resolve(thumbnailDataUrl);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video for thumbnail generation"));
    };

    // Set the source
    if (typeof videoSource === "string") {
      video.src = videoSource;
    } else {
      video.src = URL.createObjectURL(videoSource);
    }

    video.load();
  });
};

/**
 * Compress a video using canvas-based frame extraction and MediaRecorder
 * This provides basic compression by re-encoding at lower bitrate
 */
export const compressVideo = (
  videoFile: File | Blob,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    videoBitrate?: number;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<Blob> => {
  const {
    maxWidth = 720,
    maxHeight = 1280,
    videoBitrate = 1000000, // 1 Mbps
    onProgress,
  } = options;

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const videoUrl = URL.createObjectURL(videoFile);
    video.src = videoUrl;

    video.onloadedmetadata = async () => {
      try {
        // Calculate scaled dimensions
        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }

        width = Math.round(width);
        height = Math.round(height);

        // Create canvas for video processing
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          throw new Error("Failed to get canvas context");
        }

        // Check if MediaRecorder supports the codec
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "video/webm";

        // Create a stream from canvas
        const stream = canvas.captureStream(30); // 30 fps

        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: videoBitrate,
        });

        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          URL.revokeObjectURL(videoUrl);
          const compressedBlob = new Blob(chunks, { type: mimeType });
          resolve(compressedBlob);
        };

        mediaRecorder.onerror = (e) => {
          URL.revokeObjectURL(videoUrl);
          reject(new Error("MediaRecorder error during compression"));
        };

        // Start recording and play video
        mediaRecorder.start(100); // Collect data every 100ms
        video.play();

        const duration = video.duration;
        
        // Draw frames to canvas
        const drawFrame = () => {
          if (video.paused || video.ended) {
            mediaRecorder.stop();
            return;
          }

          ctx.drawImage(video, 0, 0, width, height);
          
          if (onProgress) {
            onProgress((video.currentTime / duration) * 100);
          }

          requestAnimationFrame(drawFrame);
        };

        video.onplay = () => {
          drawFrame();
        };

        video.onended = () => {
          mediaRecorder.stop();
        };

      } catch (error) {
        URL.revokeObjectURL(videoUrl);
        reject(error);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      reject(new Error("Failed to load video for compression"));
    };

    video.load();
  });
};

/**
 * Quick compression check - if file is small enough, skip compression
 */
export const shouldCompressVideo = (file: File | Blob, maxSizeMB: number = 10): boolean => {
  const fileSizeMB = file.size / (1024 * 1024);
  return fileSizeMB > maxSizeMB;
};

/**
 * Convert data URL to Blob for uploading
 */
export const dataUrlToBlob = (dataUrl: string): Blob => {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};
