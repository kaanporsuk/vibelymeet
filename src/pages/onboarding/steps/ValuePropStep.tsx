import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

const CARDS = [
  {
    icon: "🎪",
    pain: "Tired of swiping into the void?",
    solution: "Meet through real events, not algorithms.",
    detail: "Join events. See attendee previews. Match with people who actually show up.",
  },
  {
    icon: "📹",
    pain: "First dates shouldn't feel like interviews.",
    solution: "Progressive blur video dates build real chemistry.",
    detail: "Start blurred. Earn clarity. Know the vibe before you meet IRL.",
  },
  {
    icon: "📅",
    pain: "Matching is easy. Meeting is hard.",
    solution: "Vibe Schedule makes plans happen.",
    detail: "Skip endless loops. Suggest a date and lock it in.",
  },
  {
    icon: "💬",
    pain: "Conversations dying after 'hey' is the worst.",
    solution: "Games, voice, and clips break the ice.",
    detail: "Get to know each other through play, not just text.",
  },
];

interface ValuePropStepProps {
  onNext: () => void;
}

export const ValuePropStep = ({ onNext }: ValuePropStepProps) => {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const interactedRef = useRef(false);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (!interactedRef.current) {
        setIndex((prev) => (prev + 1) % CARDS.length);
      }
    }, 4000);
    return () => clearInterval(timerRef.current);
  }, []);

  const go = (i: number) => {
    interactedRef.current = true;
    setIndex(i);
    clearInterval(timerRef.current);
  };

  const card = CARDS[index];

  return (
    <div className="flex flex-col items-center pt-8 gap-6">
      <div className="text-center mb-2">
        <h1 className="text-2xl font-display font-bold text-foreground">
          What makes Vibely different
        </h1>
      </div>

      <div className="w-full min-h-[240px] relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3 }}
            className="glass-card p-6 rounded-2xl space-y-3 text-center"
          >
            <span className="text-4xl block">{card.icon}</span>
            <p className="text-sm text-muted-foreground italic">{card.pain}</p>
            <p className="text-lg font-semibold text-foreground">{card.solution}</p>
            <p className="text-sm text-muted-foreground">{card.detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dots */}
      <div className="flex gap-2">
        {CARDS.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === index ? "bg-primary w-6" : "bg-secondary"
            }`}
          />
        ))}
      </div>

      <Button
        onClick={onNext}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Let's build your profile
      </Button>
    </div>
  );
};
