import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";

const TIPS = [
  { emoji: "💡", text: "Lighting check! Face a window for the best glow." },
  { emoji: "✈️", text: "Ask about their favorite travel story." },
  { emoji: "✨", text: "Just be yourself—that's the best vibe." },
  { emoji: "👀", text: "Look at the camera, not the screen, for eye contact." },
  { emoji: "😊", text: "Smile! It's contagious through the screen." },
  { emoji: "🎧", text: "Use headphones for better audio quality." },
  { emoji: "🎯", text: "Share something unique about yourself." },
  { emoji: "💬", text: "Listen actively—it shows you care." },
];

export const TipsCarousel = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % TIPS.length);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="w-full max-w-md"
    >
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-[hsl(var(--neon-yellow))]" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Quick Tip
        </span>
      </div>

      <div className="relative h-16 overflow-hidden rounded-2xl bg-secondary/30 border border-border/30 px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 flex items-center gap-3 px-4"
          >
            <span className="text-2xl">{TIPS[currentIndex].emoji}</span>
            <p className="text-sm text-foreground/90 leading-relaxed">
              {TIPS[currentIndex].text}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress Dots */}
      <div className="flex justify-center gap-1.5 mt-3">
        {TIPS.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
              i === currentIndex
                ? 'w-4 bg-primary'
                : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
            }`}
          />
        ))}
      </div>
    </motion.div>
  );
};
