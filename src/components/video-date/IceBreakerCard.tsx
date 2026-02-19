import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw } from "lucide-react";
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
  onDismiss?: () => void;
}

export const IceBreakerCard = ({ sessionId, onPromptChange, onDismiss }: IceBreakerCardProps) => {
  const [questions, setQuestions] = useState<string[]>(VIBE_PROMPTS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isShuffling, setIsShuffling] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Seed questions into the session record on mount
  useEffect(() => {
    if (!sessionId) return;

    const seedQuestions = async () => {
      const { data } = await supabase
        .from("video_sessions")
        .select("vibe_questions")
        .eq("id", sessionId)
        .maybeSingle();

      const stored = data?.vibe_questions as string[] | null;

      if (stored && Array.isArray(stored) && stored.length > 0) {
        setQuestions(stored);
      } else {
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

  // Subscribe to changes for sync
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

  // Auto-advance every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = (prev + 1) % questions.length;
        onPromptChange?.(questions[next]);
        return next;
      });
      // Reappear if dismissed
      setIsDismissed(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [questions, onPromptChange]);

  // Dismiss on tap — reappear after 30s (handled by auto-advance)
  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  const currentPrompt = questions[currentIndex] || VIBE_PROMPTS[0];

  const shufflePrompt = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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

  if (isDismissed) return null;

  return (
    <motion.button
      onClick={handleDismiss}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-background/60 backdrop-blur-md border border-border/30 max-h-[60px] overflow-hidden cursor-pointer"
      style={{ boxShadow: "0 4px 20px hsl(var(--background) / 0.4)" }}
    >
      {/* Prompt text */}
      <AnimatePresence mode="wait">
        <motion.p
          key={currentPrompt}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="flex-1 text-sm font-medium text-foreground leading-snug text-left line-clamp-2"
        >
          {currentPrompt}
        </motion.p>
      </AnimatePresence>

      {/* Shuffle button */}
      <motion.div
        onClick={shufflePrompt}
        whileTap={{ scale: 0.85 }}
        className="shrink-0 w-7 h-7 rounded-full bg-secondary/60 flex items-center justify-center"
      >
        <motion.div
          animate={isShuffling ? { rotate: 360 } : { rotate: 0 }}
          transition={{ duration: 0.3 }}
        >
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
        </motion.div>
      </motion.div>
    </motion.button>
  );
};
