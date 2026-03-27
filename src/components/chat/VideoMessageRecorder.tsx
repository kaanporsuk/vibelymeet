import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, SwitchCamera, Film, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  VIBE_CLIP_RECORDER_IDLE_HINT,
  VIBE_CLIP_RECORDER_RECORDING_REMAINING,
  VIBE_CLIP_RECORDER_TAGLINE,
  VIBE_CLIP_WEB_TOAST_CAMERA_DENIED,
  VIBE_CLIP_WEB_TOAST_CAMERA_GENERIC,
  VIBE_CLIP_WEB_TOAST_UNSUPPORTED,
} from "../../../shared/chat/vibeClipCaptureCopy";

interface VideoMessageRecorderProps {
  onRecordingComplete: (videoBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

const MAX_DURATION = 59;

const VideoMessageRecorder = ({ onRecordingComplete, onCancel }: VideoMessageRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);
  const mimeTypeRef = useRef("");

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        setHasMultipleCameras(videoInputs.length > 1);
      })
      .catch(() => {});
  }, []);

  const startCamera = useCallback(
    async (facing: "user" | "environment") => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 480 } },
          audio: true,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        return stream;
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError" || name === "NotAllowedError") {
          toast.error(VIBE_CLIP_WEB_TOAST_CAMERA_DENIED);
        } else if (name === "NotSupportedError") {
          toast.error(VIBE_CLIP_WEB_TOAST_UNSUPPORTED);
        } else {
          toast.error(VIBE_CLIP_WEB_TOAST_CAMERA_GENERIC);
        }
        onCancel();
        return null;
      }
    },
    [onCancel],
  );

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flipCamera = async () => {
    const newFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(newFacing);
    const stream = await startCamera(newFacing);
    if (isRecording && mediaRecorderRef.current && stream) {
      // Preview updates; recording continues on prior tracks
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const supportedTypes = isSafari
      ? ["video/mp4", "video/webm;codecs=h264", "video/webm"]
      : [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4",
        ];
    let mimeType = "";
    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }
    mimeTypeRef.current = mimeType;

    const options = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(stream, options);
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    durationRef.current = 0;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "video/webm" });
      onRecordingComplete(blob, durationRef.current);
    };

    recorder.start(100);
    setIsRecording(true);
    setDuration(0);

    timerRef.current = setInterval(() => {
      setDuration((prev) => {
        const next = prev + 1;
        durationRef.current = next;
        if (next >= MAX_DURATION) {
          stopRecording();
        }
        return next;
      });
    }, 1000);

    try {
      navigator.vibrate?.(50);
    } catch {}
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setIsRecording(false);
    try {
      navigator.vibrate?.([30, 20, 30]);
    } catch {}
  }, []);

  const handleCancel = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    onCancel();
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "absolute inset-0 w-full h-full object-cover",
          facingMode === "user" && "scale-x-[-1]",
        )}
      />

      {/* Cinematic bottom vignette + subtle side falloff */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/75"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-black via-black/50 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between p-4 pt-safe">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleCancel}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center ring-1 ring-white/10"
            type="button"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-white" />
          </motion.button>

          <AnimatePresence mode="wait">
            {isRecording ? (
              <motion.div
                key="timer"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/10"
              >
                <motion.div
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]"
                />
                <span className="font-mono text-sm font-semibold text-white tabular-nums">
                  {formatDuration(duration)}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="brand"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/25 backdrop-blur-md border border-violet-400/35 shadow-[0_0_20px_rgba(139,92,246,0.25)]"
              >
                <Film className="w-3.5 h-3.5 text-violet-200" />
                <span className="text-xs font-bold text-violet-100 tracking-wide">Vibe Clip</span>
              </motion.div>
            )}
          </AnimatePresence>

          {hasMultipleCameras ? (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={flipCamera}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center ring-1 ring-white/10"
              type="button"
              aria-label="Flip camera"
            >
              <SwitchCamera className="w-5 h-5 text-white" />
            </motion.button>
          ) : (
            <div className="w-10" />
          )}
        </div>

        {/* Center framing — idle only */}
        {!isRecording && (
          <div className="absolute left-0 right-0 top-[28%] flex flex-col items-center px-6 pointer-events-none">
            <div className="flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur-sm px-3 py-1.5 border border-white/15 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-200/90" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/90">
                {VIBE_CLIP_RECORDER_TAGLINE}
              </span>
            </div>
            <p className="text-center text-xs text-white/70 max-w-[17rem] leading-relaxed">
              {VIBE_CLIP_RECORDER_IDLE_HINT}
            </p>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-3 pb-safe p-6">
          {isRecording && (
            <p className="text-white/80 text-xs font-medium">
              {VIBE_CLIP_RECORDER_RECORDING_REMAINING(MAX_DURATION - duration)}
            </p>
          )}

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={isRecording ? stopRecording : startRecording}
            className={cn(
              "w-[5.25rem] h-[5.25rem] rounded-full border-[5px] flex items-center justify-center transition-shadow",
              isRecording
                ? "border-white shadow-[0_0_28px_rgba(255,255,255,0.2)]"
                : "border-violet-400/90 shadow-[0_0_32px_rgba(139,92,246,0.45)]",
            )}
            type="button"
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {isRecording ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-8 h-8 rounded-md bg-red-500 shadow-lg"
              />
            ) : (
              <div className="w-[3.35rem] h-[3.35rem] rounded-full bg-gradient-to-br from-violet-400 to-violet-600 shadow-inner" />
            )}
          </motion.button>

          {!isRecording && (
            <p className="text-white/55 text-[11px] text-center max-w-xs">
              Front camera first — flip if you want to show your world
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default VideoMessageRecorder;
