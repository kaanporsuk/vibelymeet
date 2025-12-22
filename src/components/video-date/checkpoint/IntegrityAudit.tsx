import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Camera, UserCheck, Heart, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckpointData } from "../PostDateCheckpoint";

interface IntegrityAuditProps {
  data: CheckpointData;
  onUpdate: (updates: Partial<CheckpointData>) => void;
  onComplete: (safe: boolean) => void;
}

interface ToggleSwitchProps {
  label: string;
  icon: React.ReactNode;
  value: boolean | null;
  onChange: (value: boolean) => void;
  delay: number;
}

const ToggleSwitch = ({ label, icon, value, onChange, delay }: ToggleSwitchProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 border border-border/50"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>

      <div className="flex gap-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onChange(false)}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${value === false
              ? "bg-destructive/20 text-destructive border border-destructive/50"
              : "bg-secondary/50 text-muted-foreground hover:text-foreground"
            }
          `}
        >
          No
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onChange(true)}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${value === true
              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 neon-glow-cyan"
              : "bg-secondary/50 text-muted-foreground hover:text-foreground"
            }
          `}
        >
          Yes
        </motion.button>
      </div>
    </motion.div>
  );
};

export const IntegrityAudit = ({ data, onUpdate, onComplete }: IntegrityAuditProps) => {
  const [canProceed, setCanProceed] = useState(false);

  useEffect(() => {
    const allAnswered = 
      data.cameraVisible !== null && 
      data.matchedProfile !== null && 
      data.feltSafe !== null;
    setCanProceed(allAnswered);
  }, [data]);

  const handleContinue = () => {
    if (data.feltSafe === false) {
      onComplete(false);
    } else {
      onComplete(true);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="text-center">
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xl font-display font-bold text-cyan-400 mb-2"
          style={{
            textShadow: "0 0 20px hsl(187 94% 43% / 0.5)",
          }}
        >
          Vibe Verification
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-sm text-muted-foreground"
        >
          Help keep Vibely authentic. Verify the basics.
        </motion.p>
      </div>

      {/* Toggle Switches */}
      <div className="space-y-3">
        <ToggleSwitch
          label="Was the camera on & visible?"
          icon={<Camera className="w-5 h-5 text-cyan-400" />}
          value={data.cameraVisible}
          onChange={(value) => onUpdate({ cameraVisible: value })}
          delay={0.2}
        />
        <ToggleSwitch
          label="Did they match their profile/vibes?"
          icon={<UserCheck className="w-5 h-5 text-cyan-400" />}
          value={data.matchedProfile}
          onChange={(value) => onUpdate({ matchedProfile: value })}
          delay={0.3}
        />
        <ToggleSwitch
          label="Did you feel safe & respected?"
          icon={<Heart className="w-5 h-5 text-cyan-400" />}
          value={data.feltSafe}
          onChange={(value) => onUpdate({ feltSafe: value })}
          delay={0.4}
        />
      </div>

      {/* Safety Warning */}
      {data.feltSafe === false && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="p-3 rounded-lg bg-destructive/10 border border-destructive/30"
        >
          <p className="text-sm text-destructive">
            We're sorry to hear that. You'll be redirected to our safety center to report this experience.
          </p>
        </motion.div>
      )}

      {/* Continue Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: canProceed ? 1 : 0.5 }}
        transition={{ delay: 0.5 }}
      >
        <Button
          onClick={handleContinue}
          disabled={!canProceed}
          className="w-full h-12 bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-background font-semibold"
        >
          <span>Continue</span>
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </motion.div>
    </motion.div>
  );
};
