import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Video, Square, RotateCcw, Send, Mic, MicOff, Camera, CameraOff, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface VibeReplyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientName: string;
  recipientAvatar?: string;
  onSendReply: (videoBlob: Blob | null) => void;
  maxDuration?: number;
}

export function VibeReplyModal({
  open,
  onOpenChange,
  recipientName,
  recipientAvatar,
  onSendReply,
  maxDuration = 15,
}: VibeReplyModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const detectedMimeTypeRef = useRef<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(maxDuration);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);

  // Initialize camera
  const initCamera = useCallback(async () => {
    try {
      setError(null);
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, aspectRatio: { ideal: 9 / 16 }, width: { ideal: 720 } },
        audio: audioEnabled,
      });

      streamRef.current = stream;

      // Reset zoom to 1x if the browser supports it (iOS safety net)
      try {
        const videoTrack = stream.getVideoTracks()[0];
        const capabilities = (videoTrack as any).getCapabilities?.();
        if (capabilities?.zoom) {
          await (videoTrack as any).applyConstraints({ advanced: [{ zoom: 1 }] });
        }
      } catch (e) {
        // Not all browsers support zoom constraint
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      setCameraReady(true);
    } catch (err) {
      console.error('Camera error:', err);
      setError('Unable to access camera. Please check permissions.');
      setCameraReady(false);
    }
  }, [facingMode, audioEnabled]);

  // Start recording
  const startRecording = useCallback(() => {
    if (!streamRef.current) return;

    chunksRef.current = [];
    
    // Browser-conditional codec priority
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const preferredTypes = isSafari
      ? ["video/mp4", "video/mp4;codecs=avc1", "video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4", "video/mp4;codecs=avc1"];
    
    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
    detectedMimeTypeRef.current = mimeType || null;

    const mediaRecorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const detectedType = detectedMimeTypeRef.current;
      const blobType = detectedType?.startsWith("video/") ? detectedType.split(";")[0] : "video/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setRecording(true);
    setCountdown(maxDuration);
  }, [maxDuration]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  // Reset recording
  const resetRecording = useCallback(() => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedBlob(null);
    setRecordedUrl(null);
    setCountdown(maxDuration);
    initCamera();
  }, [recordedUrl, maxDuration, initCamera]);

  // Toggle camera
  const toggleCamera = useCallback(() => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!recording) return;

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          stopRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [recording, stopRecording]);

  // Initialize camera on open
  useEffect(() => {
    if (open && !recordedUrl) {
      initCamera();
    }

    return () => {
      // Stop MediaRecorder if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }
      // Stop ALL tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      // Clear video element
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [open, initCamera, recordedUrl]);

  // Handle send
  const handleSend = () => {
    onSendReply(recordedBlob);
    onOpenChange(false);
    resetRecording();
  };

  // Handle close
  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    resetRecording();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
        <div className="relative">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 z-20 p-4 bg-gradient-to-b from-background/90 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {recipientAvatar && (
                  <img 
                    src={recipientAvatar} 
                    alt={recipientName}
                    className="w-10 h-10 rounded-full border-2 border-primary object-cover"
                  />
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Replying to</p>
                  <p className="font-semibold text-foreground">{recipientName}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-full bg-background/50 hover:bg-background/80 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Video Preview */}
          <div className="relative aspect-[9/16] max-h-[70vh] bg-secondary overflow-hidden">
            <AnimatePresence mode="wait">
              {error ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 flex items-center justify-center text-center p-8"
                >
                  <div>
                    <CameraOff className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{error}</p>
                  </div>
                </motion.div>
              ) : recordedUrl ? (
                <video
                  key="playback"
                  src={recordedUrl}
                  className="w-full h-full object-cover"
                  controls
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                />
              ) : (
                <video
                  key="camera"
                  ref={videoRef}
                  className={cn(
                    "w-full h-full object-cover",
                    facingMode === 'user' && "scale-x-[-1]"
                  )}
                  playsInline
                  muted
                />
              )}
            </AnimatePresence>

            {/* Recording Timer */}
            {recording && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-20 left-1/2 -translate-x-1/2 z-10"
              >
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/90 text-destructive-foreground">
                  <motion.div
                    className="w-3 h-3 rounded-full bg-current"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  <Timer className="w-4 h-4" />
                  <span className="font-mono font-bold">{countdown}s</span>
                </div>
              </motion.div>
            )}

            {/* Progress Ring */}
            {recording && (
              <svg className="absolute top-16 left-1/2 -translate-x-1/2 w-24 h-24 -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="text-border/30"
                />
                <motion.circle
                  cx="48"
                  cy="48"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  className="text-primary"
                  initial={{ strokeDasharray: "276.46", strokeDashoffset: 0 }}
                  animate={{ strokeDashoffset: 276.46 }}
                  transition={{ duration: maxDuration, ease: "linear" }}
                />
              </svg>
            )}
          </div>

          {/* Controls */}
          <div className="p-4 space-y-4 bg-background">
            {!recordedUrl ? (
              <div className="flex items-center justify-center gap-4">
                {/* Audio Toggle */}
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setAudioEnabled(!audioEnabled)}
                  className={cn(
                    "p-3 rounded-full transition-colors",
                    audioEnabled ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </motion.button>

                {/* Record Button */}
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={recording ? stopRecording : startRecording}
                  disabled={!cameraReady}
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center transition-all",
                    recording 
                      ? "bg-destructive text-destructive-foreground" 
                      : "bg-gradient-to-br from-primary to-neon-cyan text-background",
                    !cameraReady && "opacity-50"
                  )}
                >
                  {recording ? (
                    <Square className="w-6 h-6" />
                  ) : (
                    <Video className="w-6 h-6" />
                  )}
                </motion.button>

                {/* Camera Toggle */}
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={toggleCamera}
                  className="p-3 rounded-full bg-muted text-foreground hover:bg-muted/80 transition-colors"
                >
                  <Camera className="w-5 h-5" />
                </motion.button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-4">
                {/* Redo */}
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={resetRecording}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-muted text-foreground hover:bg-muted/80 transition-colors"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span className="font-medium">Redo</span>
                </motion.button>

                {/* Send */}
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSend}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-neon-cyan text-background font-medium"
                >
                  <Send className="w-5 h-5" />
                  <span>Send Vibe</span>
                </motion.button>
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              {recording 
                ? 'Recording... Tap stop when done'
                : recordedUrl 
                  ? 'Review your vibe reply'
                  : `Record up to ${maxDuration} seconds`}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
