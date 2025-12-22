import { motion } from "framer-motion";
import { MessageCircle, Sparkles, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { CheckpointData } from "../PostDateCheckpoint";

interface VibeMeterProps {
  data: CheckpointData;
  onUpdate: (updates: Partial<CheckpointData>) => void;
  onComplete: () => void;
}

interface GradientSliderProps {
  label: string;
  leftLabel: string;
  rightLabel: string;
  icon: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  delay: number;
}

const GradientSlider = ({
  label,
  leftLabel,
  rightLabel,
  icon,
  value,
  onChange,
  delay,
}: GradientSliderProps) => {
  const percentage = ((value - 1) / 4) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>

      <div className="relative">
        {/* Gradient Track Background */}
        <div className="absolute inset-0 h-3 rounded-full bg-secondary/50" />
        <motion.div
          className="absolute inset-y-0 left-0 h-3 rounded-full"
          style={{
            background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))",
            width: `${percentage}%`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3 }}
        />

        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          min={1}
          max={5}
          step={1}
          className="relative z-10"
        />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </motion.div>
  );
};

export const VibeMeter = ({ data, onUpdate, onComplete }: VibeMeterProps) => {
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
          className="text-xl font-display font-bold text-primary mb-2"
          style={{
            textShadow: "0 0 20px hsl(var(--primary) / 0.5)",
          }}
        >
          Digital Chemistry
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-sm text-muted-foreground"
        >
          How did the connection feel?
        </motion.p>
      </div>

      {/* Sliders */}
      <div className="space-y-6">
        <GradientSlider
          label="Conversation Flow"
          leftLabel="Awkward 😬"
          rightLabel="Electric ⚡"
          icon={<MessageCircle className="w-4 h-4 text-primary" />}
          value={data.conversationFlow}
          onChange={(value) => onUpdate({ conversationFlow: value })}
          delay={0.2}
        />

        <GradientSlider
          label="Curiosity Level"
          leftLabel="Low 🤷"
          rightLabel="I want to know more 🔥"
          icon={<Sparkles className="w-4 h-4 text-primary" />}
          value={data.curiosityLevel}
          onChange={(value) => onUpdate({ curiosityLevel: value })}
          delay={0.3}
        />
      </div>

      {/* Secret Notes */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-foreground">Secret Notes</span>
          <span className="text-xs text-muted-foreground">(Only you can see this)</span>
        </div>
        <Textarea
          placeholder="What stood out to you? Any memorable moments?"
          value={data.secretNotes}
          onChange={(e) => onUpdate({ secretNotes: e.target.value })}
          className="min-h-[80px] bg-secondary/30 border-border/50 focus:border-accent/50 resize-none"
          maxLength={500}
        />
        <div className="text-right text-xs text-muted-foreground">
          {data.secretNotes.length}/500
        </div>
      </motion.div>

      {/* Continue Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <Button
          onClick={onComplete}
          className="w-full h-12 bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground font-semibold"
        >
          <span>Continue to Decision</span>
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </motion.div>
    </motion.div>
  );
};
