import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, Video, Mic, MicOff, Upload, Loader2, Play, Pause } from "lucide-react";
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

interface VibeStudioModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (videoUrl: string) => void;
  existingVideoUrl?: string;
}

const COACH_TIPS = [
  "Seeking a serious partner?",
  "Obsessed with a new hobby?",
  "Just here for the event?",
  "What song is stuck in your head?",
  "What's your weekend obsession?",
];

const RECORDING_DURATION = 15;

export const VibeStudioModal = ({
  open,
  onOpenChange,
  onSave,
  existingVideoUrl,
}: VibeStudioModalProps) => {
  // Stages: idle → recording → preview (local) → uploading → posted (final review)
  const [stage, setStage] = useState<"idle" | "recording" | "preview" | "uploading" | "posted">("idle");
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
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(true);
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

  // Request camera/mic permissions when modal opens
  useEffect(() => {
    if (!open) return;

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 } },
          audio: true,
        });
        streamRef.current = stream;
        setHasPermission(true);

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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [open]);

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

    const preferredTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ];

    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blobType = mimeType?.startsWith("video/") ? mimeType.split(";")[0] : "video/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedVideoUrl(url);
        setStage("preview"); // Go to local preview first
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
        try {
          videoToUpload = await compressVideo(videoToUpload, {
            maxWidth: 720,
            maxHeight: 1280,
            videoBitrate: 1500000,
            onProgress: (p) => setProcessingStatus(`Compressing: ${Math.round(p)}%`),
          });
        } catch (compressError) {
          console.warn("Compression failed, uploading original:", compressError);
        }
      }

      // Generate thumbnail (best-effort)
      setProcessingStatus("Generating thumbnail...");
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

      // Upload video (store PATH in DB; bucket is private)
      setProcessingStatus("Uploading video...");
      const result = await uploadVideo(videoToUpload, user.id);
      setUploadedPath(result.path);

      // Get signed URL for playback
      setProcessingStatus("Preparing preview...");
      const signedUrl = await getSignedVideoUrl(result.path);
      if (signedUrl) {
        setFinalVideoUrl(signedUrl);
        setStage("posted"); // Move to final review stage
        setIsVideoPlaying(true);
      } else {
        throw new Error("Failed to get video preview URL");
      }

    } catch (error) {
      console.error("Error uploading video:", error);
      toast.error("Failed to upload video. Please try again.");
      setStage("preview"); // Go back to preview on error
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

    onSave?.(uploadedPath);

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

    toast.success("Vibe video posted to your profile!");
  }, [onSave, onOpenChange, recordedVideoUrl, uploadedPath]);

  const handleClose = useCallback(() => {
    if (isSaving) return; // Don't close while saving
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

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      toast.error("Please select a video file");
      return;
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Video must be under 50MB");
      return;
    }

    const url = URL.createObjectURL(file);
    setRecordedVideoUrl(url);
    setUploadedFile(file);
    setStage("preview"); // Go to local preview first
  }, []);

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

          {/* Camera Preview (9:16 aspect ratio simulation) */}
          {hasPermission !== false && (
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
                  className="w-full h-full object-cover"
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
                  className="w-full h-full object-cover mirror"
                  autoPlay
                  muted
                  playsInline
                />
              )}

              {/* Dark overlay for non-preview states */}
              {stage !== "preview" && stage !== "posted" && (
                <div className="absolute inset-0 bg-background/20" />
              )}

              {/* Uploading overlay */}
              {stage === "uploading" && (
                <div className="absolute inset-0 bg-background/60 flex flex-col items-center justify-center gap-4 z-10">
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                  <p className="text-sm text-foreground font-medium">
                    {processingStatus || "Processing..."}
                  </p>
                </div>
              )}

              {/* Top HUD - The Question */}
              <motion.div
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="absolute top-16 left-4 right-4 z-20"
              >
                <div className="glass-card px-4 py-3 rounded-2xl text-center">
                  <p className="text-sm text-muted-foreground">What are you</p>
                  <p className="text-lg font-display font-bold gradient-text">
                    Vibing on?
                  </p>
                </div>
              </motion.div>

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

                  {/* Mic Toggle */}
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

        <style>{`
          .mirror {
            transform: scaleX(-1);
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
};

export default VibeStudioModal;
