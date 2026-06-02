import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertCircle, Camera, ImagePlus, Loader2, RotateCcw, Send, SwitchCamera, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  classifyMediaPermissionErrorWithBrowserState,
  mediaPermissionMessage,
  mediaPermissionTitle,
  type MediaPermissionRecoveryAction,
} from "@clientShared/media/mediaPermissionResult";

type PhotoCameraCaptureDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapturePhoto: (file: File) => Promise<boolean> | boolean;
  onChooseLibrary?: () => void;
  disabled?: boolean;
};

type CapturePhase = "loading" | "camera" | "preview" | "error";
type PhotoCameraFacingMode = "user" | "environment";

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

function shouldRetryWithGenericCamera(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return !["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name);
}

function facingModeFromStream(stream: MediaStream, fallback: PhotoCameraFacingMode): PhotoCameraFacingMode {
  const actualFacingMode = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  return actualFacingMode === "user" || actualFacingMode === "environment" ? actualFacingMode : fallback;
}

async function getCameraStream(
  facingMode: PhotoCameraFacingMode,
  opts?: { allowGenericFallback?: boolean; exactFacingMode?: boolean },
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: opts?.exactFacingMode ? { exact: facingMode } : { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (error) {
    if (!opts?.allowGenericFallback || !shouldRetryWithGenericCamera(error)) {
      throw error;
    }
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    });
  }
}

