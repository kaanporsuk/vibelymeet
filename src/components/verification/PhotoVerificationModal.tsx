import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Camera, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ChevronRight,
  X,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFaceVerification, VerificationStatus, PoseChallenge } from "@/hooks/useFaceVerification";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PoseTutorialAnimation } from "./PoseTutorialAnimation";

interface PhotoVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profilePhotoUrl: string;
  userId: string;
  onVerificationComplete: (success: boolean) => void;
}

// Animated face guide overlay component
const FaceGuide = ({ 
  faceDetected, 
  faceBox,
  isPoseCorrect 
}: { 
  faceDetected: boolean; 
  faceBox: { x: number; y: number; width: number; height: number } | null;
  isPoseCorrect: boolean;
}) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {/* Oval guide */}
      <motion.div 
        className={cn(
          "w-48 h-64 rounded-[50%] border-4 transition-all duration-300",
          faceDetected 
            ? isPoseCorrect
              ? "border-neon-cyan shadow-[0_0_30px_rgba(6,182,212,0.6)]" 
              : "border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.4)]"
            : "border-white/40"
        )}
        animate={{
          scale: faceDetected ? [1, 1.02, 1] : 1,
        }}
        transition={{
          duration: 1.5,
          repeat: faceDetected ? Infinity : 0,
          ease: "easeInOut",
        }}
      />
      
      {/* Corner brackets for premium feel */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative w-52 h-68">
          {/* Top-left */}
          <div className={cn(
            "absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 rounded-tl-lg transition-colors",
            faceDetected ? "border-neon-cyan" : "border-white/30"
          )} />
          {/* Top-right */}
          <div className={cn(
            "absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 rounded-tr-lg transition-colors",
            faceDetected ? "border-neon-cyan" : "border-white/30"
          )} />
          {/* Bottom-left */}
          <div className={cn(
            "absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 rounded-bl-lg transition-colors",
            faceDetected ? "border-neon-cyan" : "border-white/30"
          )} />
          {/* Bottom-right */}
          <div className={cn(
            "absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 rounded-br-lg transition-colors",
            faceDetected ? "border-neon-cyan" : "border-white/30"
          )} />
        </div>
      </div>
    </div>
  );
};

// Pose challenge indicator pill
const PoseChallengeIndicator = ({ 
  challenge, 
  progress, 
  isActive 
}: { 
  challenge: PoseChallenge; 
  progress: number;
  isActive: boolean;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-2xl transition-all",
        isActive 
          ? "bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30" 
          : challenge.completed
            ? "bg-neon-cyan/10 border border-neon-cyan/30"
            : "bg-secondary/50"
      )}
    >
      <span className="text-2xl">{challenge.icon}</span>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{challenge.label}</p>
        {isActive && (
          <p className="text-xs text-muted-foreground">{challenge.instruction}</p>
        )}
      </div>
      {challenge.completed ? (
        <CheckCircle2 className="w-5 h-5 text-neon-cyan" />
      ) : isActive ? (
        <div className="relative w-10 h-10">
          <svg className="w-full h-full -rotate-90">
            <circle
              cx="20"
              cy="20"
              r="16"
              strokeWidth="4"
              stroke="hsl(var(--secondary))"
              fill="none"
            />
            <circle
              cx="20"
              cy="20"
              r="16"
              strokeWidth="4"
              stroke="hsl(var(--primary))"
              fill="none"
              strokeDasharray={100}
              strokeDashoffset={100 - progress}
              strokeLinecap="round"
              className="transition-all duration-150"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary">
            {Math.round(progress)}
          </span>
        </div>
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />
      )}
    </motion.div>
  );
};

// Challenge steps progress bar
const ChallengeProgress = ({ 
  challenges, 
  currentIndex 
}: { 
  challenges: PoseChallenge[]; 
  currentIndex: number;
}) => {
  return (
    <div className="flex items-center gap-2">
      {challenges.map((challenge, index) => (
        <div key={challenge.id} className="flex items-center">
          <motion.div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all",
              challenge.completed 
                ? "bg-neon-cyan text-background" 
                : index === currentIndex
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
            )}
            animate={index === currentIndex ? { scale: [1, 1.1, 1] } : {}}
            transition={{ duration: 0.5, repeat: index === currentIndex ? Infinity : 0 }}
          >
            {challenge.completed ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              index + 1
            )}
          </motion.div>
          {index < challenges.length - 1 && (
            <div className={cn(
              "w-8 h-0.5 mx-1 transition-colors",
              challenge.completed ? "bg-neon-cyan" : "bg-secondary"
            )} />
          )}
        </div>
      ))}
    </div>
  );
};

