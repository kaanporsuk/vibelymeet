import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, SwitchCamera, Film, Sparkles, Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  VIBE_CLIP_MAX_DURATION_SEC,
  VIBE_CLIP_RECORDER_IDLE_HINT,
  VIBE_CLIP_RECORDER_RECORDING_REMAINING,
  VIBE_CLIP_RECORDER_SOFT_FRAMING,
  VIBE_CLIP_RECORDER_TAGLINE,
  VIBE_CLIP_WEB_TOAST_CAMERA_DENIED,
  VIBE_CLIP_WEB_TOAST_CAMERA_GENERIC,
  VIBE_CLIP_WEB_TOAST_CAMERA_SWITCH_UNAVAILABLE,
  VIBE_CLIP_WEB_TOAST_UNSUPPORTED,
} from "../../../shared/chat/vibeClipCaptureCopy";
import { capturePromptForSeed } from "../../../shared/chat/vibeClipPrompts";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import { durationBucketFromSeconds } from "../../../shared/chat/vibeClipAnalytics";
import {
  prepareWebVibeClipLibraryFile,
  type WebVibeClipCompleteMeta,
} from "@/lib/webVibeClipLibraryUpload";
import type { MediaCaptions } from "../../../shared/media/captions";

type BrowserSpeechRecognitionAlternative = {
  transcript?: string;
};

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  [index: number]: BrowserSpeechRecognitionAlternative | undefined;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult | undefined;
  };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type PendingRecording = {
  blob: Blob;
  url: string;
  duration: number;
  meta: WebVibeClipCompleteMeta;
  captionText: string;
};

interface VideoMessageRecorderProps {
  onRecordingComplete: (videoBlob: Blob, duration: number, meta?: WebVibeClipCompleteMeta) => void;
  onCancel: () => void;
  /** Rotating capture idea; e.g. match id from chat. */
  promptSeed?: string;
  /** Keeps legacy recorder upload available by default; chat can move upload to the pre-sheet. */
  showLibraryUpload?: boolean;
}

