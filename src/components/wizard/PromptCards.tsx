import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Prompt {
  id: string;
  question: string;
  emoji: string;
  placeholder: string;
  answer: string;
}

interface PromptCardsProps {
  prompts: Prompt[];
  onPromptsChange: (prompts: Prompt[]) => void;
}

// Synced with ProfilePrompt.tsx availablePrompts
const defaultPrompts: Omit<Prompt, "answer">[] = [
  { id: "1", question: "A shower thought I had recently", emoji: "🚿", placeholder: "Something that keeps me wondering..." },
  { id: "2", question: "My simple pleasures", emoji: "✨", placeholder: "Morning coffee, fresh sheets, a good playlist..." },
  { id: "3", question: "The way to win me over", emoji: "💫", placeholder: "Show genuine curiosity and make me laugh..." },
  { id: "4", question: "I geek out on", emoji: "🤓", placeholder: "Documentaries, coffee brewing, vintage cameras..." },
  { id: "5", question: "Together, we could", emoji: "🌙", placeholder: "Explore hidden gems, cook new recipes, start a podcast..." },
];

const PromptCards = ({ prompts, onPromptsChange }: PromptCardsProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set());

  const currentPrompt = prompts[currentIndex] || { ...defaultPrompts[currentIndex], answer: "" };

  const toggleFlip = (id: string) => {
    const newFlipped = new Set(flippedCards);
    if (newFlipped.has(id)) {
      newFlipped.delete(id);
    } else {
      newFlipped.add(id);
    }
    setFlippedCards(newFlipped);
  };

  const updateAnswer = (answer: string) => {
    const newPrompts = [...prompts];
    const existingIndex = newPrompts.findIndex((p) => p.id === currentPrompt.id);
    
    if (existingIndex >= 0) {
      newPrompts[existingIndex] = { ...newPrompts[existingIndex], answer };
    } else {
      newPrompts.push({ ...defaultPrompts[currentIndex], answer });
    }
    
    onPromptsChange(newPrompts);
  };

  const isFlipped = flippedCards.has(currentPrompt.id);
  const answeredCount = prompts.filter((p) => p.answer.trim().length > 0).length;

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">
          {answeredCount} of {defaultPrompts.length} answered
        </span>
        <div className="flex gap-1.5">
          {defaultPrompts.map((_, index) => {
            const prompt = prompts.find((p) => p.id === defaultPrompts[index].id);
            const hasAnswer = prompt?.answer && prompt.answer.trim().length > 0;
            return (
              <motion.button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className={`
                  w-2.5 h-2.5 rounded-full transition-all
                  ${index === currentIndex ? "w-6 bg-primary" : hasAnswer ? "bg-primary/50" : "bg-secondary"}
                `}
              />
            );
          })}
        </div>
      </div>

      {/* Card container */}
      <div className="relative h-[280px] perspective-1000">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0"
            style={{ transformStyle: "preserve-3d" }}
          >
            <motion.div
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ duration: 0.6, type: "spring", stiffness: 100 }}
              style={{ transformStyle: "preserve-3d" }}
              className="relative w-full h-full"
            >
              {/* Front of card */}
              <div
                className={`
                  absolute inset-0 glass-card p-6 flex flex-col items-center justify-center cursor-pointer
                  ${isFlipped ? "pointer-events-none" : ""}
                `}
                style={{ backfaceVisibility: "hidden" }}
                onClick={() => toggleFlip(currentPrompt.id)}
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring" }}
                  className="text-5xl mb-4"
                >
                  {defaultPrompts[currentIndex].emoji}
                </motion.span>
                <h3 className="text-xl font-semibold text-foreground text-center mb-3">
                  {defaultPrompts[currentIndex].question}
                </h3>
                <p className="text-sm text-muted-foreground text-center">
                  Tap to answer
                </p>
                
                {/* Answered indicator */}
                {prompts.find((p) => p.id === currentPrompt.id)?.answer && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-4 right-4 w-8 h-8 rounded-full bg-primary flex items-center justify-center"
                  >
                    <Check className="w-4 h-4 text-primary-foreground" />
                  </motion.div>
                )}
              </div>

              {/* Back of card */}
              <div
                className={`
                  absolute inset-0 glass-card p-6 flex flex-col
                  ${!isFlipped ? "pointer-events-none" : ""}
                `}
                style={{ 
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)"
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">{defaultPrompts[currentIndex].emoji}</span>
                  <h3 className="text-lg font-semibold text-foreground flex-1">
                    {defaultPrompts[currentIndex].question}
                  </h3>
                  <button
                    onClick={() => toggleFlip(currentPrompt.id)}
                    className="text-sm text-primary hover:underline"
                  >
                    Done
                  </button>
                </div>
                
                <Textarea
                  value={prompts.find((p) => p.id === currentPrompt.id)?.answer || ""}
                  onChange={(e) => updateAnswer(e.target.value)}
                  placeholder={defaultPrompts[currentIndex].placeholder}
                  className="flex-1 resize-none bg-secondary/50 border-border/50 focus:border-primary"
                  maxLength={200}
                />
                
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted-foreground">
                    {(prompts.find((p) => p.id === currentPrompt.id)?.answer || "").length}/200
                  </span>
                  <div className="flex items-center gap-1 text-xs text-primary">
                    <Sparkles className="w-3 h-3" />
                    <span>Good answers boost matches</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <div className="flex gap-2">
          {defaultPrompts.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`
                text-xs px-3 py-1 rounded-full transition-all
                ${index === currentIndex 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                }
              `}
            >
              {index + 1}
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentIndex((i) => Math.min(defaultPrompts.length - 1, i + 1))}
          disabled={currentIndex === defaultPrompts.length - 1}
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
};

export default PromptCards;
