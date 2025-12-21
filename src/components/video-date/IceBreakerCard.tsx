import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";

const VIBE_PROMPTS = [
  "What's a weird talent you have? 🎭",
  "Dream travel destination? ✈️",
  "What's your go-to karaoke song? 🎤",
  "Best date you've ever been on? 💫",
  "What's something that instantly makes you smile? 😊",
  "If you could have dinner with anyone, who? 🍽️",
  "What's your love language? 💕",
  "Describe your perfect lazy Sunday ☀️",
  "What's on your bucket list? ✨",
  "What makes you feel most alive? 🔥",
  "Early bird or night owl? 🦉",
  "What's your comfort movie? 🎬",
  "Beach vacation or mountain adventure? 🏔️",
  "What are you passionate about? 💜",
  "What's your hidden gem restaurant? 🍜",
];

interface IceBreakerCardProps {
  onPromptChange?: (prompt: string) => void;
}

export const IceBreakerCard = ({ onPromptChange }: IceBreakerCardProps) => {
  const [currentPrompt, setCurrentPrompt] = useState(VIBE_PROMPTS[0]);
  const [promptIndex, setPromptIndex] = useState(0);
  const [isShuffling, setIsShuffling] = useState(false);

  // Auto-cycle prompts every 90 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      cyclePrompt();
    }, 90000);

    return () => clearInterval(interval);
  }, [promptIndex]);

  const cyclePrompt = () => {
    const nextIndex = (promptIndex + 1) % VIBE_PROMPTS.length;
    setPromptIndex(nextIndex);
    setCurrentPrompt(VIBE_PROMPTS[nextIndex]);
    onPromptChange?.(VIBE_PROMPTS[nextIndex]);
  };

  const shufflePrompt = () => {
    setIsShuffling(true);
    
    // Get random prompt different from current
    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * VIBE_PROMPTS.length);
    } while (randomIndex === promptIndex);
    
    setTimeout(() => {
      setPromptIndex(randomIndex);
      setCurrentPrompt(VIBE_PROMPTS[randomIndex]);
      onPromptChange?.(VIBE_PROMPTS[randomIndex]);
      setIsShuffling(false);
    }, 300);

    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  };

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
      className="glass-card px-5 py-4 max-w-sm mx-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="text-xs font-medium text-accent uppercase tracking-wider">
            Vibe Prompt
          </span>
        </div>
        
        <motion.button
          onClick={shufflePrompt}
          disabled={isShuffling}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="p-2 rounded-full bg-secondary/50 hover:bg-secondary transition-colors"
        >
          <motion.div
            animate={isShuffling ? { rotate: 360 } : { rotate: 0 }}
            transition={{ duration: 0.3 }}
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </motion.button>
      </div>

      {/* Prompt */}
      <AnimatePresence mode="wait">
        <motion.p
          key={currentPrompt}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="text-base font-medium text-foreground leading-relaxed"
        >
          {currentPrompt}
        </motion.p>
      </AnimatePresence>

      {/* Hint */}
      <p className="text-xs text-muted-foreground mt-3">
        Tap shuffle if you need a new topic ✨
      </p>
    </motion.div>
  );
};
