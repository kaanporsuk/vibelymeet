import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import { useVibeTags } from "@/hooks/useProfiles";

interface VibeOption {
  label: string;
  emoji: string;
}

const fallbackVibes: VibeOption[] = [
  { label: "Foodie", emoji: "🍜" },
  { label: "Night Owl", emoji: "🦉" },
  { label: "Gamer", emoji: "🎮" },
  { label: "Gym Rat", emoji: "💪" },
  { label: "Bookworm", emoji: "📚" },
  { label: "Traveler", emoji: "✈️" },
  { label: "Music Lover", emoji: "🎵" },
  { label: "Cinephile", emoji: "🎬" },
  { label: "Coffee Addict", emoji: "☕" },
  { label: "Plant Parent", emoji: "🌱" },
  { label: "Dog Person", emoji: "🐕" },
  { label: "Cat Person", emoji: "🐱" },
  { label: "Techie", emoji: "💻" },
  { label: "Creative", emoji: "🎨" },
  { label: "Adventurer", emoji: "🏔️" },
  { label: "Homebody", emoji: "🏠" },
  { label: "Spiritual", emoji: "✨" },
  { label: "Fashionista", emoji: "👗" },
];

interface VibeTagSelectorProps {
  selectedVibes: string[];
  onVibesChange: (vibes: string[]) => void;
  maxSelections?: number;
}

export const VibeTagSelector = ({
  selectedVibes,
  onVibesChange,
  maxSelections = 5,
}: VibeTagSelectorProps) => {
  const { data: vibeTags, isLoading } = useVibeTags();

  const vibeOptions: VibeOption[] = (vibeTags?.length
    ? vibeTags.map((t: any) => ({ label: t.label, emoji: t.emoji }))
    : fallbackVibes
  ).filter(Boolean);

  const toggleVibe = (vibe: string) => {
    if (selectedVibes.includes(vibe)) {
      onVibesChange(selectedVibes.filter((v) => v !== vibe));
    } else if (selectedVibes.length < maxSelections) {
      onVibesChange([...selectedVibes, vibe]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Pick up to {maxSelections} vibes that define you</p>
        <span
          className={cn(
            "text-sm font-medium",
            selectedVibes.length === maxSelections ? "text-neon-pink" : "text-muted-foreground"
          )}
        >
          {selectedVibes.length}/{maxSelections}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="ml-2 text-sm">Loading vibes…</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {vibeOptions.map((vibe) => {
            const isSelected = selectedVibes.includes(vibe.label);
            const isDisabled = !isSelected && selectedVibes.length >= maxSelections;

            return (
              <motion.button
                key={vibe.label}
                onClick={() => toggleVibe(vibe.label)}
                disabled={isDisabled}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-2 rounded-full border-2 transition-all duration-300",
                  isSelected
                    ? "bg-primary/20 border-primary neon-glow-violet"
                    : "glass-card border-transparent hover:border-primary/30",
                  isDisabled && "opacity-40 cursor-not-allowed"
                )}
                whileTap={{ scale: 0.97 }}
                type="button"
              >
                <span className="text-lg">{vibe.emoji}</span>
                <span className="text-sm font-medium">{vibe.label}</span>

                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center"
                  >
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
};

