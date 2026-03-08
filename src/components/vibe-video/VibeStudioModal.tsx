import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, Video, Mic, MicOff, Upload, Play, Pause, Scissors, Loader2, SwitchCamera } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
/** Convert blob URL to File by fetching it */
const blobUrlToFile = async (blobUrl: string, filename = "video.webm"): Promise<File> => {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "video/webm" });
};
import {
  compressVideo,
  shouldCompressVideo,
} from "@/utils/videoProcessing";
import { VideoTrimmer } from "./VideoTrimmer";
import { UploadProgressBar } from "./UploadProgressBar";
import * as tus from "tus-js-client";

interface VibeStudioModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (videoUrl: string, caption?: string) => void;
  existingVideoUrl?: string;
  existingCaption?: string;
}

const COACH_TIPS = [
  "Seeking a serious partner?",
  "Obsessed with a new hobby?",
  "Just here for the event?",
  "What song is stuck in your head?",
  "What's your weekend obsession?",
];

const RECORDING_DURATION = 15;
const MAX_CLIP_DURATION = 20;
// No file size limit — tus uploads to Bunny handle any size
// Enforcing max 20 seconds duration instead

export const VibeStudioModal = ({
  open,
  onOpenChange,
  onSave,
  existingVideoUrl,
  existingCaption = "",
}: VibeStudioModalProps) => {
  // Stages: idle → recording → preview (local) → trimming → uploading → posted (final review)
  const [stage, setStage] = useState<"idle" | "recording" | "preview" | "trimming" | "uploading" | "posted">("idle");
  const [countdown, setCountdown] = useState(RECORDING_DURATION);
  const [tipIndex, setTipIndex] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(12).fill(0.2));
  const [isMicOn, setIsMicOn] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [needsTrimming, setNeedsTrimming] = useState(false);
  const [vibeCaption, setVibeCaption] = useState(existingCaption);
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [originalVideoDuration, setOriginalVideoDuration] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [bunnyVideoUid, setBunnyVideoUid] = useState<string | null>(null);
  const [bunnyVideoStatus, setBunnyVideoStatus] = useState<string>("none");
  const videoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const finalVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Store detected mimeType for use in onstop
  const detectedMimeTypeRef = useRef<string | null>(null);

  // Request camera/mic permissions when modal opens
  useEffect(() => {
    if (!open) return;

    const initCamera = async () => {
      try {
        // Stop existing tracks before requesting new stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode ?? "user" },
          },
          audio: { echoCancellation: true, noiseSuppression: true },
        }).catch(async () => {
          console.warn("[VibeVideo] facingMode constraint failed, falling back to default camera");
          if (facingMode === 'environment') {
            setFacingMode('user');
          }
          return navigator.mediaDevices.getUserMedia({
            video: true,
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        });
        streamRef.current = stream;
        setHasPermission(true);

        // Re-check camera count after permission granted (labels now available)
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length >= 2);

        // Reset zoom to minimum if the browser supports it (iOS Safari safety net)
        try {
          const videoTrack = stream.getVideoTracks()[0];
          const caps = (videoTrack as any).getCapabilities?.();
          if (caps?.zoom && typeof caps.zoom === 'object' && 'min' in caps.zoom) {
            await (videoTrack as any).applyConstraints({ advanced: [{ zoom: (caps.zoom as any).min }] } as any);
          }
        } catch (_) {
          // Not all browsers support zoom constraint — that's fine
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Setup audio analyzer
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 32;
        source.connect(analyser);
        analyserRef.current = analyser;
      } catch (err) {
        console.error("[VibeVideo] getUserMedia failed:", err);
        setHasPermission(false);
      }
    };

    initCamera();

    return () => {
      // 1. Stop MediaRecorder if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }
      // 2. Stop ALL tracks on the stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      // 3. Clear video element src and revoke any blob URLs
      if (videoRef.current) {
        if (videoRef.current.src?.startsWith('blob:')) {
          URL.revokeObjectURL(videoRef.current.src);
        }
        videoRef.current.srcObject = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [open, facingMode]);

  // Rotate coach tips
  useEffect(() => {
    if (stage !== "idle") return;
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % COACH_TIPS.length);
    }, 3000);
    return () => clearInterval(tipInterval);
  }, [stage]);

  // Real audio visualization
  useEffect(() => {
    if (stage !== "recording" || !analyserRef.current) return;

    const updateLevels = () => {
      if (!analyserRef.current) return;
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      const levels = Array.from(dataArray.slice(0, 12)).map((v) => v / 255);
      setAudioLevels(levels);
    };

    const audioInterval = setInterval(updateLevels, 50);
    return () => clearInterval(audioInterval);
  }, [stage]);

  // Recording countdown
  useEffect(() => {
    if (stage !== "recording") return;

    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          stopRecording();
          return RECORDING_DURATION;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [stage]);

  // Polling for Bunny video processing status
  useEffect(() => {
    if (stage !== "posted") return;
    if (bunnyVideoStatus !== "processing" && bunnyVideoStatus !== "uploading") return;

    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("bunny_video_uid, bunny_video_status")
        .eq("id", user.id)
        .single();

      if (data?.bunny_video_status === "ready" || data?.bunny_video_status === "failed") {
        clearInterval(interval);
        setBunnyVideoStatus(data.bunny_video_status);
        if (data.bunny_video_status === "failed" && stage === "posted") {
          toast.error("Video processing failed. Please try again.");
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [stage, bunnyVideoStatus]);

  const uploadToBunny = async (blob: Blob): Promise<{ videoId: string }> => {
    console.log("[VibeVideo] requesting Bunny upload credentials", { size: blob.size, type: blob.type });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const credResponse = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-upload`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const creds = await credResponse.json();
    if (!creds.success) {
      throw new Error(creds.error || "Failed to get upload credentials");
    }

    const { videoId, libraryId, expirationTime, signature } = creds;
    console.log("[VibeVideo] got credentials, starting tus upload", { videoId });

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(blob, {
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
          filetype: blob.type,
          title: `vibe-video-${Date.now()}`,
        },
        onError: (error) => {
          console.error("[VibeVideo] tus upload error:", error);
          reject(error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const pct = Math.round(30 + (bytesUploaded / bytesTotal) * 70);
          console.log(`[VibeVideo] upload progress: ${pct}%`);
          setUploadProgress(Math.min(pct, 100));
        },
        onSuccess: () => {
          console.log("[VibeVideo] tus upload complete", { videoId });
          resolve();
        },
      });
      upload.start();
    });

    return { videoId };
  };

  const startRecording = useCallback(() => {
    if (!streamRef.current) {
      toast.error("Camera not ready yet");
      return;
    }

    chunksRef.current = [];

    // Safari supports MP4 recording and plays it back natively.
    // Chrome/Firefox support WebM recording. Prioritize each browser's native format.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const preferredTypes = isSafari
      ? [
          "video/mp4",
          "video/mp4;codecs=avc1",
          "video/mp4;codecs=avc1.42E01E",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
        ]
      : [
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
          "video/mp4",
          "video/mp4;codecs=avc1",
        ];

    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
    detectedMimeTypeRef.current = mimeType || null;
    console.log('[VibeVideo] Selected mimeType:', mimeType);

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const detectedType = detectedMimeTypeRef.current;
        const blobType = detectedType?.startsWith("video/") ? detectedType.split(";")[0] : "video/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const url = URL.createObjectURL(blob);
        console.log('[VibeVideo] Recording complete. Stream tracks:', {
          video: streamRef.current?.getVideoTracks().length,
          audio: streamRef.current?.getAudioTracks().length,
          mimeType: detectedType,
          blobSize: blob.size
        });
        setRecordedBlob(blob);
        setRecordedVideoUrl(url);
        setStage("preview");
        // Stop camera tracks so browser tab dot disappears
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250);
      setCountdown(RECORDING_DURATION);
      setStage("recording");
    } catch (err) {
      console.error("Failed to start recording:", err);
      toast.error("Recording not supported on this device/browser");
    }
  }, []);

  // Stop all camera tracks so browser tab recording dot disappears
  const stopCameraTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleRetake = useCallback(() => {
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
    }
    setRecordedVideoUrl(null);
    setRecordedBlob(null);
    setUploadedFile(null);
    setNeedsTrimming(false);
    setOriginalVideoDuration(null);
    setUploadProgress(0);
    setUploadError(null);
    setBunnyVideoUid(null);
    setBunnyVideoStatus("none");
    setStage("idle");
    setCountdown(RECORDING_DURATION);
  }, [recordedVideoUrl]);

  // Upload video via Bunny Stream tus and move to "posted" stage
  const handleUpload = useCallback(async () => {
    if (!uploadedFile && !recordedBlob && !recordedVideoUrl) {
      toast.error("No video to upload");
      return;
    }

    setIsSaving(true);
    setStage("uploading");
    stopCameraTracks();
    setUploadProgress(0);
    setUploadError(null);
    
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please sign in to save your video");
        setStage("preview");
        return;
      }

      let videoToUpload: File | Blob;

      // Determine the source video
      if (uploadedFile) {
        videoToUpload = uploadedFile;
      } else if (recordedBlob) {
        videoToUpload = recordedBlob;
      } else {
        videoToUpload = await blobUrlToFile(recordedVideoUrl!, "vibe-video.webm");
      }

      // Skip compression for camera-native formats — Bunny handles these
      const isNativeFormat =
        (videoToUpload as File).type === "video/quicktime" ||
        (videoToUpload as File).type === "video/mp4";

      if (!isNativeFormat && shouldCompressVideo(videoToUpload, 10)) {
        setProcessingStatus("Compressing video...");
        setUploadProgress(0);
        try {
          videoToUpload = await compressVideo(videoToUpload, {
            maxWidth: 720,
            maxHeight: 1280,
            videoBitrate: 1500000,
            onProgress: (p) => {
              setProcessingStatus("Compressing video...");
              setUploadProgress(Math.min(Math.round(p * 0.3), 30));
            },
          });
        } catch (compressError) {
          console.warn("Compression failed, uploading original:", compressError);
        }
      }

      // Validate blob is non-empty
      if (videoToUpload.size === 0) {
        throw new Error("Video file is empty after processing. Please try again.");
      }

      setProcessingStatus("Uploading video...");

      // Upload to Bunny Stream via tus
      const { videoId } = await uploadToBunny(videoToUpload);

      // Update profile with Bunny video info
      const { error: dbError } = await supabase
        .from("profiles")
        .update({
          bunny_video_uid: videoId,
          bunny_video_status: "processing",
          vibe_caption: vibeCaption,
        })
        .eq("id", user.id);

      if (dbError) {
        throw new Error("Upload succeeded but profile update failed. Please retry.");
      }

      console.log("[VibeVideo] upload and DB update complete", { videoId });
      setBunnyVideoUid(videoId);
      setBunnyVideoStatus("processing");
      setStage("posted");
      setIsVideoPlaying(true);

    } catch (err: any) {
      console.error("[VibeVideo] upload failed:", err);
      setUploadError(err.message || "Upload failed. Please try again.");
      setStage("preview");
    } finally {
      setIsSaving(false);
      setProcessingStatus(null);
    }
  }, [recordedVideoUrl, recordedBlob, uploadedFile, vibeCaption]);

  // Confirm and save to profile
  const handleConfirmPost = useCallback(() => {
    if (!bunnyVideoUid) {
      toast.error("No video to save");
      return;
    }

    onSave?.(bunnyVideoUid, vibeCaption);

    // Clean up
    onOpenChange(false);
    setStage("idle");
    setCountdown(RECORDING_DURATION);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    setRecordedBlob(null);
    setUploadedFile(null);
    setBunnyVideoUid(null);
    setBunnyVideoStatus("none");
    setProcessingStatus(null);
    setVibeCaption("");

    toast.success("Vibe video posted to your profile!");
  }, [onSave, onOpenChange, recordedVideoUrl, bunnyVideoUid, vibeCaption]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onOpenChange(false);
    stopCameraTracks();
    setStage("idle");
    setCountdown(RECORDING_DURATION);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
    }
    setRecordedVideoUrl(null);
    setRecordedBlob(null);
    setUploadedFile(null);
    setBunnyVideoUid(null);
    setBunnyVideoStatus("none");
  }, [onOpenChange, recordedVideoUrl, isSaving, stopCameraTracks]);

  const toggleMic = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    try {
      setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    } catch {
      toast.error("Camera switch not supported on this device");
    }
  }, []);

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read video duration"));
      };
      video.src = url;
    });
  };

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      toast.error("Please select a video file");
      return;
    }

    const url = URL.createObjectURL(file);

    // Duration check — no file size limit (tus handles any size)
    try {
      const duration = await getVideoDuration(file);
      if (duration > 20) {
        // Don't reject — show trimmer so user can cut to under 20s
        setOriginalVideoDuration(duration);
        setRecordedVideoUrl(url);
        setUploadedFile(file);
        setNeedsTrimming(true);
        setStage("trimming");
        return;
      }
    } catch {
      // If duration cannot be read, allow the upload — Bunny will handle it
      console.warn("[VibeVideo] Could not read duration of uploaded file");
    }

    // Under 20s — go straight to preview, no trimming needed
    setOriginalVideoDuration(null);
    setRecordedVideoUrl(url);
    setUploadedFile(file);
    setNeedsTrimming(false);
    setStage("preview");
  }, []);

  const handleTrimComplete = useCallback((trimmedBlob: Blob, startTime: number, endTime: number) => {
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
    }
    
    const url = URL.createObjectURL(trimmedBlob);
    setRecordedVideoUrl(url);
    setRecordedBlob(trimmedBlob);
    setUploadedFile(null);
    setNeedsTrimming(false);
    setStage("preview");
    toast.success(`Trimmed to ${Math.round(endTime - startTime)}s clip`);
  }, [recordedVideoUrl]);

  const handleTrimCancel = useCallback(() => {
    handleRetake();
  }, [handleRetake]);

  const toggleVideoPlayback = useCallback(() => {
    const videoEl = stage === "posted" ? finalVideoRef.current : reviewVideoRef.current;
    if (!videoEl) {
      console.warn("[VibeVideo] toggleVideoPlayback: no video element found for stage", stage);
      return;
    }
    if (videoEl.paused) {
      videoEl.play().catch(err => console.error("[VibeVideo] play failed:", err));
      setIsVideoPlaying(true);
    } else {
      videoEl.pause();
      setIsVideoPlaying(false);
    }
  }, [stage]);

  // Detach camera stream when entering preview stage
  useEffect(() => {
    if (stage !== "preview") return;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = "";
    }
  }, [stage]);

  // Auto-play preview video and sync play/pause state to real video events
  useEffect(() => {
    if (stage !== "preview") return;
    const videoEl = reviewVideoRef.current;
    if (!videoEl || !recordedVideoUrl) return;

    // Reset state — don't assume playing
    setIsVideoPlaying(false);

    // Wire to actual video events
    const onPlay = () => setIsVideoPlaying(true);
    const onPause = () => setIsVideoPlaying(false);

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);

    // Attempt autoplay — on iOS this may be silently blocked, that is fine
    setTimeout(() => {
      videoEl.play().catch(() => {
        // Autoplay blocked — user will tap Play manually, state stays false
      });
    }, 100);

    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
    };
  }, [stage, recordedVideoUrl]);

  // Auto-play + sync play/pause state for "posted" stage
  useEffect(() => {
    if (stage !== "posted") return;
    const videoEl = finalVideoRef.current;
    if (!videoEl) return;

    setIsVideoPlaying(false);

    const onPlay = () => setIsVideoPlaying(true);
    const onPause = () => setIsVideoPlaying(false);

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);

    setTimeout(() => {
      videoEl.play().catch(() => {});
    }, 150);

    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
    };
  }, [stage, bunnyVideoStatus]);

  // Reset caption when opening studio with no existing video
  useEffect(() => {
    if (!open) return;
    if (!bunnyVideoUid || bunnyVideoStatus === "none") {
      setVibeCaption("");
    }
  }, [open]);

  const progress = ((RECORDING_DURATION - countdown) / RECORDING_DURATION) * 100;

  const isProcessing = bunnyVideoStatus === "processing" || bunnyVideoStatus === "uploading";
  const finalVideoUrl = bunnyVideoUid
    ? `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${bunnyVideoUid}/playlist.m3u8`
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="p-0 m-0 max-w-none w-full h-full border-none bg-black overflow-hidden rounded-none">
        <div className="relative w-full flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
          {/* Close Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="absolute top-4 right-4 z-50 rounded-full bg-background/50 backdrop-blur-md hover:bg-background/70"
          >
            <X className="w-5 h-5" />
          </Button>

          {/* Permission Denied State */}
          {hasPermission === false && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <Video className="w-12 h-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-display font-bold text-foreground mb-2">
                Camera Access Required
              </h2>
              <p className="text-sm text-muted-foreground">
                Please allow camera and microphone access to record your Vibe Video.
              </p>
            </div>
          )}

          {/* Trimming Stage - Full screen trimmer */}
          {stage === "trimming" && recordedVideoUrl && (
            <VideoTrimmer
              videoUrl={recordedVideoUrl}
              maxDuration={MAX_CLIP_DURATION}
              onTrimComplete={handleTrimComplete}
              onCancel={handleTrimCancel}
            />
          )}

          {/* Camera Preview (9:16 aspect ratio simulation) */}
          {hasPermission !== false && stage !== "trimming" && (
            <div className="relative flex-1 bg-secondary overflow-hidden">
              {/* Final uploaded video review / processing state */}
              {stage === "posted" ? (
                isProcessing ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-secondary">
                    <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                    <p className="text-sm text-muted-foreground text-center px-6">
                      Your Vibe Video is being processed.<br />This takes about 15 seconds.
                    </p>
                  </div>
                ) : finalVideoUrl ? (
                  <video
                    ref={finalVideoRef}
                    src={finalVideoUrl}
                    className="w-full h-full object-cover"
                    autoPlay
                    loop
                    playsInline
                    muted={false}
                    onClick={toggleVideoPlayback}
                  />
                ) : null
              ) : /* Local preview before upload */
              stage === "preview" && recordedVideoUrl ? (
                <video
                  ref={reviewVideoRef}
                  src={recordedVideoUrl}
                  className={cn("w-full h-full object-cover", facingMode === 'user' && "scale-x-[-1]")}
                  playsInline
                  loop
                  onLoadedMetadata={(e) => {
                    const duration = (e.target as HTMLVideoElement).duration;
                    if (duration > MAX_CLIP_DURATION && !needsTrimming) {
                      setNeedsTrimming(true);
                    }
                  }}
                  onClick={toggleVideoPlayback}
                />
              ) : /* Uploading state - show the local video */
              stage === "uploading" && recordedVideoUrl ? (
                <>
                  <video
                    src={recordedVideoUrl}
                    className="w-full h-full object-cover opacity-50"
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="metadata"
                  />
                  {uploadError && (
                    <div className="absolute bottom-20 left-4 right-4 bg-destructive/90 text-destructive-foreground rounded-lg p-3 text-sm text-center z-20">
                      {uploadError}
                    </div>
                  )}
                  {uploadProgress > 0 && uploadProgress < 100 && (
                    <div className="absolute bottom-4 left-4 right-4 z-20">
                      <div className="w-full bg-secondary rounded-full h-1.5">
                        <div
                          className="bg-primary h-1.5 rounded-full transition-all"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground text-center mt-1">{uploadProgress}%</p>
                    </div>
                  )}
                </>
              ) : null}
                {/* Live camera element — hidden when not in camera stages */}
                <video
                  ref={videoRef}
                  className={cn(
                    "w-full h-full object-cover",
                    facingMode === 'user' && "scale-x-[-1]",
                    (stage === "preview" || stage === "uploading" || stage === "posted") && "hidden"
                  )}
                  autoPlay
                  muted
                  playsInline
                />

              {/* Dark overlay for non-preview states */}
              {stage !== "preview" && stage !== "posted" && (
                <div className="absolute inset-0 bg-background/20" />
              )}

              {/* Uploading overlay with progress bar */}
              {stage === "uploading" && (
                <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center z-10">
                  <UploadProgressBar
                    progress={uploadProgress}
                    status={processingStatus || "Processing..."}
                    isComplete={uploadProgress >= 100}
                  />
                </div>
              )}

              {/* Top HUD - Editable Caption */}
              <div className="absolute top-4 left-0 right-0 flex justify-center z-20 px-4">
                {vibeCaption ? (
                  <button
                    onClick={() => setIsEditingCaption(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md bg-black/40 border border-white/10 transition-all active:scale-95"
                    style={{ maxWidth: '80%' }}
                  >
                    <span
                      className="text-sm font-semibold truncate"
                      style={{
                        background: 'linear-gradient(90deg, #8B5CF6, #E84393)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}
                    >
                      {vibeCaption}
                    </span>
                    <span className="text-white/40 text-xs ml-1">· edit</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setIsEditingCaption(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md bg-black/40 border border-white/10 transition-all active:scale-95"
                    style={{ maxWidth: '80%' }}
                  >
                    <span className="text-white/50 text-sm">What's your vibe? </span>
                    <span
                      className="text-sm font-semibold"
                      style={{
                        background: 'linear-gradient(90deg, #8B5CF6, #E84393)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}
                    >
                      Tap to add ✦
                    </span>
                  </button>
                )}
              </div>

              {/* Caption Edit Modal */}
              <AnimatePresence>
                {isEditingCaption && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-background/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6"
                  >
                    <div className="w-full max-w-sm space-y-4">
                      <h3 className="text-lg font-display font-bold text-center text-foreground">
                        What are you vibing on?
                      </h3>
                      <input
                        type="text"
                        value={vibeCaption}
                        onChange={(e) => setVibeCaption(e.target.value)}
                        placeholder="Seeking a partner in crime..."
                        maxLength={50}
                        className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground text-center">
                        {vibeCaption.length}/50 characters
                      </p>
                      <div className="flex gap-3">
                        <Button
                          variant="ghost"
                          onClick={() => setIsEditingCaption(false)}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="gradient"
                          onClick={() => setIsEditingCaption(false)}
                          className="flex-1"
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Coach Tips (Rotating) */}
              <AnimatePresence mode="wait">
                {stage === "idle" && (
                  <motion.div
                    key={tipIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-36 left-4 right-4 z-20 text-center"
                  >
                    <p className="text-sm text-muted-foreground/80 italic">
                      "{COACH_TIPS[tipIndex]}"
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Recording Timer */}
              {stage === "recording" && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-36 left-1/2 -translate-x-1/2 z-20"
                >
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/90 backdrop-blur-sm">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                    </span>
                    <span className="text-sm font-bold text-white">
                      {countdown}s
                    </span>
                  </div>
                </motion.div>
              )}

              {/* Audio Waveform Visualizer */}
              {stage === "recording" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute bottom-44 left-1/2 -translate-x-1/2 z-20 flex items-end gap-1 h-12"
                >
                  {audioLevels.map((level, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: `${Math.max(level * 100, 10)}%` }}
                      transition={{ duration: 0.05 }}
                      className={cn(
                        "w-1.5 rounded-full",
                        i % 2 === 0
                          ? "bg-[hsl(var(--neon-cyan))]"
                          : "bg-[hsl(var(--neon-violet))]"
                      )}
                    />
                  ))}
                </motion.div>
              )}

              {/* Preview State - Note */}
              {stage === "preview" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-44 left-4 right-4 z-20"
                >
                  <div className="glass-card p-3 rounded-xl text-center">
                    <p className="text-xs text-muted-foreground">
                      📹 Review your video before uploading
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Posted State - Note */}
              {stage === "posted" && !isProcessing && (
                <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-10 px-6">
                  <span
                    className="text-xs tracking-wide text-center"
                    style={{ color: 'rgba(255,255,255,0.4)' }}
                  >
                    ✦ others see exactly this
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Bottom Controls */}
          {hasPermission !== false && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute bottom-0 left-0 right-0 z-30 p-6 pb-safe bg-gradient-to-t from-background via-background/95 to-transparent"
            >
              {stage === "idle" && (
                <div className="flex flex-col items-center gap-4">
                  {/* Hidden file input for upload */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />

                   {/* Mic & Camera Flip */}
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleMic}
                      className={cn(
                        "rounded-full w-12 h-12",
                        isMicOn ? "bg-secondary" : "bg-destructive/20"
                      )}
                    >
                      {isMicOn ? (
                        <Mic className="w-5 h-5" />
                      ) : (
                        <MicOff className="w-5 h-5 text-destructive" />
                      )}
                    </Button>
                    {hasMultipleCameras && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleCamera}
                        className="rounded-full w-12 h-12 bg-secondary"
                      >
                        <SwitchCamera className="w-5 h-5" />
                      </Button>
                    )}
                  </div>

                  {/* Record Button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startRecording}
                    className="relative w-20 h-20 rounded-full"
                  >
                    {/* Outer Ring */}
                    <div className="absolute inset-0 rounded-full border-4 border-destructive" />
                    {/* Inner Circle */}
                    <div className="absolute inset-3 rounded-full bg-destructive flex items-center justify-center">
                      <Video className="w-7 h-7 text-white" />
                    </div>
                  </motion.button>

                  <p className="text-sm text-muted-foreground">
                    Tap to record (15 seconds)
                  </p>

                  {/* Upload Button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Upload className="w-4 h-4" />
                    Or upload a video
                  </button>
                </div>
              )}

              {stage === "recording" && (
                <div className="flex flex-col items-center gap-4">
                  {/* Progress Ring Button */}
                  <div className="relative w-20 h-20">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="hsl(var(--muted))"
                        strokeWidth="4"
                        fill="none"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke="hsl(var(--neon-cyan))"
                        strokeWidth="4"
                        fill="none"
                        strokeDasharray={`${progress * 2.26} 226`}
                        strokeLinecap="round"
                        className="transition-all duration-200"
                      />
                    </svg>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={stopRecording}
                      className="absolute inset-3 rounded-full bg-destructive flex items-center justify-center"
                    >
                      <div className="w-5 h-5 rounded-sm bg-white" />
                    </motion.button>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Recording... Look at the camera!
                  </p>
                </div>
              )}

              {/* Preview stage - local review before upload */}
              {stage === "preview" && (
                <div className="flex items-center justify-center gap-6">
                  {/* Retake Button */}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleRetake}
                    className="flex flex-col items-center gap-2"
                  >
                    <div className="w-14 h-14 rounded-full bg-secondary border border-border flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground">Retake</span>
                  </motion.button>

                  {/* Play/Pause Button */}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={toggleVideoPlayback}
                    className="flex flex-col items-center gap-2"
                  >
                    <div className="w-14 h-14 rounded-full bg-neon-cyan/20 border border-neon-cyan/50 flex items-center justify-center">
                      {isVideoPlaying ? (
                        <Pause className="w-6 h-6 text-neon-cyan" />
                      ) : (
                        <Play className="w-6 h-6 text-neon-cyan ml-1" />
                      )}
                    </div>
                    <span className="text-xs text-neon-cyan">{isVideoPlaying ? "Pause" : "Play"}</span>
                  </motion.button>

                  {/* Upload Button */}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleUpload}
                    className="flex flex-col items-center gap-2"
                  >
                    <motion.div
                      animate={{
                        boxShadow: [
                          "0 0 0 0 hsl(var(--primary) / 0.4)",
                          "0 0 0 10px hsl(var(--primary) / 0)",
                        ],
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-14 h-14 rounded-full bg-primary flex items-center justify-center"
                    >
                      <Upload className="w-7 h-7 text-white" />
                    </motion.div>
                    <span className="text-xs text-primary font-medium">Upload</span>
                  </motion.button>
                </div>
              )}

              {/* Posted stage - final review after upload */}
              {stage === "posted" && (
                <div className="flex items-center justify-center gap-6">
                  {/* Discard Button */}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleRetake}
                    className="flex flex-col items-center gap-2"
                  >
                    <div className="w-14 h-14 rounded-full bg-secondary border border-border flex items-center justify-center">
                      <X className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground">Discard</span>
                  </motion.button>

                  {/* Play/Pause Button */}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={toggleVideoPlayback}
                    className="flex flex-col items-center gap-2"
                  >
                    <div className="w-14 h-14 rounded-full bg-neon-cyan/20 border border-neon-cyan/50 flex items-center justify-center">
                      {isVideoPlaying ? (
                        <Pause className="w-6 h-6 text-neon-cyan" />
                      ) : (
                        <Play className="w-6 h-6 text-neon-cyan ml-1" />
                      )}
                    </div>
                    <span className="text-xs text-neon-cyan">{isVideoPlaying ? "Pause" : "Play"}</span>
                  </motion.button>

                  {/* Confirm Post Button */}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleConfirmPost}
                    disabled={isProcessing}
                    className="flex flex-col items-center gap-2"
                  >
                    <motion.div
                      animate={{
                        boxShadow: isProcessing ? "none" : [
                          "0 0 0 0 hsl(142 76% 36% / 0.4)",
                          "0 0 0 10px hsl(142 76% 36% / 0)",
                        ],
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className={cn(
                        "w-14 h-14 rounded-full flex items-center justify-center",
                        isProcessing ? "bg-muted" : "bg-green-500"
                      )}
                    >
                      <Check className="w-7 h-7 text-white" />
                    </motion.div>
                    <span className={cn(
                      "text-xs font-medium",
                      isProcessing ? "text-muted-foreground" : "text-green-400"
                    )}>
                      {isProcessing ? "Processing..." : "Post Vibe"}
                    </span>
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
};

export default VibeStudioModal;
