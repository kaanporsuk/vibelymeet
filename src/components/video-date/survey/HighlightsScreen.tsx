import { useState } from "react";
import { motion } from "framer-motion";
import { Flame, PartyPopper, Brain, Handshake, ChevronRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HighlightsData {
  tagChemistry: boolean;
  tagFun: boolean;
  tagSmart: boolean;
  tagRespectful: boolean;
  energy: string | null;
  conversationFlow: string | null;
}

interface HighlightsScreenProps {
  onComplete: (data: HighlightsData) => void;
  onSkip: () => void;
}

const TAGS = [
  { key: "tagChemistry", label: "Chemistry", icon: Flame, emoji: "🔥" },
  { key: "tagFun", label: "Fun", icon: PartyPopper, emoji: "🎉" },
  { key: "tagSmart", label: "Smart", icon: Brain, emoji: "🧠" },
  { key: "tagRespectful", label: "Respectful", icon: Handshake, emoji: "🤝" },
] as const;

const ENERGY_OPTIONS = ["Calm", "Energetic", "Intense"];
const FLOW_OPTIONS = ["Naturally", "Took effort", "One-sided"];

export const HighlightsScreen = ({ onComplete, onSkip }: HighlightsScreenProps) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({
    tagChemistry: false,
    tagFun: false,
    tagSmart: false,
    tagRespectful: false,
  });
  const [energy, setEnergy] = useState<string | null>(null);
  const [flow, setFlow] = useState<string | null>(null);

  const toggleTag = (key: string) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = () => {
    onComplete({
      tagChemistry: selected.tagChemistry,
      tagFun: selected.tagFun,
      tagSmart: selected.tagSmart,
      tagRespectful: selected.tagRespectful,
      energy: energy?.toLowerCase() || null,
      conversationFlow:
        flow === "Naturally"
          ? "natural"
          : flow === "Took effort"
          ? "effort"
          : flow === "One-sided"
          ? "one_sided"
          : null,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6 py-2"
    >
      <div className="text-center">
        <h2 className="text-lg font-display font-bold text-foreground mb-1">
          What stood out?
        </h2>
        <p className="text-sm text-muted-foreground">
          Helps us find you better matches
        </p>
      </div>

      {/* Tags */}
      <div className="grid grid-cols-2 gap-2">
        {TAGS.map((tag, i) => (
          <motion.button
            key={tag.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => toggleTag(tag.key)}
            className={`
              flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all
              ${
                selected[tag.key]
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "bg-secondary/30 text-muted-foreground border border-border/30 hover:text-foreground"
              }
            `}
          >
            <span>{tag.emoji}</span>
            <span>{tag.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Energy */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Their energy felt:</p>
        <div className="flex gap-2">
          {ENERGY_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setEnergy(opt === energy ? null : opt)}
              className={`
                flex-1 py-2 px-3 rounded-full text-xs font-medium transition-all
                ${
                  energy === opt
                    ? "bg-accent/20 text-accent border border-accent/40"
                    : "bg-secondary/30 text-muted-foreground border border-border/30"
                }
              `}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation flow */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Conversation flowed:</p>
        <div className="flex gap-2">
          {FLOW_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setFlow(opt === flow ? null : opt)}
              className={`
                flex-1 py-2 px-3 rounded-full text-xs font-medium transition-all
                ${
                  flow === opt
                    ? "bg-accent/20 text-accent border border-accent/40"
                    : "bg-secondary/30 text-muted-foreground border border-border/30"
                }
              `}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={handleSubmit}
          className="w-full h-11 bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground font-semibold"
        >
          <span>Continue</span>
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
        <button
          onClick={onSkip}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <SkipForward className="w-3.5 h-3.5" />
          <span>Skip</span>
        </button>
      </div>
    </motion.div>
  );
};
