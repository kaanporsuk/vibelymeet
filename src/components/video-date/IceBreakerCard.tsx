import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fallbackVideoDateIceBreakerState,
  normalizeVideoDateIceBreakerIndex,
  normalizeVideoDateIceBreakerQuestions,
  resolveVideoDateIceBreakerIndex,
  shuffleVideoDateIceBreakerQuestions,
  type VideoDateIceBreakerState,
} from "@clientShared/matching/videoDateIceBreakers";

interface IceBreakerCardProps {
  sessionId?: string;
  onPromptChange?: (prompt: string) => void;
  onDismiss?: () => void;
}

function parseVibeQuestionState(raw: unknown): VideoDateIceBreakerState | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    questions?: unknown;
    question_index?: unknown;
    question_anchor_at?: unknown;
    vibe_questions?: unknown;
    vibe_question_index?: unknown;
    vibe_question_anchor_at?: unknown;
  };
  const questions = normalizeVideoDateIceBreakerQuestions(row.questions ?? row.vibe_questions);
  if (!questions.length) return null;
  return {
    questions,
    questionIndex: normalizeVideoDateIceBreakerIndex(row.question_index ?? row.vibe_question_index, questions.length),
    questionAnchorAt:
      typeof (row.question_anchor_at ?? row.vibe_question_anchor_at) === "string"
        ? ((row.question_anchor_at ?? row.vibe_question_anchor_at) as string)
        : null,
  };
}

export const IceBreakerCard = ({ sessionId, onPromptChange, onDismiss }: IceBreakerCardProps) => {
  const [questionState, setQuestionState] = useState<VideoDateIceBreakerState>(() => fallbackVideoDateIceBreakerState());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isAdvancing, setIsAdvancing] = useState(false);

  const seedQuestionState = useCallback(async () => {
    if (!sessionId) return;

    const { data } = await supabase
      .from("video_sessions")
      .select("vibe_questions, vibe_question_index, vibe_question_anchor_at")
      .eq("id", sessionId)
      .maybeSingle();

    const stored = parseVibeQuestionState(data);
    if (stored) {
      setQuestionState(stored);
      return;
    }

    const shuffled = shuffleVideoDateIceBreakerQuestions();
    const { data: seeded } = await supabase.rpc("get_or_seed_video_session_vibe_questions", {
      p_session_id: sessionId,
      p_questions: shuffled,
    });

    setQuestionState(
      parseVibeQuestionState(seeded) ?? {
        questions: shuffled,
        questionIndex: 0,
        questionAnchorAt: new Date().toISOString(),
      },
    );
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void seedQuestionState();
  }, [seedQuestionState, sessionId]);

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
          const next = parseVibeQuestionState(payload.new);
          if (next) setQuestionState(next);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const currentIndex = useMemo(
    () =>
      resolveVideoDateIceBreakerIndex(
        questionState.questions.length,
        questionState.questionIndex,
        questionState.questionAnchorAt,
        nowMs,
      ),
    [nowMs, questionState.questionAnchorAt, questionState.questionIndex, questionState.questions.length],
  );
  const currentPrompt = questionState.questions[currentIndex] ?? questionState.questions[0] ?? "";

  useEffect(() => {
    if (currentPrompt) onPromptChange?.(currentPrompt);
  }, [currentPrompt, onPromptChange]);

  const advancePrompt = useCallback(async () => {
    if (!questionState.questions.length) return;

    setIsAdvancing(true);
    const optimisticIndex = normalizeVideoDateIceBreakerIndex(currentIndex + 1, questionState.questions.length);
    setQuestionState((prev) => ({
      ...prev,
      questionIndex: optimisticIndex,
      questionAnchorAt: new Date().toISOString(),
    }));

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    try {
      if (!sessionId) return;
      const { data } = await supabase.rpc("advance_video_session_vibe_question", {
        p_session_id: sessionId,
      });
      const next = parseVibeQuestionState(data);
      if (next) {
        setQuestionState(next);
      } else {
        await seedQuestionState();
      }
    } finally {
      window.setTimeout(() => setIsAdvancing(false), 250);
    }
  }, [currentIndex, questionState.questions.length, seedQuestionState, sessionId]);

  if (!currentPrompt) return null;

  return (
    <div
      className="w-full min-h-[60px] flex items-center gap-2.5 rounded-2xl bg-background/70 px-3 py-2.5 backdrop-blur-md border border-border/40 overflow-hidden"
      style={{ boxShadow: "0 4px 20px hsl(var(--background) / 0.4)" }}
      role="group"
      aria-label="Ice-breaker question"
    >
      <AnimatePresence mode="wait">
        <motion.p
          key={currentPrompt}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="min-w-0 flex-1 text-[14px] sm:text-[15px] font-semibold text-foreground leading-5 text-left line-clamp-2"
        >
          {currentPrompt}
        </motion.p>
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={advancePrompt}
        whileTap={{ scale: 0.9 }}
        className="shrink-0 h-10 w-10 rounded-full bg-secondary/70 flex items-center justify-center transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Show another ice-breaker question"
        title="Another question"
      >
        <motion.span
          animate={isAdvancing ? { rotate: 360 } : { rotate: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center justify-center"
        >
          <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />
        </motion.span>
      </motion.button>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 h-10 w-10 rounded-full bg-secondary/40 flex items-center justify-center transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Hide ice-breaker question for 30 seconds"
          title="Hide"
        >
          <X className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
      ) : null}
    </div>
  );
};
