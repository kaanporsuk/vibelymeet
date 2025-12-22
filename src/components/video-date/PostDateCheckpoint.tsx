import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Zap, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { IntegrityAudit } from "./checkpoint/IntegrityAudit";
import { VibeMeter } from "./checkpoint/VibeMeter";
import { FinalVerdict } from "./checkpoint/FinalVerdict";
import { HolographicLock } from "./checkpoint/HolographicLock";

interface PostDateCheckpointProps {
  isOpen: boolean;
  partnerName: string;
  partnerImage: string;
  dateDuration: number; // in seconds
}

export interface CheckpointData {
  // Step 1: Integrity
  cameraVisible: boolean | null;
  matchedProfile: boolean | null;
  feltSafe: boolean | null;
  // Step 2: Vibe Meter
  conversationFlow: number;
  curiosityLevel: number;
  secretNotes: string;
  // Step 3: Verdict
  verdict: "pass" | "vibe" | null;
}

export const PostDateCheckpoint = ({
  isOpen,
  partnerName,
  partnerImage,
  dateDuration,
}: PostDateCheckpointProps) => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [showSuccess, setShowSuccess] = useState(false);
  const [checkpointData, setCheckpointData] = useState<CheckpointData>({
    cameraVisible: null,
    matchedProfile: null,
    feltSafe: null,
    conversationFlow: 3,
    curiosityLevel: 3,
    secretNotes: "",
    verdict: null,
  });

  const updateData = (updates: Partial<CheckpointData>) => {
    setCheckpointData((prev) => ({ ...prev, ...updates }));
  };

  const handleIntegrityComplete = (safe: boolean) => {
    if (!safe) {
      // Trigger report flow
      toast.error("We're sorry you had that experience. Redirecting to report...", {
        duration: 3000,
      });
      setTimeout(() => navigate("/dashboard"), 2000);
      return;
    }
    setCurrentStep(2);
  };

  const handleVibeMeterComplete = () => {
    setCurrentStep(3);
  };

  const handleVerdict = (verdict: "pass" | "vibe") => {
    updateData({ verdict });
    
    if (verdict === "vibe") {
      setShowSuccess(true);
      
      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate([50, 100, 50, 100, 100]);
      }
      
      setTimeout(() => {
        toast.success(`Vibe Logged. Waiting for ${partnerName}...`, {
          duration: 3000,
          icon: "🔒",
        });
        setTimeout(() => navigate("/dashboard"), 2000);
      }, 2500);
    } else {
      toast("Thanks for your honesty. Better vibes await!", {
        icon: "👋",
        duration: 2000,
      });
      setTimeout(() => navigate("/dashboard"), 1500);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins} minute${mins !== 1 ? "s" : ""}`;
  };

  const stepIcons = [
    { icon: Shield, color: "text-cyan-400", label: "Safety" },
    { icon: Zap, color: "text-primary", label: "Chemistry" },
    { icon: Lock, color: "text-accent", label: "Decision" },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8"
        >
          {/* Backdrop with heavy blur */}
          <motion.div
            initial={{ backdropFilter: "blur(0px)" }}
            animate={{ backdropFilter: "blur(24px)" }}
            className="absolute inset-0 bg-background/90"
          />

          {/* Success Animation Overlay */}
          <AnimatePresence>
            {showSuccess && <HolographicLock partnerName={partnerName} />}
          </AnimatePresence>

          {/* Modal Content */}
          {!showSuccess && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="relative z-10 w-full max-w-md mx-4"
            >
              {/* Step Indicators */}
              <div className="flex justify-center gap-4 mb-6">
                {stepIcons.map((step, index) => {
                  const StepIcon = step.icon;
                  const isActive = currentStep === index + 1;
                  const isComplete = currentStep > index + 1;

                  return (
                    <motion.div
                      key={index}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex flex-col items-center gap-1"
                    >
                      <motion.div
                        className={`
                          w-12 h-12 rounded-full flex items-center justify-center
                          transition-all duration-300
                          ${isActive ? "glass-card neon-glow-violet" : "bg-secondary/50"}
                          ${isComplete ? "bg-primary/30" : ""}
                        `}
                        animate={isActive ? {
                          boxShadow: [
                            "0 0 20px hsl(var(--primary) / 0.4)",
                            "0 0 40px hsl(var(--primary) / 0.6)",
                            "0 0 20px hsl(var(--primary) / 0.4)",
                          ],
                        } : {}}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        {isComplete ? (
                          <Sparkles className="w-5 h-5 text-primary" />
                        ) : (
                          <StepIcon className={`w-5 h-5 ${isActive ? step.color : "text-muted-foreground"}`} />
                        )}
                      </motion.div>
                      <span className={`text-xs ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {step.label}
                      </span>
                    </motion.div>
                  );
                })}
              </div>

              {/* Glass Card Container */}
              <div className="glass-card p-6 overflow-hidden">
                {/* Partner Preview */}
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                  <motion.img
                    src={partnerImage}
                    alt={partnerName}
                    className="w-14 h-14 rounded-full object-cover border-2 border-primary/50"
                    animate={{
                      boxShadow: [
                        "0 0 10px hsl(var(--primary) / 0.3)",
                        "0 0 20px hsl(var(--primary) / 0.5)",
                        "0 0 10px hsl(var(--primary) / 0.3)",
                      ],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <div>
                    <h3 className="font-display font-semibold text-foreground">{partnerName}</h3>
                    <p className="text-sm text-muted-foreground">
                      Shared {formatDuration(dateDuration)}
                    </p>
                  </div>
                </div>

                {/* Step Content with AnimatePresence */}
                <AnimatePresence mode="wait">
                  {currentStep === 1 && (
                    <IntegrityAudit
                      key="step1"
                      data={checkpointData}
                      onUpdate={updateData}
                      onComplete={handleIntegrityComplete}
                    />
                  )}

                  {currentStep === 2 && (
                    <VibeMeter
                      key="step2"
                      data={checkpointData}
                      onUpdate={updateData}
                      onComplete={handleVibeMeterComplete}
                    />
                  )}

                  {currentStep === 3 && (
                    <FinalVerdict
                      key="step3"
                      partnerName={partnerName}
                      dateDuration={dateDuration}
                      onVerdict={handleVerdict}
                    />
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
