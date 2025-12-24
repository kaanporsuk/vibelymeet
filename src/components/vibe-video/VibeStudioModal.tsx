import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, Video, Mic, MicOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

// Mock recorded video URL
const MOCK_RECORDED_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

export const VibeStudioModal = ({
  open,
  onOpenChange,
  onSave,
  existingVideoUrl,
}: VibeStudioModalProps) => {
  const [stage, setStage] = useState<"idle" | "recording" | "review">("idle");
  const [countdown, setCountdown] = useState(RECORDING_DURATION);
  const [tipIndex, setTipIndex] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(12).fill(0.2));
  const [isMicOn, setIsMicOn] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Rotate coach tips
  useEffect(() => {
    if (stage !== "idle") return;
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % COACH_TIPS.length);
    }, 3000);
    return () => clearInterval(tipInterval);
  }, [stage]);

  // Simulate audio visualization
  useEffect(() => {
    if (stage !== "recording") return;
    const audioInterval = setInterval(() => {
      setAudioLevels(
        Array(12)
          .fill(0)
          .map(() => Math.random() * 0.8 + 0.2)
      );
    }, 100);
    return () => clearInterval(audioInterval);
  }, [stage]);

  // Recording countdown
  useEffect(() => {
    if (stage !== "recording") return;

    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          setStage("review");
          return RECORDING_DURATION;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [stage]);

  const handleStartRecording = useCallback(() => {
    setCountdown(RECORDING_DURATION);
    setStage("recording");
  }, []);

  const handleRetake = useCallback(() => {
    setStage("idle");
    setCountdown(RECORDING_DURATION);
  }, []);

  const handleSave = useCallback(() => {
    onSave?.(MOCK_RECORDED_VIDEO);
    onOpenChange(false);
    setStage("idle");
    setCountdown(RECORDING_DURATION);
  }, [onSave, onOpenChange]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setStage("idle");
    setCountdown(RECORDING_DURATION);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [onOpenChange]);

  // Calculate progress for the ring
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

          {/* Camera Preview (9:16 aspect ratio simulation) */}
          <div className="relative flex-1 bg-secondary overflow-hidden">
            {/* Mock camera feed */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0"
            >
              {stage === "review" ? (
                <video
                  ref={videoRef}
                  src={MOCK_RECORDED_VIDEO}
                  className="w-full h-full object-cover"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src="https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=600&h=1000&fit=crop"
                  alt="Camera preview"
                  className="w-full h-full object-cover"
                />
              )}
              
              {/* Dark overlay for non-review states */}
              {stage !== "review" && (
                <div className="absolute inset-0 bg-background/30" />
              )}
            </motion.div>

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
                    animate={{ height: `${level * 100}%` }}
                    transition={{ duration: 0.1 }}
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

            {/* Review State - Note */}
            {stage === "review" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-44 left-4 right-4 z-20"
              >
                <div className="glass-card p-3 rounded-xl text-center">
                  <p className="text-xs text-muted-foreground">
                    ✨ You can update this anytime from your profile
                  </p>
                </div>
              </motion.div>
            )}
          </div>

          {/* Bottom Controls */}
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute bottom-0 left-0 right-0 z-30 p-6 pb-safe bg-gradient-to-t from-background via-background/95 to-transparent"
          >
            {stage === "idle" && (
              <div className="flex flex-col items-center gap-4">
                {/* Mic Toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMicOn(!isMicOn)}
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
                  onClick={handleStartRecording}
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
                  <div className="absolute inset-3 rounded-full bg-destructive flex items-center justify-center">
                    <div className="w-5 h-5 rounded-sm bg-white" />
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  Recording... Look at the camera!
                </p>
              </div>
            )}

            {stage === "review" && (
              <div className="flex items-center justify-center gap-8">
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

                {/* Save Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSave}
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
                  <span className="text-xs text-green-400 font-medium">
                    Post Vibe
                  </span>
                </motion.button>
              </div>
            )}
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VibeStudioModal;
