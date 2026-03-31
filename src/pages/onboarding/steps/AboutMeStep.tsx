import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDERS = [
  "Coffee snob and sunset chaser...",
  "I'll beat you at Mario Kart...",
  "Looking for my partner in crime...",
  "Dog person pretending to like cats...",
  "Let's grab drinks at that place we both walk past...",
];

const MAX_CHARS = 140;

interface AboutMeStepProps {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}

export const AboutMeStep = ({ value, onChange, onNext }: AboutMeStepProps) => {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const trimmed = value.trim();
  const valid = trimmed.length === 0 || trimmed.length >= 10;

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length);
    }, 3000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const skip = () => {
    onChange("");
    onNext();
  };

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Tell them something memorable
        </h1>
        <p className="text-muted-foreground mt-2">
          You have 3 seconds to make an impression.
        </p>
      </div>

      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => {
            if (e.target.value.length <= MAX_CHARS) onChange(e.target.value);
          }}
          rows={4}
          className="bg-secondary/50 border-secondary resize-none text-base"
        />
        {!value && (
          <div className="absolute top-3 left-3 pointer-events-none">
            <AnimatePresence mode="wait">
              <motion.span
                key={placeholderIdx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 0.4, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="text-muted-foreground text-base"
              >
                {PLACEHOLDERS[placeholderIdx]}
              </motion.span>
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">
          {MAX_CHARS - value.length} chars left
        </span>
        {trimmed.length > 0 && trimmed.length < 10 && (
          <span className="text-xs text-amber-400">At least 10 characters</span>
        )}
      </div>

      <Button
        onClick={onNext}
        disabled={!valid}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>

      <button
        onClick={skip}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
      >
        I'll write this later
      </button>
    </div>
  );
};
