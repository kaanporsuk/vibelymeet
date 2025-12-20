import { motion } from "framer-motion";
import { Heart, Sparkles, Users, Coffee, PartyPopper, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface IntentOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  emoji: string;
}

const intentOptions: IntentOption[] = [
  {
    id: "long-term",
    label: "Long-term partner",
    description: "Ready to settle down",
    icon: Home,
    emoji: "💍",
  },
  {
    id: "relationship",
    label: "Relationship",
    description: "Open to something real",
    icon: Heart,
    emoji: "💕",
  },
  {
    id: "something-casual",
    label: "Something casual",
    description: "Let's see where it goes",
    icon: Sparkles,
    emoji: "✨",
  },
  {
    id: "new-friends",
    label: "New friends",
    description: "Expanding the squad",
    icon: Users,
    emoji: "👋",
  },
  {
    id: "figuring-out",
    label: "Figuring it out",
    description: "Still exploring",
    icon: Coffee,
    emoji: "🤷",
  },
];

interface RelationshipIntentProps {
  selected: string;
  onSelect?: (intent: string) => void;
  editable?: boolean;
}

export const RelationshipIntent = ({ selected, onSelect, editable = false }: RelationshipIntentProps) => {
  const selectedIntent = intentOptions.find((i) => i.id === selected);

  if (!editable && selectedIntent) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20">
        <span className="text-lg">{selectedIntent.emoji}</span>
        <div>
          <p className="text-sm font-medium text-foreground">{selectedIntent.label}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {intentOptions.map((intent, index) => {
        const isSelected = selected === intent.id;
        
        return (
          <motion.button
            key={intent.id}
            onClick={() => onSelect?.(intent.id)}
            className={cn(
              "w-full flex items-center gap-3 p-4 rounded-xl transition-all text-left",
              isSelected
                ? "bg-primary/20 border-2 border-primary neon-glow-violet"
                : "glass-card hover:border-primary/30"
            )}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="text-2xl">{intent.emoji}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{intent.label}</p>
              <p className="text-xs text-muted-foreground">{intent.description}</p>
            </div>
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
              >
                <Sparkles className="w-3 h-3 text-primary-foreground" />
              </motion.div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
};
