import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { Mic, Trash2, Lock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onCancel?: () => void;
  className?: string;
}

const VoiceRecorder = ({ onRecordingComplete, onCancel, className }: VoiceRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(20).fill(0.1));
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const mimeTypeRef = useRef<string>('');
  const durationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Request wake lock to prevent screen sleep
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.log('Wake lock not available');
      }
    }
  };

  // Release wake lock
  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

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

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Set up audio analysis
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Detect best supported MIME type (Safari doesn't support webm)
      const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
        'audio/mpeg',
      ];
      let mimeType = '';
      for (const type of supportedTypes) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      mimeTypeRef.current = mimeType;

      // Set up media recorder with detected MIME type
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      durationRef.current = 0;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blobType = mimeTypeRef.current || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
        onRecordingComplete(audioBlob, durationRef.current);
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setDuration(0);

      // Start timer — update both state and ref
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
      requestWakeLock();

      // Haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    } catch (err) {
      toast.error('Could not access microphone');
    }
  };

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    releaseWakeLock();
    setIsRecording(false);
    setIsLocked(false);
    setDragOffset({ x: 0, y: 0 });
    setAudioLevels(new Array(20).fill(0.1));
  }, []);

  // Cancel recording
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    releaseWakeLock();
    setIsRecording(false);
    setIsLocked(false);
    setDragOffset({ x: 0, y: 0 });
    setAudioLevels(new Array(20).fill(0.1));
    
    toast.info('Recording discarded', {
      icon: <Trash2 className="w-4 h-4 text-destructive" />,
    });
    
    onCancel?.();
  }, [onCancel]);

  // Handle drag
  const handleDrag = (_: any, info: PanInfo) => {
    setDragOffset({ x: info.offset.x, y: info.offset.y });
  };

  // Handle drag end
  const handleDragEnd = (_: any, info: PanInfo) => {
    // Slide up to lock
    if (info.offset.y < -60 && !isLocked) {
      setIsLocked(true);
      setDragOffset({ x: 0, y: 0 });
      if ('vibrate' in navigator) {
        navigator.vibrate([30, 20, 30]);
      }
      return;
    }

    // Slide left to cancel
    if (info.offset.x < -80) {
      cancelRecording();
      return;
    }

    setDragOffset({ x: 0, y: 0 });
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      releaseWakeLock();
    };
  }, []);

  // Cancel slide threshold
  const cancelThreshold = -80;
  const lockThreshold = -60;
  const showCancelHint = dragOffset.x < cancelThreshold / 2;
  const showLockHint = dragOffset.y < lockThreshold / 2 && !isLocked;

  if (!isRecording) {
    return (
      <motion.button
        whileTap={{ scale: 0.9 }}
        onPointerDown={startRecording}
        className={cn(
          "shrink-0 w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-lg cursor-pointer select-none touch-none",
          className
        )}
      >
        <Mic className="w-5 h-5" />
      </motion.button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-safe pointer-events-none">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm pointer-events-auto"
        onClick={isLocked ? undefined : cancelRecording}
      />

      {/* Recording interface */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="relative w-full max-w-lg mx-4 mb-4 pointer-events-auto"
      >
        {/* Lock indicator */}
        <AnimatePresence>
          {showLockHint && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute -top-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
            >
              <div className="w-12 h-12 rounded-full bg-secondary/80 backdrop-blur-sm flex items-center justify-center border border-border">
                <Lock className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Release to lock</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cancel indicator */}
        <AnimatePresence>
          {showCancelHint && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 0.5 }}
                className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center"
              >
                <Trash2 className="w-5 h-5 text-destructive" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main recording card */}
        <div className="glass-card rounded-3xl border border-border/50 p-4 shadow-2xl">
          {/* Waveform visualization */}
          <div className="flex items-center justify-center gap-0.5 h-16 mb-4">
            {audioLevels.map((level, i) => (
              <motion.div
                key={i}
                className="w-1.5 rounded-full bg-gradient-to-t from-pink-500 to-pink-400"
                animate={{
                  height: `${level * 100}%`,
                }}
                transition={{
                  duration: 0.1,
                  ease: 'linear',
                }}
                style={{ minHeight: '8px' }}
              />
            ))}
          </div>

          {/* Duration and controls */}
          <div className="flex items-center justify-between">
            {/* Cancel button (locked mode) */}
            {isLocked ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={cancelRecording}
                className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center text-destructive"
              >
                <X className="w-5 h-5" />
              </motion.button>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <motion.span
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  ← Slide to cancel
                </motion.span>
              </div>
            )}

            {/* Timer */}
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-3 h-3 rounded-full bg-pink-500"
              />
              <span className="font-mono text-lg font-semibold text-foreground">
                {formatDuration(duration)}
              </span>
            </div>

            {/* Send/Lock button */}
            <motion.button
              drag={!isLocked}
              dragConstraints={{ top: -100, bottom: 0, left: -150, right: 0 }}
              dragElastic={0.1}
              onDrag={handleDrag}
              onDragEnd={handleDragEnd}
              whileTap={isLocked ? { scale: 0.9 } : undefined}
              onClick={isLocked ? stopRecording : undefined}
              onPointerUp={!isLocked ? stopRecording : undefined}
              animate={{
                x: isLocked ? 0 : dragOffset.x,
                y: isLocked ? 0 : dragOffset.y,
              }}
              className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center shadow-lg touch-none select-none transition-colors",
                isLocked 
                  ? "bg-gradient-to-r from-neon-violet to-neon-pink cursor-pointer" 
                  : "bg-gradient-to-r from-pink-500 to-pink-400"
              )}
            >
              {isLocked ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-6 h-6 rounded bg-white"
                />
              ) : (
                <Mic className="w-6 h-6 text-white" />
              )}
            </motion.button>
          </div>

          {/* Lock hint */}
          {!isLocked && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-3 text-xs text-muted-foreground"
            >
              ↑ Slide up to lock • Release to send
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default VoiceRecorder;
