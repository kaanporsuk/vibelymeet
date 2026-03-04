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
import { uploadVideo, blobUrlToFile, getSignedVideoUrl } from "@/services/videoStorageService";
import {
  generateVideoThumbnail,
  compressVideo,
  shouldCompressVideo,
  dataUrlToBlob,
} from "@/utils/videoProcessing";
import { VideoTrimmer } from "./VideoTrimmer";
import { UploadProgressBar } from "./UploadProgressBar";

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
const MAX_CLIP_DURATION = 15;
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

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
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
  const [needsTrimming, setNeedsTrimming] = useState(false);
  const [vibeCaption, setVibeCaption] = useState(existingCaption);
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [originalVideoDuration, setOriginalVideoDuration] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
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
          video: { facingMode: facingMode, aspectRatio: { ideal: 9 / 16 }, width: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;
        setHasPermission(true);

        // Reset zoom to 1x if the browser supports it (iOS safety net)
        try {
          const videoTrack = stream.getVideoTracks()[0];
          const capabilities = (videoTrack as any).getCapabilities?.();
          if (capabilities?.zoom) {
            await (videoTrack as any).applyConstraints({ advanced: [{ zoom: 1 }] });
          }
        } catch (e) {
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
        console.error("Camera permission denied:", err);
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
      // 3. Clear video element src
      if (videoRef.current) {
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
        setRecordedBlob(blob);
        setRecordedVideoUrl(url);
        setStage("preview");
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
    setFinalVideoUrl(null);
    setUploadedPath(null);
    setNeedsTrimming(false);
    setOriginalVideoDuration(null);
    setUploadProgress(0);
    setStage("idle");
    setCountdown(RECORDING_DURATION);
  }, [recordedVideoUrl]);

  // Upload video and move to "posted" stage for final review
  const handleUpload = useCallback(async () => {
    if (!uploadedFile && !recordedBlob && !recordedVideoUrl) {
      toast.error("No video to upload");
      return;
    }

    setIsSaving(true);
    setStage("uploading");
    setUploadProgress(0);
    
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

      // Compress video if needed (>10MB)
      if (shouldCompressVideo(videoToUpload, 10)) {
        setProcessingStatus("Compressing video...");
        setUploadProgress(0);
        try {
          videoToUpload = await compressVideo(videoToUpload, {
            maxWidth: 720,
            maxHeight: 1280,
            videoBitrate: 1500000,
            onProgress: (p) => {
              setProcessingStatus("Compressing video...");
              setUploadProgress(p * 0.3);
            },
          });
        } catch (compressError) {
          console.warn("Compression failed, uploading original:", compressError);
        }
      }

      // Generate thumbnail (best-effort)
      setProcessingStatus("Generating thumbnail...");
      setUploadProgress(35);
      try {
        const thumbnailDataUrl = await generateVideoThumbnail(videoToUpload);
        const thumbnailBlob = dataUrlToBlob(thumbnailDataUrl);
        const thumbnailFile = new File([thumbnailBlob], `${user.id}_thumb.jpg`, {
          type: "image/jpeg",
        });

        const thumbPath = `${user.id}/${Date.now()}_thumb.jpg`;
        const { error: thumbError } = await supabase.storage
          .from("vibe-videos")
          .upload(thumbPath, thumbnailFile, { cacheControl: "3600", upsert: true });

        if (thumbError) {
          console.warn("Thumbnail upload failed:", thumbError);
        }
      } catch (thumbError) {
        console.warn("Thumbnail generation failed:", thumbError);
      }

      // Upload video with progress tracking
      setProcessingStatus("Uploading video...");
      console.log('[VibeVideo] Upload starting');
      const result = await uploadVideo(videoToUpload, user.id, (progress, status) => {
        const mappedProgress = 40 + (progress * 0.55);
        setUploadProgress(mappedProgress);
        setProcessingStatus(status);
      });
      setUploadedPath(result.path);
      console.log('[VibeVideo] Upload complete for path:', result.path);

      // Get signed URL for playback
      setProcessingStatus("Preparing preview...");
      setUploadProgress(98);
      const signedUrl = await getSignedVideoUrl(result.path);
      if (signedUrl) {
        setUploadProgress(100);
        setFinalVideoUrl(signedUrl);
        setStage("posted");
        setIsVideoPlaying(true);
      } else {
        throw new Error("Failed to get video preview URL");
      }

    } catch (error) {
      console.error("Error uploading video:", error);
      toast.error("Failed to upload video. Please try again.");
      setStage("preview");
    } finally {
      setIsSaving(false);
      setProcessingStatus(null);
    }
  }, [recordedVideoUrl, recordedBlob, uploadedFile]);

  // Confirm and save to profile
  const handleConfirmPost = useCallback(() => {
    if (!uploadedPath) {
      toast.error("No video to save");
      return;
    }

    onSave?.(uploadedPath, vibeCaption);

    // Clean up
    onOpenChange(false);
    setStage("idle");
    setCountdown(RECORDING_DURATION);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    setRecordedBlob(null);
    setUploadedFile(null);
    setFinalVideoUrl(null);
    setUploadedPath(null);
    setProcessingStatus(null);
    setVibeCaption("");

    toast.success("Vibe video posted to your profile!");
  }, [onSave, onOpenChange, recordedVideoUrl, uploadedPath, vibeCaption]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onOpenChange(false);
    setStage("idle");
    setCountdown(RECORDING_DURATION);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
    }
    setRecordedVideoUrl(null);
    setRecordedBlob(null);
    setUploadedFile(null);
    setFinalVideoUrl(null);
    setUploadedPath(null);
  }, [onOpenChange, recordedVideoUrl, isSaving]);

  const toggleMic = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  }, []);

  const toggleCamera = useCallback(() => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      toast.error("Please select a video file");
      return;
    }

    // Validate file size (50MB max)
    if (file.size > MAX_UPLOAD_SIZE) {
      toast.error("Video too large. Please trim it to under 50MB before uploading.");
      return;
    }

    const url = URL.createObjectURL(file);
    
    // Check video duration
    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";
    tempVideo.src = url;
    tempVideo.onloadedmetadata = () => {
      const duration = tempVideo.duration;
      URL.revokeObjectURL(tempVideo.src);

      if (duration > 60) {
        toast.error("Video must be under 60 seconds. Please trim it first.");
        URL.revokeObjectURL(url);
        return;
      }

      setOriginalVideoDuration(duration);
      setRecordedVideoUrl(url);
      setUploadedFile(file);
      
      if (duration > MAX_CLIP_DURATION) {
        setNeedsTrimming(true);
        setStage("trimming");
      } else {
        setNeedsTrimming(false);
        setStage("preview");
      }
    };
    tempVideo.onerror = () => {
      setRecordedVideoUrl(url);
      setUploadedFile(file);
      setStage("preview");
    };
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
    if (videoEl) {
      if (videoEl.paused) {
        videoEl.play();
        setIsVideoPlaying(true);
      } else {
        videoEl.pause();
        setIsVideoPlaying(false);
      }
    }
  }, [stage]);

  const progress = ((RECORDING_DURATION - countdown) / RECORDING_DURATION) * 100;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-full h-full sm:max-w-md sm:h-[90vh] p-0 border-none bg-background overflow-hidden">
        <div className="relative w-full h-full flex flex-col">
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
              {/* Final uploaded video review */}
              {stage === "posted" && finalVideoUrl ? (
                <video
                  ref={finalVideoRef}
                  src={finalVideoUrl}
                  className="w-full h-full object-cover"
                  autoPlay
                  loop
                  playsInline
                  onClick={toggleVideoPlayback}
                />
              ) : /* Local preview before upload */
              stage === "preview" && recordedVideoUrl ? (
                <video
                  ref={reviewVideoRef}
                  src={recordedVideoUrl}
                  className="w-full h-full object-contain"
                  autoPlay
                  loop
                  playsInline
                  onClick={toggleVideoPlayback}
                />
              ) : /* Uploading state - show the local video */
              stage === "uploading" && recordedVideoUrl ? (
                <video
                  src={recordedVideoUrl}
                  className="w-full h-full object-cover opacity-50"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <video
                  ref={videoRef}
                  className={cn(
                    "w-full h-full object-cover",
                    facingMode === 'user' && "scale-x-[-1]"
                  )}
                  autoPlay
                  muted
                  playsInline
                />
              )}

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
              <motion.div
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="absolute top-16 left-4 right-4 z-20"
              >
                <button
                  onClick={() => setIsEditingCaption(true)}
                  className="glass-card px-4 py-3 rounded-2xl text-center w-full hover:bg-secondary/50 transition-colors"
                >
                  <p className="text-sm text-muted-foreground">What are you</p>
                  {vibeCaption ? (
                    <p className="text-lg font-display font-bold gradient-text truncate">
                      {vibeCaption}
                    </p>
                  ) : (
                    <p className="text-lg font-display font-bold gradient-text">
                      Vibing on?
                    </p>
                  )}
                  {(stage === "idle" || stage === "preview" || stage === "posted") && (
                    <p className="text-xs text-muted-foreground/60 mt-1">Tap to edit</p>
                  )}
                </button>
              </motion.div>

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
              {stage === "posted" && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-44 left-4 right-4 z-20"
                >
                  <div className="glass-card p-3 rounded-xl text-center">
                    <p className="text-xs text-muted-foreground">
                      ✨ This is how others will see your Vibe
                    </p>
                  </div>
                </motion.div>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleCamera}
                      className="rounded-full w-12 h-12 bg-secondary"
                    >
                      <SwitchCamera className="w-5 h-5" />
                    </Button>
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
                    className="flex flex-col items-center gap-2"
                  >
                    <motion.div
                      animate={{
                        boxShadow: [
                          "0 0 0 0 hsl(142 76% 36% / 0.4)",
                          "0 0 0 10px hsl(142 76% 36% / 0)",
                        ],
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center"
                    >
                      <Check className="w-7 h-7 text-white" />
                    </motion.div>
                    <span className="text-xs text-green-400 font-medium">Post Vibe</span>
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