export function PhotoCameraCaptureDialog({
  open,
  onOpenChange,
  onCapturePhoto,
  onChooseLibrary,
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
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [errorRecoveryAction, setErrorRecoveryAction] = useState<MediaPermissionRecoveryAction | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [facingMode, setFacingMode] = useState<PhotoCameraFacingMode>("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

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

  const refreshCameraCount = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
        setHasMultipleCameras(false);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setHasMultipleCameras(devices.filter((device) => device.kind === "videoinput").length > 1);
    } catch {
      setHasMultipleCameras(false);
    }
  }, []);

  const attachCameraStream = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch {
        // The muted autoplay attribute usually starts playback; keep the preview mounted.
      }
    }
  }, []);

  const startCamera = useCallback(async (
    nextFacingMode: PhotoCameraFacingMode,
    opts?: { preserveExistingStream?: boolean; silentError?: boolean },
  ): Promise<MediaStream | null> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      stopCamera();
      setCapturedFile(null);
      revokePreviewUrl();
      setErrorTitle("Camera is not available");
      setErrorMessage("Camera capture is not available in this browser.");
      setErrorRecoveryAction("use_supported_browser");
      setPhase("error");
      return null;
    }

    const runId = cameraRunRef.current + 1;
    cameraRunRef.current = runId;
    const previousStream = streamRef.current;
    if (!opts?.preserveExistingStream) {
      stopCamera();
    }
    revokePreviewUrl();
    captureLockRef.current = false;
    submitLockRef.current = false;
    setCapturedFile(null);
    setErrorTitle(null);
    setErrorMessage(null);
    setErrorRecoveryAction(null);
    setIsSubmitting(false);
    setPhase("loading");

    let stream: MediaStream | null = null;
    try {
      stream = await getCameraStream(nextFacingMode, {
        allowGenericFallback: !opts?.preserveExistingStream,
        exactFacingMode: !!opts?.preserveExistingStream,
      });

      if (cameraRunRef.current !== runId || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }

      await attachCameraStream(stream);
      if (previousStream && previousStream !== stream) {
        previousStream.getTracks().forEach((track) => track.stop());
      }

      if (cameraRunRef.current !== runId || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }

      setFacingMode(facingModeFromStream(stream, nextFacingMode));
      setPhase("camera");
      void refreshCameraCount();
      return stream;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (cameraRunRef.current !== runId || !openRef.current) return null;
      if (opts?.preserveExistingStream && previousStream) {
        streamRef.current = previousStream;
        if (videoRef.current) videoRef.current.srcObject = previousStream;
        setPhase("camera");
        const permissionResult = await classifyMediaPermissionErrorWithBrowserState(error, "camera");
        setErrorTitle(mediaPermissionTitle(permissionResult));
        setErrorMessage(opts.silentError ? "Could not switch cameras. Please try again." : mediaPermissionMessage(permissionResult));
        setErrorRecoveryAction(permissionResult.recoveryAction);
        return null;
      }
      stopCamera();
      const permissionResult = await classifyMediaPermissionErrorWithBrowserState(error, "camera");
      setErrorTitle(mediaPermissionTitle(permissionResult));
      setErrorMessage(mediaPermissionMessage(permissionResult));
      setErrorRecoveryAction(permissionResult.recoveryAction);
      setPhase("error");
      return null;
    }
  }, [attachCameraStream, refreshCameraCount, revokePreviewUrl, stopCamera]);

  useEffect(() => {
    if (!open) {
      cameraRunRef.current += 1;
      stopCamera();
      revokePreviewUrl();
      captureLockRef.current = false;
      submitLockRef.current = false;
      setCapturedFile(null);
      setErrorTitle(null);
      setErrorMessage(null);
      setErrorRecoveryAction(null);
      setIsSubmitting(false);
      setFacingMode("environment");
      setHasMultipleCameras(false);
      setPhase("loading");
      return undefined;
    }

    void startCamera("environment");
    return () => {
      cameraRunRef.current += 1;
      stopCamera();
      revokePreviewUrl();
    };
  }, [open, revokePreviewUrl, startCamera, stopCamera]);

  useEffect(() => {
    if (!open || typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return undefined;
    const handleDeviceChange = () => void refreshCameraCount();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [open, refreshCameraCount]);

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
      if (facingMode === "user") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
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
    } catch {
      setErrorMessage("Could not capture the photo. Please try again.");
    } finally {
      captureLockRef.current = false;
    }
  };

  const handleRetake = () => {
    if (isSubmitting) return;
    void startCamera(facingMode);
  };

  const handleSwitchCamera = async () => {
    if (disabled || isSubmitting || phase !== "camera" || !hasMultipleCameras) return;
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    await startCamera(nextFacingMode, { preserveExistingStream: true, silentError: true });
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
      setErrorMessage("Could not send the photo. Please try again.");
    } catch {
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
            "fixed left-1/2 top-1/2 z-[100] w-[min(31rem,calc(100svw-1.5rem))] -translate-x-1/2 -translate-y-1/2",
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
                    facingMode === "user" && "scale-x-[-1]",
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

            {phase === "camera" && hasMultipleCameras ? (
              <button
                type="button"
                onClick={() => void handleSwitchCamera()}
                disabled={!canUseActions}
                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/55 text-white shadow-lg shadow-black/30 transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-45"
                aria-label="Switch camera"
                title="Switch camera"
              >
                <SwitchCamera className="h-5 w-5" aria-hidden />
              </button>
            ) : null}

            {phase === "error" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/72 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-pink-300/30 bg-pink-500/16 text-pink-200">
                  <AlertCircle className="h-7 w-7" aria-hidden />
                </div>
                <p className="max-w-sm text-sm leading-relaxed text-white/78">
                  <span className="mb-1 block text-base font-bold text-white">
                    {errorTitle ?? "Camera needed"}
                  </span>
                  {errorMessage ?? "Could not open the camera. Please try again."}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera(facingMode)}
                  disabled={isSubmitting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black transition hover:bg-white/90 disabled:pointer-events-none disabled:opacity-55"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {errorRecoveryAction === "open_settings" ? "I updated settings" : "Try again"}
                </button>
                {onChooseLibrary ? (
                  <button
                    type="button"
                    onClick={onChooseLibrary}
                    disabled={isSubmitting}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white/10 px-5 text-sm font-bold text-white/82 ring-1 ring-white/12 transition hover:bg-white/15 disabled:pointer-events-none disabled:opacity-55"
                  >
                    <ImagePlus className="h-4 w-4" aria-hidden />
                    Choose from library
                  </button>
                ) : null}
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
