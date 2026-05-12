import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertCircle, Camera, Loader2, RotateCcw, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type PhotoCameraCaptureDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapturePhoto: (file: File) => Promise<boolean> | boolean;
  disabled?: boolean;
};

type CapturePhase = "loading" | "camera" | "preview" | "error";

const CAPTURE_FILE_TYPE = "image/jpeg";
const CAPTURE_QUALITY = 0.85;

function dataUrlToBlob(dataUrl: string): Blob | null {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = /^data:([^;]+);base64$/.exec(header ?? "");
  if (!mimeMatch || !base64) return null;

  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeMatch[1] });
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (!nextBlob || nextBlob.size <= 0) {
          reject(new Error("empty_camera_photo"));
          return;
        }
        resolve(nextBlob);
      }, CAPTURE_FILE_TYPE, CAPTURE_QUALITY);
    });
  }

  const blob = dataUrlToBlob(canvas.toDataURL(CAPTURE_FILE_TYPE, CAPTURE_QUALITY));
  if (!blob || blob.size <= 0) {
    throw new Error("empty_camera_photo");
  }
  return blob;
}

function cameraErrorMessage(error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Allow camera access in your browser settings to take a photo.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your camera is already in use by another app.";
  }
  return "Could not open the camera. Please try again.";
}

function shouldRetryWithGenericCamera(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return name !== "NotAllowedError" && name !== "SecurityError";
}

