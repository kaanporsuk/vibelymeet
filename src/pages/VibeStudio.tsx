import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, RefreshCw, Check, Video, Mic, MicOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const COACH_TIPS = [
  "Seeking a serious partner?",
  "Obsessed with a new hobby?",
  "Just here for the event?",
  "What song is stuck in your head?",
  "What's your weekend obsession?",
  "Training for a marathon?",
  "Binge-watching a new show?",
];

const RECORDING_DURATION = 15;

const VibeStudio = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<"idle" | "recording" | "review">("idle");
  const [countdown, setCountdown] = useState(RECORDING_DURATION);
  const [tipIndex, setTipIndex] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(12).fill(0.2));
  const [isMicOn, setIsMicOn] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Request camera/mic permissions on mount
  useEffect(() => {
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
  }, []);

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
    if (!streamRef.current) return;

    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: "video/webm;codecs=vp9",
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setRecordedVideoUrl(url);
      setStage("review");
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setCountdown(RECORDING_DURATION);
    setStage("recording");
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
    setStage("idle");
    setCountdown(RECORDING_DURATION);
  }, [recordedVideoUrl]);

  const handleSave = useCallback(() => {
    toast.success("Vibe video saved! You're ready to connect.");
    navigate("/profile");
  }, [navigate]);

  const toggleMic = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  }, []);

  const progress = ((RECORDING_DURATION - countdown) / RECORDING_DURATION) * 100;

  if (hasPermission === false) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <Video className="w-16 h-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-display font-bold text-foreground mb-2">
          Camera Access Required
        </h1>
        <p className="text-muted-foreground mb-6">
          To record your Vibe Video, please allow camera and microphone access in your browser settings.
        </p>
        <Button variant="gradient" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Back Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 z-50 rounded-full bg-background/50 backdrop-blur-md hover:bg-background/70"
      >
        <ArrowLeft className="w-5 h-5" />
      </Button>

      {/* Camera Preview */}
      <div className="relative flex-1 overflow-hidden">
        {stage === "review" && recordedVideoUrl ? (
          <video
            ref={reviewVideoRef}
            src={recordedVideoUrl}
            className="w-full h-full object-cover"
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

        {/* Dark overlay for non-review states */}
        {stage !== "review" && (
          <div className="absolute inset-0 bg-background/20" />
        )}

        {/* Onboarding Header */}
        {stage === "idle" && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-20 left-4 right-4 z-20"
          >
            <div className="glass-card p-4 rounded-2xl text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium text-primary uppercase tracking-wider">
                  Your Living Profile
                </span>
              </div>
              <h1 className="text-2xl font-display font-bold gradient-text">
                What are you Vibing on?
              </h1>
              <p className="text-sm text-muted-foreground">
                Record a 15-second intro so others can get your vibe before matching.
              </p>
            </div>
          </motion.div>
        )}

        {/* Recording Question HUD */}
        {stage === "recording" && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute top-16 left-4 right-4 z-20"
          >
            <div className="glass-card px-4 py-3 rounded-2xl text-center">
              <p className="text-sm text-muted-foreground">What are you</p>
              <p className="text-lg font-display font-bold gradient-text">Vibing on?</p>
            </div>
          </motion.div>
        )}

        {/* Coach Tips (Rotating) */}
        <AnimatePresence mode="wait">
          {stage === "idle" && (
            <motion.div
              key={tipIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-52 left-4 right-4 z-20 text-center"
            >
              <p className="text-sm text-muted-foreground/90 italic bg-background/30 backdrop-blur-sm rounded-full px-4 py-2 inline-block">
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
              <span className="text-sm font-bold text-white">{countdown}s</span>
            </div>
          </motion.div>
        )}

        {/* Audio Waveform Visualizer */}
        {stage === "recording" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute bottom-44 left-1/2 -translate-x-1/2 z-20 flex items-end gap-1 h-16"
          >
            {audioLevels.map((level, i) => (
              <motion.div
                key={i}
                animate={{ height: `${Math.max(level * 100, 10)}%` }}
                transition={{ duration: 0.05 }}
                className={cn(
                  "w-2 rounded-full",
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
              className="relative w-24 h-24 rounded-full"
            >
              {/* Outer Glow */}
              <div className="absolute inset-0 rounded-full bg-destructive/20 blur-xl" />
              {/* Outer Ring */}
              <div className="absolute inset-0 rounded-full border-4 border-destructive" />
              {/* Inner Circle */}
              <div className="absolute inset-4 rounded-full bg-destructive flex items-center justify-center">
                <Video className="w-8 h-8 text-white" />
              </div>
            </motion.button>

            <p className="text-sm text-muted-foreground">Tap to record (15 seconds)</p>
          </div>
        )}

        {stage === "recording" && (
          <div className="flex flex-col items-center gap-4">
            {/* Progress Ring Button */}
            <div className="relative w-24 h-24">
              <svg className="w-full h-full -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  stroke="hsl(var(--muted))"
                  strokeWidth="4"
                  fill="none"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  stroke="hsl(var(--neon-cyan))"
                  strokeWidth="4"
                  fill="none"
                  strokeDasharray={`${progress * 2.76} 276`}
                  strokeLinecap="round"
                  className="transition-all duration-200"
                  style={{
                    filter: "drop-shadow(0 0 8px hsl(var(--neon-cyan)))",
                  }}
                />
              </svg>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={stopRecording}
                className="absolute inset-4 rounded-full bg-destructive flex items-center justify-center"
              >
                <div className="w-6 h-6 rounded-sm bg-white" />
              </motion.button>
            </div>

            <p className="text-sm text-muted-foreground">Recording... Look at the camera!</p>
          </div>
        )}

        {stage === "review" && (
          <div className="flex items-center justify-center gap-12">
            {/* Retake Button */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleRetake}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-secondary border border-border flex items-center justify-center">
                <RefreshCw className="w-7 h-7 text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">Retake</span>
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
                    "0 0 0 12px hsl(142 76% 36% / 0)",
                  ],
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center"
              >
                <Check className="w-8 h-8 text-white" />
              </motion.div>
              <span className="text-sm text-green-400 font-medium">Post Vibe</span>
            </motion.button>
          </div>
        )}
      </motion.div>

      <style>{`
        .mirror {
          transform: scaleX(-1);
        }
      `}</style>
    </div>
  );
};

export default VibeStudio;