const VideoMessageRecorder = ({
  onRecordingComplete,
  onCancel,
  promptSeed,
  showLibraryUpload = true,
}: VideoMessageRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [duration, setDuration] = useState(0);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<PendingRecording | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);
  const mimeTypeRef = useRef("");
  const captionSegmentsRef = useRef<string[]>([]);
  const captionInterimRef = useRef("");
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechRecognitionStoppingRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const pendingRecordingUrlRef = useRef<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const captureSpark = useMemo(
    () => capturePromptForSeed(`${promptSeed ?? 'web'}|${Date.now()}`),
    // New spark each time the recorder opens (component mounts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const refreshCameraCount = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setHasMultipleCameras(false);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(videoInputs.length > 1);
    } catch {
      setHasMultipleCameras(false);
    }
  }, []);

  const stopCaptionCapture = useCallback((mode: "stop" | "abort" = "stop") => {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    speechRecognitionStoppingRef.current = true;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      if (mode === "abort") recognition.abort();
      else recognition.stop();
    } catch {
      // Browser speech APIs can throw if recognition already stopped.
    }
  }, []);

  const captionsFromTranscript = useCallback((): MediaCaptions | null => {
    const text = [...captionSegmentsRef.current, captionInterimRef.current]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5_000);
    if (!text) return null;
    const language = typeof navigator !== "undefined" && navigator.language ? navigator.language.slice(0, 16) : undefined;
    return { text, ...(language ? { language } : {}) };
  }, []);

  const startCaptionCapture = useCallback(() => {
    captionSegmentsRef.current = [];
    captionInterimRef.current = "";
    if (typeof window === "undefined") return;
    const scope = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognitionCtor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      trackEvent("caption_capture_unavailable", {
        surface: "chat_vibe_clip_recorder",
        reason: "speech_recognition_missing",
      });
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        const next = [...captionSegmentsRef.current];
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim();
          if (result?.isFinal && transcript) next.push(transcript);
          else if (transcript) interim = transcript;
        }
        captionSegmentsRef.current = next;
        captionInterimRef.current = interim;
      };
      recognition.onerror = () => {
        trackEvent("caption_capture_failed", { surface: "chat_vibe_clip_recorder" });
      };
      recognition.onend = () => {
        if (!recordingActiveRef.current || speechRecognitionStoppingRef.current) return;
        try {
          recognition.start();
        } catch {
          // Some browsers reject immediate restarts; the recording continues without captions.
          trackEvent("caption_capture_aborted", { surface: "chat_vibe_clip_recorder", reason: "restart_failed" });
        }
      };
      speechRecognitionStoppingRef.current = false;
      speechRecognitionRef.current = recognition;
      recognition.start();
      trackEvent("caption_capture_started", { surface: "chat_vibe_clip_recorder" });
    } catch {
      speechRecognitionRef.current = null;
      trackEvent("caption_capture_unavailable", {
        surface: "chat_vibe_clip_recorder",
        reason: "speech_recognition_start_failed",
      });
    }
  }, []);

  const startCamera = useCallback(
    async (facing: "user" | "environment", opts?: { cancelOnError?: boolean; silentError?: boolean }) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraReady(false);
        if (!opts?.silentError) toast.error(VIBE_CLIP_WEB_TOAST_UNSUPPORTED);
        if (opts?.cancelOnError !== false) onCancel();
        return null;
      }

      const previousStream = streamRef.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 480 } },
          audio: true,
        });
        previousStream?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        setCameraReady(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        void refreshCameraCount();
        return stream;
      } catch (err: unknown) {
        if (!opts?.silentError) {
          const name = err instanceof Error ? err.name : "";
          if (name === "AbortError" || name === "NotAllowedError") {
            toast.error(VIBE_CLIP_WEB_TOAST_CAMERA_DENIED);
          } else if (name === "NotSupportedError") {
            toast.error(VIBE_CLIP_WEB_TOAST_UNSUPPORTED);
          } else {
            toast.error(VIBE_CLIP_WEB_TOAST_CAMERA_GENERIC);
          }
        }
        if (!previousStream) setCameraReady(false);
        if (opts?.cancelOnError !== false) onCancel();
        return null;
      }
    },
    [onCancel, refreshCameraCount],
  );

  useEffect(() => {
    startCamera(facingMode, { cancelOnError: false });
    return () => {
      recordingActiveRef.current = false;
      stopCaptionCapture("abort");
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (pendingRecordingUrlRef.current) URL.revokeObjectURL(pendingRecordingUrlRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refreshCameraCount();
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    const handleDeviceChange = () => void refreshCameraCount();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshCameraCount]);

  const flipCamera = async () => {
    if (isRecording || isProcessingUpload) return;
    const newFacing = facingMode === "user" ? "environment" : "user";
    const stream = await startCamera(newFacing, { cancelOnError: false, silentError: true });
    if (stream) {
      setFacingMode(newFacing);
      return;
    }
    toast.error(VIBE_CLIP_WEB_TOAST_CAMERA_SWITCH_UNAVAILABLE);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isRecording || isProcessingUpload) return;

    setIsProcessingUpload(true);
    let completed = false;
    try {
      const prepared = await prepareWebVibeClipLibraryFile(file);
      trackVibeClipEvent("clip_record_started", {
        capture_source: "library",
        is_sender: true,
      });
      trackVibeClipEvent("clip_record_completed", {
        capture_source: "library",
        duration_bucket: durationBucketFromSeconds(prepared.durationSeconds),
        is_sender: true,
      });
      onRecordingComplete(prepared.file, prepared.durationSeconds, prepared.meta);
      completed = true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read this video. Choose another clip.");
    } finally {
      if (!completed) setIsProcessingUpload(false);
    }
  };

  const startRecording = () => {
    if (isProcessingUpload) return;
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
    recordingActiveRef.current = true;
    startCaptionCapture();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      recordingActiveRef.current = false;
      stopCaptionCapture();
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || "video/webm" });
      const captions = captionsFromTranscript();
      const captionText = typeof captions === "string" ? captions : captions?.text ?? "";
      trackEvent(captionText ? "caption_capture_succeeded" : "caption_capture_aborted", {
        surface: "chat_vibe_clip_recorder",
        has_text: !!captionText,
      });
      const url = URL.createObjectURL(blob);
      pendingRecordingUrlRef.current = url;
      setPendingRecording({
        blob,
        url,
        duration: durationRef.current,
        captionText,
        meta: {
        captureSource: "web_recorder",
        mimeType: mimeTypeRef.current || undefined,
          captions,
        },
      });
    };

    recorder.start(100);
    setIsRecording(true);
    setDuration(0);
    trackVibeClipEvent("clip_record_started", {
      capture_source: "web_recorder",
      is_sender: true,
    });

    timerRef.current = setInterval(() => {
      setDuration((prev) => {
        const next = prev + 1;
        durationRef.current = next;
        if (next >= VIBE_CLIP_MAX_DURATION_SEC) {
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
      trackVibeClipEvent("clip_record_completed", {
        capture_source: "web_recorder",
        duration_bucket: durationBucketFromSeconds(durationRef.current),
        is_sender: true,
      });
      mediaRecorderRef.current.stop();
    }
    recordingActiveRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setCameraReady(false);
    setIsRecording(false);
    try {
      navigator.vibrate?.([30, 20, 30]);
    } catch {}
  }, []);

  const handleCancel = () => {
    recordingActiveRef.current = false;
    stopCaptionCapture("abort");
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
    setCameraReady(false);
    if (pendingRecording?.url) URL.revokeObjectURL(pendingRecording.url);
    pendingRecordingUrlRef.current = null;
    setPendingRecording(null);
    onCancel();
  };

  const sendPendingRecording = () => {
    if (!pendingRecording) return;
    const captionText = pendingRecording.captionText.replace(/\s+/g, " ").trim().slice(0, 5_000);
    const language = typeof navigator !== "undefined" && navigator.language ? navigator.language.slice(0, 16) : undefined;
    onRecordingComplete(pendingRecording.blob, pendingRecording.duration, {
      ...pendingRecording.meta,
      captions: captionText ? { text: captionText, ...(language ? { language } : {}) } : null,
    });
    URL.revokeObjectURL(pendingRecording.url);
    pendingRecordingUrlRef.current = null;
    setPendingRecording(null);
  };

  const retakePendingRecording = () => {
    if (pendingRecording?.url) URL.revokeObjectURL(pendingRecording.url);
    pendingRecordingUrlRef.current = null;
    setPendingRecording(null);
    setDuration(0);
    durationRef.current = 0;
    void startCamera(facingMode, { cancelOnError: false });
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      {showLibraryUpload ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={handleFileUpload}
          data-testid="vibe-clip-recorder-library-input"
        />
      ) : null}

      {pendingRecording ? (
        <video
          src={pendingRecording.url}
          autoPlay={!prefersReducedMotion}
          controls={prefersReducedMotion}
          playsInline
          muted
          loop
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
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
      )}

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
            whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
            onClick={handleCancel}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center ring-1 ring-white/10"
            type="button"
            aria-label="Close"
            data-testid="vibe-clip-recorder-close"
          >
            <X className="w-5 h-5 text-white" />
          </motion.button>

          <AnimatePresence mode="wait">
            {isRecording ? (
              <motion.div
                key="timer"
                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/10"
              >
                <motion.div
                  animate={prefersReducedMotion ? undefined : { scale: [1, 1.3, 1] }}
                  transition={prefersReducedMotion ? undefined : { repeat: Infinity, duration: 1 }}
                  className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]"
                />
                <span className="font-mono text-sm font-semibold text-white tabular-nums">
                  {formatDuration(duration)}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="brand"
                initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/25 backdrop-blur-md border border-violet-400/35 shadow-[0_0_20px_rgba(139,92,246,0.25)]"
              >
                <Film className="w-3.5 h-3.5 text-violet-200" />
                <span className="text-xs font-bold text-violet-100 tracking-wide">Vibe Clip</span>
              </motion.div>
            )}
          </AnimatePresence>

          {hasMultipleCameras && !isRecording ? (
            <motion.button
              whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
              onClick={flipCamera}
              disabled={isProcessingUpload}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center ring-1 ring-white/10 disabled:pointer-events-none disabled:opacity-45"
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
        {!isRecording && !pendingRecording && (
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
            <p className="text-center text-[11px] text-white/55 max-w-[18rem] mt-2 leading-snug">
              {captureSpark}
            </p>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-3 pb-safe p-6">
          {pendingRecording ? (
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/55 p-4 backdrop-blur-md">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Captions</p>
              <textarea
                value={pendingRecording.captionText}
                onChange={(event) =>
                  setPendingRecording((recording) =>
                    recording ? { ...recording, captionText: event.target.value.slice(0, 5_000) } : recording,
                  )
                }
                placeholder="No captions captured. Add them before sending."
                className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={retakePendingRecording}
                  className="h-10 flex-1 rounded-full bg-white/10 px-4 text-xs font-semibold text-white/80 ring-1 ring-white/15"
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={sendPendingRecording}
                  className="h-10 flex-1 rounded-full bg-violet-500 px-4 text-xs font-semibold text-white"
                >
                  Send clip
                </button>
              </div>
            </div>
          ) : isRecording && (
            <p className="text-white/80 text-xs font-medium">
              {VIBE_CLIP_RECORDER_RECORDING_REMAINING(VIBE_CLIP_MAX_DURATION_SEC - duration)}
            </p>
          )}

          {!pendingRecording ? (
          <motion.button
            whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isRecording && (!cameraReady || isProcessingUpload)}
            className={cn(
              "w-[5.25rem] h-[5.25rem] rounded-full border-[5px] flex items-center justify-center transition-shadow disabled:pointer-events-none disabled:opacity-55",
              isRecording
                ? "border-white shadow-[0_0_28px_rgba(255,255,255,0.2)]"
                : "border-violet-400/90 shadow-[0_0_32px_rgba(139,92,246,0.45)]",
            )}
            type="button"
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            data-testid={isRecording ? "vibe-clip-recorder-stop" : "vibe-clip-recorder-start"}
          >
            {isRecording ? (
              <motion.div
                initial={prefersReducedMotion ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                className="w-8 h-8 rounded-md bg-red-500 shadow-lg"
              />
            ) : (
              <div className="w-[3.35rem] h-[3.35rem] rounded-full bg-gradient-to-br from-violet-400 to-violet-600 shadow-inner" />
            )}
          </motion.button>
          ) : null}

          {!isRecording && !pendingRecording && (
            <>
              {showLibraryUpload ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingUpload}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white/10 px-4 text-xs font-semibold text-white/85 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-60"
                  aria-label="Upload an existing Vibe Clip"
                  data-testid="vibe-clip-recorder-library-option"
                >
                  {isProcessingUpload ? (
                    <Loader2 className={cn("h-4 w-4", !prefersReducedMotion && "animate-spin")} aria-hidden />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden />
                  )}
                  Upload
                </button>
              ) : null}
              <p className="text-white/55 text-[11px] text-center max-w-xs leading-relaxed">
                {VIBE_CLIP_RECORDER_SOFT_FRAMING}
              </p>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default VideoMessageRecorder;
