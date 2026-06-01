import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Mic, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { webMediaTranscode } from '@clientShared/media-sdk';
import {
  classifyMediaPermissionErrorWithBrowserState,
  mediaPermissionMessage,
  mediaPermissionTitle,
  type MediaPermissionResult,
} from '@clientShared/media/mediaPermissionResult';

/** Imperative handle so callers (e.g. the "Voice reply" clip CTA) can start recording
 * directly within the user-gesture call stack that getUserMedia requires. */
export interface VoiceRecorderHandle {
  startRecording: () => void;
}

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onRecordingStart?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  onUnavailable?: () => void;
  className?: string;
  variant?: "icon" | "action";
  label?: string;
}

const VoiceRecorder = forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(({
  onRecordingComplete,
  onRecordingStart,
  onCancel,
  disabled = false,
  onUnavailable,
  className,
  variant = "icon",
  label = "Voice Note",
}, ref) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(20).fill(0.1));
  const [permissionResult, setPermissionResult] = useState<MediaPermissionResult | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const durationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingSessionRef = useRef(0);
  const cancelledSessionRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  // Request wake lock to prevent screen sleep
  const requestWakeLock = useCallback(async (sessionId: number) => {
    if ('wakeLock' in navigator) {
      try {
        const wakeLock = await navigator.wakeLock.request('screen');
        const sessionStillActive =
          mountedRef.current &&
          recordingSessionRef.current === sessionId &&
          cancelledSessionRef.current !== sessionId &&
          mediaRecorderRef.current !== null;
        if (!sessionStillActive) {
          void wakeLock.release().catch(() => undefined);
          return;
        }
        wakeLockRef.current = wakeLock;
      } catch {
        // Wake lock is optional; recording still works when the browser denies it.
      }
    }
  }, []);

  // Release wake lock
  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  const stopLiveResources = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    releaseWakeLock();
  }, [releaseWakeLock]);

  const resetVisualState = useCallback(() => {
    setDuration(0);
    setAudioLevels(new Array(20).fill(0.1));
  }, []);

  // Analyze audio for visualization
  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Sample 20 frequency bands
    const levels: number[] = [];
    const step = Math.floor(dataArray.length / 20);

    for (let i = 0; i < 20; i++) {
      const value = dataArray[i * step] / 255;
      levels.push(Math.max(0.1, value));
    }

    setAudioLevels(levels);
    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, []);

  // Start recording (AbortError/NotSupportedError are expected when user denies or browser limits)
  const startRecording = async () => {
    if (disabled) {
      onUnavailable?.();
      return;
    }
    if (isRecording || mediaRecorderRef.current || startInFlightRef.current) return;
    startInFlightRef.current = true;
    setPermissionResult(null);

    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new DOMException('MediaRecorder is not available', 'NotSupportedError');
      }

      const recorderConfig = webMediaTranscode.voiceRecordingConfig();
      const stream = await navigator.mediaDevices.getUserMedia(recorderConfig.constraints);
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        startInFlightRef.current = false;
        return;
      }
      streamRef.current = stream;
      setPermissionResult(null);
      
      // Set up audio analysis
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new DOMException('AudioContext is not available', 'NotSupportedError');
      }
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream, recorderConfig.options);
      const sessionId = recordingSessionRef.current + 1;
      let stopHandled = false;
      recordingSessionRef.current = sessionId;
      cancelledSessionRef.current = null;
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];
      durationRef.current = 0;
      resetVisualState();

      mediaRecorder.ondataavailable = (event) => {
        if (cancelledSessionRef.current !== sessionId && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (stopHandled) return;
        stopHandled = true;
        const wasCancelled = cancelledSessionRef.current === sessionId;
        const recordedDuration = durationRef.current;
        const blobType = recorderConfig.mimeType || 'audio/webm';

        mediaRecorderRef.current = null;
        durationRef.current = 0;
        cancelledSessionRef.current = null;
        startInFlightRef.current = false;
        stopLiveResources();

        if (!wasCancelled && chunks.length > 0) {
          if (mountedRef.current) {
            setIsRecording(false);
            resetVisualState();
          }
          const audioBlob = new Blob(chunks, { type: blobType });
          onRecordingComplete(audioBlob, recordedDuration);
        } else if (!wasCancelled) {
          if (mountedRef.current) {
            setIsRecording(false);
            resetVisualState();
          }
          onCancel?.();
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      onRecordingStart?.();

      // Start timer; update both state and ref.
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          durationRef.current = next;
          return next;
        });
      }, 1000);

      // Start visualization
      analyzeAudio();

      // Request wake lock
      void requestWakeLock(sessionId);

      // Haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    } catch (err: unknown) {
      const permissionResult = await classifyMediaPermissionErrorWithBrowserState(err, "microphone");
      stopLiveResources();
      mediaRecorderRef.current = null;
      durationRef.current = 0;
      startInFlightRef.current = false;
      if (!mountedRef.current) return;
      setPermissionResult(permissionResult);
      resetVisualState();
      toast.error(mediaPermissionTitle(permissionResult), {
        description: mediaPermissionMessage(permissionResult),
        action:
          permissionResult.recoveryAction === "retry" || permissionResult.recoveryAction === "open_settings"
            ? {
                label: permissionResult.recoveryAction === "open_settings" ? "I updated settings" : "Try again",
                onClick: () => void startRecording(),
              }
            : undefined,
      });
    }
  };

  // Allow external callers (the "Voice reply" CTA) to begin recording. Invoked from the
  // CTA's onClick so the getUserMedia gesture requirement is still satisfied.
  useImperativeHandle(ref, () => ({
    startRecording: () => {
      void startRecording();
    },
  }));

  // Stop recording
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    startInFlightRef.current = false;
    setIsRecording(false);
    setAudioLevels(new Array(20).fill(0.1));
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch (err) {
      mediaRecorderRef.current = null;
      console.error('Failed to stop voice recording:', err);
      toast.error('Could not finish voice recording');
      onCancel?.();
    } finally {
      setPermissionResult(null);
      stopLiveResources();
    }
  }, [onCancel, stopLiveResources]);

  // Cancel recording
  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    cancelledSessionRef.current = recordingSessionRef.current;
    startInFlightRef.current = false;

    setIsRecording(false);
    setPermissionResult(null);
    resetVisualState();

    if (recorder) {
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          mediaRecorderRef.current = null;
        }
      } catch {
        mediaRecorderRef.current = null;
      }
    }

    stopLiveResources();

    toast.info('Recording discarded', {
      icon: <Trash2 className="w-4 h-4 text-destructive" />,
    });
    onCancel?.();
  }, [onCancel, resetVisualState, stopLiveResources]);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startInFlightRef.current = false;
      cancelledSessionRef.current = recordingSessionRef.current;
      stopLiveResources();
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        try {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        } catch {
          // Best-effort cleanup during unmount.
        }
        mediaRecorderRef.current = null;
      }
    };
  }, [stopLiveResources]);

  if (!isRecording) {
    const retryLabel = permissionResult?.recoveryAction === "open_settings" ? "I updated settings" : "Try again";
    return (
      <div className={cn("relative inline-flex", variant === "action" ? "w-full" : "shrink-0")}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => void startRecording()}
          disabled={disabled}
          aria-label={variant === "action" ? label : "Record voice message"}
          title={variant === "action" ? label : "Record voice message"}
          className={cn(
            variant === "action"
              ? "inline-flex h-11 min-h-11 w-full items-center justify-start gap-2 rounded-xl border border-border/35 bg-secondary/35 px-3 text-xs font-medium text-foreground/90 shadow-none transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:pointer-events-none disabled:opacity-45"
              : "shrink-0 w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-lg cursor-pointer select-none touch-none",
            disabled && "cursor-not-allowed opacity-45",
            className
          )}
        >
          <Mic className={cn(variant === "action" ? "h-4 w-4 shrink-0 text-primary" : "w-5 h-5")} />
          {variant === "action" ? <span className="truncate">{label}</span> : null}
        </motion.button>

        {permissionResult ? (
          <div
            role="status"
            className={cn(
              "absolute bottom-[calc(100%+0.5rem)] z-50 w-72 rounded-2xl border border-amber-300/25 bg-[#111116]/96 p-3 text-left shadow-2xl shadow-black/35 backdrop-blur-xl",
              variant === "action" ? "left-0" : "right-0",
            )}
            data-testid="voice-recorder-permission-recovery"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white">{mediaPermissionTitle(permissionResult)}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/68">
                  {mediaPermissionMessage(permissionResult)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPermissionResult(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
                aria-label="Dismiss microphone recovery"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void startRecording()}
              className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-full bg-white px-3 text-xs font-bold text-black transition hover:bg-white/90"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {retryLabel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pointer-events-none">
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="mx-auto flex w-full max-w-2xl items-center gap-3 rounded-[28px] border border-white/10 bg-[#101014]/95 p-2 shadow-2xl shadow-black/45 backdrop-blur-xl pointer-events-auto"
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => cancelRecording()}
          className="flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/80 transition-colors hover:bg-destructive/18 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/45"
          aria-label="Discard voice recording"
          title="Discard voice recording"
        >
          <Trash2 className="h-5 w-5" aria-hidden />
        </motion.button>

        <div className="min-w-0 flex-1 rounded-[22px] border border-white/[0.08] bg-white/[0.035] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <motion.span
                animate={{ scale: [1, 1.18, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-pink-500 shadow-[0_0_12px_rgba(236,72,153,0.8)]"
                aria-hidden
              />
              <span className="truncate text-sm font-semibold text-white/92">
                Recording
              </span>
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-white">
              {formatDuration(duration)}
            </span>
          </div>

          <div className="mt-2 flex h-7 items-center justify-center gap-0.5 overflow-hidden">
            {audioLevels.map((level, i) => (
              <motion.div
                key={i}
                className="w-1.5 rounded-full bg-gradient-to-t from-neon-violet to-neon-pink"
                animate={{
                  height: `${level * 100}%`,
                }}
                transition={{
                  duration: 0.1,
                  ease: 'linear',
                }}
                style={{ minHeight: '6px' }}
              />
            ))}
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={stopRecording}
          className="flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-neon-violet to-neon-pink text-white shadow-lg shadow-pink-500/25 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-pink/55"
          aria-label="Send voice recording"
          title="Send voice recording"
        >
          <Send className="h-5 w-5" aria-hidden />
        </motion.button>
      </motion.div>
    </div>
  );
});

VoiceRecorder.displayName = "VoiceRecorder";

export default VoiceRecorder;