export const PhotoVerificationModal = ({
  open,
  onOpenChange,
  profilePhotoUrl,
  userId,
  onVerificationComplete,
}: PhotoVerificationModalProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceCheckInterval = useRef<NodeJS.Timeout | null>(null);
  
  const {
    status,
    progress,
    errorMessage,
    faceDetected,
    faceAnalysis,
    challenges,
    currentChallengeIndex,
    currentChallenge,
    challengeProgress,
    livenessScore,
    allChallengesCompleted,
    loadModels,
    startCamera,
    stopCamera,
    detectFaceInVideo,
    startPoseChallenge,
    processPoseChallenge,
    verifyAgainstProfilePhoto,
    reset,
  } = useFaceVerification();

  const [isUploading, setIsUploading] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [isPoseCorrect, setIsPoseCorrect] = useState(false);

  // Initialize when modal opens
  useEffect(() => {
    if (open) {
      setShowIntro(true);
    } else {
      cleanup();
    }
    
    return () => cleanup();
  }, [open]);

  // Face detection and pose challenge loop
  useEffect(() => {
    if (status === "capturing" && videoRef.current) {
      faceCheckInterval.current = setInterval(() => {
        detectFaceInVideo();
      }, 300);
    } else if (status === "pose-challenge" && videoRef.current) {
      faceCheckInterval.current = setInterval(async () => {
        const correct = await processPoseChallenge();
        setIsPoseCorrect(correct);
      }, 100);
    } else {
      if (faceCheckInterval.current) {
        clearInterval(faceCheckInterval.current);
        faceCheckInterval.current = null;
      }
    }
    
    return () => {
      if (faceCheckInterval.current) {
        clearInterval(faceCheckInterval.current);
      }
    };
  }, [status, detectFaceInVideo, processPoseChallenge]);

  // Auto-verify when all challenges completed
  useEffect(() => {
    if (allChallengesCompleted && status === "pose-challenge") {
      // Small delay for UX
      setTimeout(() => {
        handleVerify();
      }, 500);
    }
  }, [allChallengesCompleted, status]);

  const handleShowTutorial = () => {
    setShowIntro(false);
    setShowTutorial(true);
  };

  const initializeVerification = async () => {
    setShowTutorial(false);
    const modelsReady = await loadModels();
    if (modelsReady && videoRef.current) {
      await startCamera(videoRef.current);
    }
  };

  const cleanup = () => {
    if (faceCheckInterval.current) {
      clearInterval(faceCheckInterval.current);
    }
    stopCamera();
    reset();
    setShowIntro(true);
    setShowTutorial(false);
    setIsPoseCorrect(false);
  };

  const handleStartPoseChallenge = () => {
    startPoseChallenge();
  };

  const handleVerify = async () => {
    if (!profilePhotoUrl) {
      toast.error("No profile photo found. Please add a photo first.");
      return;
    }

    const result = await verifyAgainstProfilePhoto(profilePhotoUrl);
    
    if (result.success && result.selfieBlob) {
      // Upload proof selfie to private bucket
      setIsUploading(true);
      try {
        const fileName = `${userId}/${Date.now()}_proof.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("proof-selfies")
          .upload(fileName, result.selfieBlob, {
            contentType: "image/jpeg",
            cacheControl: "3600",
          });

        if (uploadError) throw uploadError;

        // Get the URL (signed URL for private bucket)
        const { data: urlData } = await supabase.storage
          .from("proof-selfies")
          .createSignedUrl(uploadData.path, 60 * 60 * 24 * 365); // 1 year

        // Update profile with verification status
        const { error: updateError } = await supabase
          .from("profiles")
          .update({
            photo_verified: true,
            photo_verified_at: new Date().toISOString(),
            proof_selfie_url: urlData?.signedUrl || uploadData.path,
          })
          .eq("id", userId);

        if (updateError) throw updateError;

        toast.success("Photo verification complete!");
        onVerificationComplete(true);
      } catch (error) {
        console.error("Failed to save verification:", error);
        toast.error("Verification passed but failed to save. Please try again.");
      } finally {
        setIsUploading(false);
      }
    } else {
      onVerificationComplete(false);
    }
  };

  const handleRetry = () => {
    reset();
    setShowIntro(true);
  };

  // Intro screen content
  const renderIntro = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6 py-4"
    >
      {/* Hero illustration */}
      <div className="relative mx-auto w-32 h-32">
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 to-accent/30"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <div className="absolute inset-2 rounded-full bg-card flex items-center justify-center">
          <ShieldCheck className="w-12 h-12 text-neon-cyan" />
        </div>
        <motion.div
          className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-neon-cyan flex items-center justify-center"
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Sparkles className="w-4 h-4 text-background" />
        </motion.div>
      </div>

      {/* Title */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-display font-bold text-foreground">
          Verify Your Photos
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Complete a quick selfie verification to prove you're really you. Verified profiles get 3x more matches!
        </p>
      </div>

      {/* Steps preview */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Camera className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Quick selfie check</p>
            <p className="text-xs text-muted-foreground">Takes just 30 seconds</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
          <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
            <span className="text-lg">🎭</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">3 fun pose challenges</p>
            <p className="text-xs text-muted-foreground">Smile, turn left, turn right</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
          <div className="w-10 h-10 rounded-xl bg-neon-cyan/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-neon-cyan" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Get verified badge</p>
            <p className="text-xs text-muted-foreground">Stand out from the crowd</p>
          </div>
        </div>
      </div>

      <Button
        variant="gradient"
        size="lg"
        onClick={handleShowTutorial}
        className="w-full"
      >
        See How It Works
        <Play className="w-5 h-5 ml-1" />
      </Button>
    </motion.div>
  );

  // Tutorial screen content
  const renderTutorial = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-6 py-4"
    >
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-xs font-medium text-primary">
          <Play className="w-3 h-3" />
          Tutorial
        </div>
        <h3 className="text-lg font-display font-bold text-foreground">
          Follow These Poses
        </h3>
        <p className="text-sm text-muted-foreground">
          We'll ask you to complete 3 quick poses
        </p>
      </div>

      {/* Animated tutorial */}
      <PoseTutorialAnimation autoPlay={true} />

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => setShowIntro(true)}
          className="flex-1"
        >
          Back
        </Button>
        <Button
          variant="gradient"
          onClick={initializeVerification}
          className="flex-1"
        >
          I'm Ready
          <ChevronRight className="w-5 h-5 ml-1" />
        </Button>
      </div>
    </motion.div>
  );

  const getStatusContent = () => {
    if (showIntro) {
      return renderIntro();
    }
    
    if (showTutorial) {
      return renderTutorial();
    }

    switch (status) {
      case "loading-models":
        return (
          <div className="text-center space-y-4 py-8">
            <motion.div
              className="relative mx-auto w-20 h-20"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <div className="absolute inset-0 rounded-full border-4 border-secondary" />
              <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent" />
            </motion.div>
            <div className="space-y-2">
              <p className="font-medium text-foreground">Preparing verification...</p>
              <Progress value={progress} className="w-48 mx-auto" />
              <p className="text-xs text-muted-foreground">Loading face detection models</p>
            </div>
          </div>
        );
      
      case "ready":
      case "capturing":
        return (
          <div className="space-y-4">
            {/* Camera preview */}
            <div className="relative aspect-[3/4] max-h-80 mx-auto rounded-2xl overflow-hidden bg-secondary">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              
              <FaceGuide 
                faceDetected={faceDetected} 
                faceBox={faceAnalysis?.faceBox || null}
                isPoseCorrect={false}
              />
              
              {/* Face detection indicator */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <motion.div 
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2",
                    faceDetected 
                      ? "bg-green-500/90 text-white" 
                      : "bg-black/60 text-white/80"
                  )}
                  animate={faceDetected ? { scale: [1, 1.05, 1] } : {}}
                  transition={{ duration: 0.5 }}
                >
                  {faceDetected ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Face detected - Ready!
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      Position your face in the oval
                    </>
                  )}
                </motion.div>
              </div>
            </div>
            
            <Button
              variant="gradient"
              size="lg"
              onClick={handleStartPoseChallenge}
              disabled={!faceDetected}
              className="w-full"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Start Pose Challenges
            </Button>
          </div>
        );

      case "pose-challenge":
        return (
          <div className="space-y-4">
            {/* Progress indicator */}
            <div className="flex justify-center">
              <ChallengeProgress challenges={challenges} currentIndex={currentChallengeIndex} />
            </div>

            {/* Camera preview */}
            <div className="relative aspect-[3/4] max-h-72 mx-auto rounded-2xl overflow-hidden bg-secondary">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              
              <FaceGuide 
                faceDetected={faceDetected} 
                faceBox={faceAnalysis?.faceBox || null}
                isPoseCorrect={isPoseCorrect}
              />

              {/* Current pose indicator overlay */}
              {currentChallenge && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-4 left-1/2 -translate-x-1/2"
                >
                  <div className={cn(
                    "px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 backdrop-blur-sm",
                    isPoseCorrect 
                      ? "bg-neon-cyan/90 text-background" 
                      : "bg-black/70 text-white"
                  )}>
                    <span className="text-lg">{currentChallenge.icon}</span>
                    {currentChallenge.instruction}
                  </div>
                </motion.div>
              )}

              {/* Challenge progress ring */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <div className="relative w-16 h-16">
                  <svg className="w-full h-full -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      strokeWidth="6"
                      stroke="rgba(255,255,255,0.2)"
                      fill="none"
                    />
                    <motion.circle
                      cx="32"
                      cy="32"
                      r="28"
                      strokeWidth="6"
                      stroke={isPoseCorrect ? "hsl(var(--neon-cyan))" : "hsl(var(--primary))"}
                      fill="none"
                      strokeDasharray={176}
                      strokeDashoffset={176 - (challengeProgress / 100) * 176}
                      strokeLinecap="round"
                      className="transition-all duration-100"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {challengeProgress >= 100 ? (
                      <CheckCircle2 className="w-6 h-6 text-neon-cyan" />
                    ) : (
                      <span className="text-lg font-bold text-white">{Math.round(challengeProgress)}%</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Challenge list */}
            <div className="space-y-2">
              {challenges.map((challenge, index) => (
                <PoseChallengeIndicator
                  key={challenge.id}
                  challenge={challenge}
                  progress={index === currentChallengeIndex ? challengeProgress : 0}
                  isActive={index === currentChallengeIndex}
                />
              ))}
            </div>

            {/* Liveness score */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Liveness Score</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-primary to-neon-cyan"
                    initial={{ width: 0 }}
                    animate={{ width: `${livenessScore}%` }}
                  />
                </div>
                <span className="font-medium text-foreground">{livenessScore}%</span>
              </div>
            </div>
          </div>
        );
      
      case "processing":
        return (
          <div className="text-center space-y-4 py-8">
            <motion.div
              className="relative mx-auto w-24 h-24"
            >
              <motion.div
                className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-accent opacity-30"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <div className="absolute inset-2 rounded-full bg-card flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
            </motion.div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Analyzing your face...</p>
              <p className="text-sm text-muted-foreground">Comparing with your profile photo</p>
            </div>
          </div>
        );
      
      case "success":
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-6 py-8"
          >
            {/* Success animation */}
            <div className="relative mx-auto w-28 h-28">
              <motion.div
                className="absolute inset-0 rounded-full bg-neon-cyan/20"
                animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-neon-cyan/10"
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
              />
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-neon-cyan to-green-500 flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-background" />
              </div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-2xl font-display font-bold text-foreground">You're Verified!</h3>
              <p className="text-sm text-muted-foreground">
                {isUploading ? "Saving your verification..." : "Your identity has been confirmed"}
              </p>
            </div>

            {/* Badge preview */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-neon-cyan/20 border border-neon-cyan/30"
            >
              <ShieldCheck className="w-5 h-5 text-neon-cyan" />
              <span className="text-sm font-medium text-neon-cyan">Verified Badge Earned</span>
            </motion.div>

            {isUploading && (
              <Loader2 className="w-6 h-6 mx-auto text-primary animate-spin" />
            )}
          </motion.div>
        );
      
      case "failed":
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-4 py-6"
          >
            <div className="relative mx-auto w-24 h-24">
              <motion.div
                className="absolute inset-0 rounded-full bg-destructive/20"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <div className="absolute inset-2 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-12 h-12 text-destructive" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xl font-display font-bold text-foreground">Verification Failed</p>
              <p className="text-sm text-muted-foreground">
                Face doesn't match your profile photo
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">Tips for success:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Make sure you're in good lighting</li>
                <li>• Remove glasses or hats</li>
                <li>• Use the same expression as your profile photo</li>
              </ul>
            </div>
            <div className="flex gap-3 justify-center pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </motion.div>
        );
      
      case "error":
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-4 py-6"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-12 h-12 text-amber-500" />
            </div>
            <div className="space-y-1">
              <p className="text-xl font-display font-bold text-foreground">Something went wrong</p>
              <p className="text-sm text-muted-foreground">
                {errorMessage || "Please try again"}
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </motion.div>
        );
      
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-neon-cyan" />
            Photo Verification
          </DialogTitle>
          {!showIntro && (
            <DialogDescription>
              Complete the pose challenges to verify your identity
            </DialogDescription>
          )}
        </DialogHeader>
        
        <AnimatePresence mode="wait">
          <motion.div
            key={showIntro ? "intro" : status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {getStatusContent()}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};
