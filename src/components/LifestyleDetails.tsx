import { motion } from "framer-motion";
import { 
  Wine, 
  Cigarette, 
  Dumbbell, 
  Utensils, 
  Briefcase,
  GraduationCap,
  Baby,
  Dog,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface LifestyleItem {
  id: string;
  label: string;
  icon: LucideIcon;
  options: { value: string; label: string; emoji?: string }[];
}

const lifestyleItems: LifestyleItem[] = [
  {
    id: "drinking",
    label: "Drinking",
    icon: Wine,
    options: [
      { value: "never", label: "Never", emoji: "🚫" },
      { value: "sometimes", label: "Socially", emoji: "🍸" },
      { value: "often", label: "Regularly", emoji: "🍷" },
    ],
  },
  {
    id: "smoking",
    label: "Smoking",
    icon: Cigarette,
    options: [
      { value: "never", label: "Never", emoji: "🚭" },
      { value: "sometimes", label: "Sometimes", emoji: "🌬️" },
      { value: "often", label: "Regularly", emoji: "🚬" },
    ],
  },
  {
    id: "exercise",
    label: "Exercise",
    icon: Dumbbell,
    options: [
      { value: "never", label: "Never", emoji: "🛋️" },
      { value: "sometimes", label: "Sometimes", emoji: "🚶" },
      { value: "often", label: "Active", emoji: "💪" },
    ],
  },
  {
    id: "diet",
    label: "Diet",
    icon: Utensils,
    options: [
      { value: "omnivore", label: "Omnivore", emoji: "🍖" },
      { value: "vegetarian", label: "Vegetarian", emoji: "🥗" },
      { value: "vegan", label: "Vegan", emoji: "🌱" },
      { value: "other", label: "Other", emoji: "🍽️" },
    ],
  },
  {
    id: "pets",
    label: "Pets",
    icon: Dog,
    options: [
      { value: "none", label: "None", emoji: "🚫" },
      { value: "dog", label: "Dog", emoji: "🐕" },
      { value: "cat", label: "Cat", emoji: "🐱" },
      { value: "other", label: "Other", emoji: "🐾" },
    ],
  },
  {
    id: "children",
    label: "Children",
    icon: Baby,
    options: [
      { value: "have", label: "Have kids", emoji: "👨‍👧" },
      { value: "want", label: "Want someday", emoji: "🍼" },
      { value: "dont-want", label: "Don't want", emoji: "🚫" },
      { value: "not-sure", label: "Not sure", emoji: "🤔" },
    ],
  },
];

interface LifestyleDetailsProps {
  values: Record<string, string>;
  onChange?: (key: string, value: string) => void;
  editable?: boolean;
}

export const LifestyleDetails = ({ values, onChange, editable = false }: LifestyleDetailsProps) => {
  if (!editable) {
    const filledItems = lifestyleItems.filter((item) => values[item.id]);
    
    if (filledItems.length === 0) return null;
    
    return (
      <div className="flex flex-wrap gap-2">
        {filledItems.map((item) => {
          const option = item.options.find((o) => o.value === values[item.id]);
          if (!option) return null;
          
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/60"
            >
              <item.icon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm">{option.emoji} {option.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {lifestyleItems.map((item, index) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <item.icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{item.label}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.options.map((option) => {
              const isSelected = values[item.id] === option.value;
              
              return (
                <button
                  key={option.value}
                  onClick={() => onChange?.(item.id, option.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all",
                    isSelected
                      ? "bg-primary/20 border border-primary text-foreground"
                      : "bg-secondary/60 border border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.emoji && <span>{option.emoji}</span>}
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      ))}
    </div>
  );
};
