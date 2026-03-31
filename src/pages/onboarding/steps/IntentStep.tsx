import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { id: "long-term", emoji: "💕", label: "Relationship" },
  { id: "something-casual", emoji: "🌊", label: "Something casual" },
  { id: "figuring-out", emoji: "🤷", label: "Not sure yet" },
  { id: "new-friends", emoji: "👋", label: "New friends" },
  { id: "rather-not", emoji: "💬", label: "Open to anything" },
];

interface IntentStepProps {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}

export const IntentStep = ({ value, onChange, onNext }: IntentStepProps) => {
  const valid = !!value;

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          What are you looking for?
        </h1>
        <p className="text-muted-foreground mt-2">
          No pressure — we'll match your vibe.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt, i) => (
          <motion.button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-full transition-all text-sm font-medium",
              value === opt.id
                ? "bg-primary/20 border-2 border-primary text-foreground"
                : "glass-card hover:border-primary/30 text-muted-foreground"
            )}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.95 }}
          >
            <span>{opt.emoji}</span>
            <span>{opt.label}</span>
          </motion.button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        You can change this anytime in your profile.
      </p>

      <Button
        onClick={onNext}
        disabled={!valid}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>
    </div>
  );
};
