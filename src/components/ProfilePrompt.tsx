import { motion } from "framer-motion";
import { MessageCircle, Pencil, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfilePromptProps {
  prompt: string;
  answer: string;
  onEdit?: () => void;
  editable?: boolean;
  index?: number;
}

const promptEmojis: Record<string, string> = {
  "A shower thought I had recently": "🚿",
  "My simple pleasures": "✨",
  "The way to win me over": "💫",
  "I geek out on": "🤓",
  "Together, we could": "🌙",
  "My most controversial opinion": "🔥",
  "I'm looking for": "🔮",
  "A life goal of mine": "🎯",
  "My love language is": "💕",
  "Two truths and a lie": "🎭",
};

export const ProfilePrompt = ({ 
  prompt, 
  answer, 
  onEdit, 
  editable = false,
  index = 0 
}: ProfilePromptProps) => {
  const emoji = promptEmojis[prompt] || "💭";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className={cn(
        "glass-card p-4 space-y-2 group relative overflow-hidden",
        editable && "cursor-pointer hover:border-primary/50 transition-colors"
      )}
      onClick={editable ? onEdit : undefined}
    >
      {/* Subtle gradient accent */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-primary opacity-60" />
      
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{emoji}</span>
          <p className="text-sm font-medium text-muted-foreground">{prompt}</p>
        </div>
        {editable && (
          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-secondary">
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      
      <p className="text-foreground leading-relaxed pl-7">
        {answer || (
          <span className="text-muted-foreground/50 italic">
            Tap to add your answer...
          </span>
        )}
      </p>
      
      {answer && (
        <div className="flex items-center gap-1.5 pl-7 pt-1">
          <MessageCircle className="w-3 h-3 text-primary/60" />
          <span className="text-xs text-muted-foreground">Conversation starter</span>
        </div>
      )}
    </motion.div>
  );
};

// Prompt selector for editing
interface PromptSelectorProps {
  selectedPrompt: string;
  onSelect: (prompt: string) => void;
}

const availablePrompts = [
  "A shower thought I had recently",
  "My simple pleasures",
  "The way to win me over",
  "I geek out on",
  "Together, we could",
  "My most controversial opinion",
  "I'm looking for",
  "A life goal of mine",
  "My love language is",
  "Two truths and a lie",
];

export const PromptSelector = ({ selectedPrompt, onSelect }: PromptSelectorProps) => {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Choose a prompt</p>
      <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-hide">
        {availablePrompts.map((prompt) => {
          const emoji = promptEmojis[prompt] || "💭";
          const isSelected = selectedPrompt === prompt;
          
          return (
            <motion.button
              key={prompt}
              onClick={() => onSelect(prompt)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left",
                isSelected
                  ? "bg-primary/20 border border-primary/40"
                  : "bg-secondary hover:bg-secondary/80"
              )}
              whileTap={{ scale: 0.98 }}
            >
              <span className="text-lg">{emoji}</span>
              <span className="text-sm font-medium">{prompt}</span>
              {isSelected && (
                <Sparkles className="w-4 h-4 text-primary ml-auto" />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
