import { motion } from "framer-motion";
import { BadgeCheck, Camera, Shield, Fingerprint, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface VerificationBadgeProps {
  verified: boolean;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export const VerificationBadge = ({ 
  verified, 
  size = "md",
  showLabel = false 
}: VerificationBadgeProps) => {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  if (!verified) return null;

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className={cn(
        "flex items-center gap-1",
        showLabel && "px-2 py-0.5 rounded-full bg-neon-cyan/20"
      )}
    >
      <BadgeCheck 
        className={cn(sizeClasses[size], "text-neon-cyan")} 
        fill="hsl(var(--neon-cyan))"
        strokeWidth={2}
      />
      {showLabel && (
        <span className="text-xs font-medium text-neon-cyan">Verified</span>
      )}
    </motion.div>
  );
};

// Verification steps component for onboarding
interface VerificationStep {
  id: string;
  label: string;
  description: string;
  icon: typeof Camera;
  completed: boolean;
}

interface VerificationStepsProps {
  steps: VerificationStep[];
  onStartStep?: (stepId: string) => void;
}

export const VerificationSteps = ({ steps, onStartStep }: VerificationStepsProps) => {
  const allCompleted = steps.every((s) => s.completed);
  
  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-neon-cyan" />
          <span className="font-medium text-foreground">Verification</span>
        </div>
        <span className="text-sm text-muted-foreground">
          {steps.filter((s) => s.completed).length}/{steps.length} complete
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-neon-cyan to-primary"
          initial={{ width: 0 }}
          animate={{ 
            width: `${(steps.filter((s) => s.completed).length / steps.length) * 100}%` 
          }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
      
      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <motion.button
            key={step.id}
            onClick={() => !step.completed && onStartStep?.(step.id)}
            disabled={step.completed}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
              step.completed
                ? "bg-neon-cyan/10 border border-neon-cyan/20"
                : "glass-card hover:border-primary/30"
            )}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              step.completed
                ? "bg-neon-cyan/20"
                : "bg-secondary"
            )}>
              <step.icon className={cn(
                "w-5 h-5",
                step.completed ? "text-neon-cyan" : "text-muted-foreground"
              )} />
            </div>
            
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
            
            {step.completed ? (
              <BadgeCheck className="w-5 h-5 text-neon-cyan" fill="hsl(var(--neon-cyan))" />
            ) : (
              <Sparkles className="w-4 h-4 text-primary" />
            )}
          </motion.button>
        ))}
      </div>
      
      {/* Completion message */}
      {allCompleted && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20"
        >
          <BadgeCheck className="w-5 h-5 text-neon-cyan" fill="hsl(var(--neon-cyan))" />
          <span className="text-sm text-neon-cyan">You're verified! 3x more likely to match.</span>
        </motion.div>
      )}
    </div>
  );
};
