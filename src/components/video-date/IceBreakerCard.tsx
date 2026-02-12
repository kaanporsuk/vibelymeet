import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  sessionId?: string;
  onPromptChange?: (prompt: string) => void;
}

/**
 * Synchronized vibe questions: both users see the same question at the same time.
 * On mount, seeds the session's vibe_questions array if empty, then reads from it.
 * Advances through the list based on a shared timer index.
 */
export const IceBreakerCard = ({ sessionId, onPromptChange }: IceBreakerCardProps) => {
  const [questions, setQuestions] = useState<string[]>(VIBE_PROMPTS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isShuffling, setIsShuffling] = useState(false);
  const [startTime, setStartTime] = useState<number>(Date.now());

  // Seed questions into the session record on mount
  useEffect(() => {
    if (!sessionId) return;

    const seedQuestions = async () => {
      // Check if questions are already stored
      const { data } = await supabase
        .from("video_sessions")
        .select("vibe_questions")
        .eq("id", sessionId)
        .maybeSingle();

      const stored = data?.vibe_questions as string[] | null;

      if (stored && Array.isArray(stored) && stored.length > 0) {
        setQuestions(stored);
      } else {
        // Shuffle and store a deterministic list for this session
        const shuffled = [...VIBE_PROMPTS].sort(() => Math.random() - 0.5);
        await supabase
          .from("video_sessions")
          .update({ vibe_questions: shuffled as any })
          .eq("id", sessionId);
        setQuestions(shuffled);
      }
    };

    seedQuestions();
  }, [sessionId]);

  // Subscribe to changes on the session's vibe_questions for sync
  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`vibe-questions-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newQuestions = (payload.new as any).vibe_questions as string[] | null;
          if (newQuestions && Array.isArray(newQuestions) && newQuestions.length > 0) {
            setQuestions(newQuestions);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // Auto-advance every 30 seconds using a shared timer
  // Both clients started roughly at the same time, so they advance together
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = (prev + 1) % questions.length;
        onPromptChange?.(questions[next]);
        return next;
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [questions, onPromptChange]);

  const currentPrompt = questions[currentIndex] || VIBE_PROMPTS[0];

  const shufflePrompt = useCallback(() => {
    setIsShuffling(true);
    setCurrentIndex((prev) => {
      let next;
      do {
        next = Math.floor(Math.random() * questions.length);
      } while (next === prev && questions.length > 1);
      onPromptChange?.(questions[next]);
      return next;
    });

    setTimeout(() => setIsShuffling(false), 300);

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }, [questions, onPromptChange]);

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
        Both of you see the same question ✨
      </p>
    </motion.div>
  );
};
