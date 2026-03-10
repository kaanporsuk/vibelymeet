import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, SwitchCamera, Circle, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface VideoMessageRecorderProps {
  onRecordingComplete: (videoBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

const MAX_DURATION = 59;

const VideoMessageRecorder = ({ onRecordingComplete, onCancel }: VideoMessageRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);
  const mimeTypeRef = useRef('');

  // Check camera count
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      setHasMultipleCameras(videoInputs.length > 1);
    }).catch(() => {});
  }, []);

  const startCamera = useCallback(async (facing: 'user' | 'environment') => {
    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
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
    } catch (err) {
      toast.error('Could not access camera');
      onCancel();
      return null;
    }
  }, [onCancel]);

  // Init camera on mount
  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flipCamera = async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacing);
    const stream = await startCamera(newFacing);
    // If recording, swap the stream in the recorder
    if (isRecording && mediaRecorderRef.current && stream) {
      // Can't swap stream mid-record easily, so just keep going with old tracks
      // The video preview updates but recording continues with original stream
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    // Safari supports MP4 recording natively and plays it back correctly.
    // Chrome/Firefox support WebM. Prioritize each browser's native format.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const supportedTypes = isSafari
      ? [
          'video/mp4',
          'video/webm;codecs=h264',
          'video/webm',
        ]
      : [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4',
        ];
    let mimeType = '';
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
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
      onRecordingComplete(blob, durationRef.current);
    };

    recorder.start(100);
    setIsRecording(true);
    setDuration(0);

    timerRef.current = setInterval(() => {
      setDuration(prev => {
        const next = prev + 1;
        durationRef.current = next;
        if (next >= MAX_DURATION) {
          stopRecording();
        }
        return next;
      });
    }, 1000);

    try { navigator.vibrate?.(50); } catch {}
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    try { navigator.vibrate?.([30, 20, 30]); } catch {}
  }, []);

  const handleCancel = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    onCancel();
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      {/* Camera preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "absolute inset-0 w-full h-full object-cover",
          facingMode === 'user' && "scale-x-[-1]"
        )}
      />

      {/* Overlay controls */}
      <div className="relative z-10 flex flex-col h-full">
        {/* Top bar */}
        <div className="flex items-center justify-between p-4 pt-safe">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleCancel}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
          >
            <X className="w-5 h-5 text-white" />
          </motion.button>

          {/* Timer */}
          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm"
              >
                <motion.div
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-2.5 h-2.5 rounded-full bg-red-500"
                />
                <span className="font-mono text-sm font-semibold text-white">
                  {formatDuration(duration)}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {hasMultipleCameras ? (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={flipCamera}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
            >
              <SwitchCamera className="w-5 h-5 text-white" />
            </motion.button>
          ) : (
            <div className="w-10" />
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom controls */}
        <div className="flex flex-col items-center gap-3 pb-safe p-6">
          {isRecording && (
            <p className="text-white/70 text-xs">
              {MAX_DURATION - duration}s remaining
            </p>
          )}

          {/* Record / Stop button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={isRecording ? stopRecording : startRecording}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center"
          >
            {isRecording ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-8 h-8 rounded-md bg-red-500"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-red-500" />
            )}
          </motion.button>

          {!isRecording && (
            <p className="text-white/60 text-xs">Tap to record · Up to {MAX_DURATION}s</p>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default VideoMessageRecorder;