export function PhotoCameraCaptureDialog({
  open,
  onOpenChange,
  onCapturePhoto,
  disabled,
}: PhotoCameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const cameraRunRef = useRef(0);
  const captureLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const openRef = useRef(open);
  const [phase, setPhase] = useState<CapturePhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      stopCamera();
      setCapturedFile(null);
      revokePreviewUrl();
      setErrorMessage("Camera capture is not available in this browser.");
      setPhase("error");
      return;
    }

    const runId = cameraRunRef.current + 1;
    cameraRunRef.current = runId;
    stopCamera();
    revokePreviewUrl();
    captureLockRef.current = false;
    submitLockRef.current = false;
    setCapturedFile(null);
    setErrorMessage(null);
    setIsSubmitting(false);
    setPhase("loading");

    let stream: MediaStream | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (error) {
        if (!shouldRetryWithGenericCamera(error)) {
          throw error;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      if (cameraRunRef.current !== runId || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // The muted autoplay attribute usually starts playback; keep the preview mounted.
        }
      }

      if (cameraRunRef.current !== runId || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      setPhase("camera");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (cameraRunRef.current !== runId || !openRef.current) return;
      stopCamera();
      setErrorMessage(cameraErrorMessage(error));
      setPhase("error");
    }
  }, [revokePreviewUrl, stopCamera]);

  useEffect(() => {
    if (!open) {
      cameraRunRef.current += 1;
      stopCamera();
      revokePreviewUrl();
      captureLockRef.current = false;
      submitLockRef.current = false;
      setCapturedFile(null);
      setErrorMessage(null);
      setIsSubmitting(false);
      setPhase("loading");
      return undefined;
    }

    void startCamera();
    return () => {
      cameraRunRef.current += 1;
      stopCamera();
      revokePreviewUrl();
    };
  }, [open, revokePreviewUrl, startCamera, stopCamera]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting || submitLockRef.current) return;
    onOpenChange(nextOpen);
  };

  const handleCapture = async () => {
    if (disabled || isSubmitting || captureLockRef.current) return;
    captureLockRef.current = true;
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      captureLockRef.current = false;
      setErrorMessage("Camera is still starting. Please wait a moment and try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      captureLockRef.current = false;
      setErrorMessage("Your browser could not prepare the photo. Please try again.");
      setPhase("error");
      return;
    }

    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToJpegBlob(canvas);
      if (!openRef.current) return;

      const file = new File([blob], `chat-photo-${Date.now()}.jpg`, { type: CAPTURE_FILE_TYPE });
      const objectUrl = URL.createObjectURL(blob);
      revokePreviewUrl();
      previewUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      setCapturedFile(file);
      setErrorMessage(null);
      stopCamera();
      setPhase("preview");
    } catch (error) {
      console.error("Photo camera capture failed:", error);
      setErrorMessage("Could not capture the photo. Please try again.");
    } finally {
      captureLockRef.current = false;
    }
  };

  const handleRetake = () => {
    if (isSubmitting) return;
    void startCamera();
  };

  const handleSendCaptured = async () => {
    if (disabled || isSubmitting || submitLockRef.current || !capturedFile) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    let closingAfterSend = false;
    try {
      const sent = await onCapturePhoto(capturedFile);
      if (sent) {
        closingAfterSend = true;
        onOpenChange(false);
        return;
      }
    } catch (error) {
      console.error("Photo camera send failed:", error);
      setErrorMessage("Could not send the photo. Please try again.");
    } finally {
      if (!closingAfterSend) {
        submitLockRef.current = false;
      }
      if (openRef.current && !closingAfterSend) {
        setIsSubmitting(false);
      }
    }
  };

  const canUseActions = !disabled && !isSubmitting;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/82 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[100] w-[min(31rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2",
            "max-h-[min(92vh,43rem)] overflow-y-auto rounded-[1.75rem] border border-white/10 bg-[#111116]/95 p-4 text-white shadow-2xl shadow-black/45 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          aria-describedby="photo-camera-capture-description"
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-xl font-bold leading-tight">
                Take photo
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="photo-camera-capture-description"
                className="mt-1 text-sm text-white/58"
              >
                Use your camera to add a picture.
              </DialogPrimitive.Description>
            </div>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition hover:bg-white/[0.1] hover:text-white disabled:pointer-events-none disabled:opacity-45"
              aria-label="Close camera"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
            <div className="aspect-[3/4] max-h-[min(58vh,30rem)] w-full sm:aspect-[4/3]">
              {phase === "preview" && previewUrl ? (
                <img src={previewUrl} alt="Captured photo preview" className="h-full w-full object-cover" />
              ) : (
                <video
                  ref={videoRef}
                  className={cn(
                    "h-full w-full object-cover",
                    phase === "camera" ? "opacity-100" : "opacity-35",
                  )}
                  autoPlay
                  muted
                  playsInline
                />
              )}
            </div>

            {phase === "loading" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-white/70">
                <Loader2 className="h-8 w-8 animate-spin text-violet-300" aria-hidden />
                <span className="text-sm font-medium">Opening camera...</span>
              </div>
            ) : null}

            {phase === "error" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/72 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-pink-300/30 bg-pink-500/16 text-pink-200">
                  <AlertCircle className="h-7 w-7" aria-hidden />
                </div>
                <p className="max-w-sm text-sm leading-relaxed text-white/78">
                  {errorMessage ?? "Could not open the camera. Please try again."}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  disabled={isSubmitting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black transition hover:bg-white/90 disabled:pointer-events-none disabled:opacity-55"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Try again
                </button>
              </div>
            ) : null}
          </div>

          {phase !== "error" && errorMessage ? (
            <p className="mt-3 text-center text-sm leading-relaxed text-pink-200">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {phase === "preview" ? (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white/[0.08] px-5 text-sm font-bold text-white/72 transition hover:bg-white/[0.12] hover:text-white disabled:pointer-events-none disabled:opacity-55"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Retake
                </button>
                <button
                  type="button"
                  onClick={handleSendCaptured}
                  disabled={!capturedFile || !canUseActions}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-pink-500 px-5 text-sm font-bold text-white shadow-lg shadow-pink-950/25 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-55"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  Send photo
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-white/[0.08] px-5 text-sm font-bold text-white/72 transition hover:bg-white/[0.12] hover:text-white disabled:pointer-events-none disabled:opacity-55"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCapture}
                  disabled={phase !== "camera" || !canUseActions}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-pink-500 px-5 text-sm font-bold text-white shadow-lg shadow-pink-950/25 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-55"
                >
                  <Camera className="h-4 w-4" aria-hidden />
                  Capture
                </button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default PhotoCameraCaptureDialog;
