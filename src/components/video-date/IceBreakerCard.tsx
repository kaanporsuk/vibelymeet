import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, Sparkles, X } from "lucide-react";
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
      className="relative w-full min-h-[68px] flex items-center gap-3 overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/40 px-3.5 py-3 backdrop-blur-2xl"
      style={{ boxShadow: "0 20px 60px rgb(0 0 0 / 0.34), inset 0 1px 0 rgb(255 255 255 / 0.08)" }}
      role="group"
      aria-label="Ice-breaker question"
    >
      <div className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary via-accent to-neon-cyan" aria-hidden />
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={currentPrompt}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="min-w-0 flex-1 text-[15px] sm:text-[16px] font-semibold text-white leading-5 text-left line-clamp-2"
        >
          {currentPrompt}
        </motion.p>
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={advancePrompt}
        whileTap={{ scale: 0.9 }}
        className="shrink-0 h-11 w-11 rounded-full bg-white/[0.08] flex items-center justify-center transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Show another ice-breaker question"
        title="Another question"
      >
        <motion.span
          animate={isAdvancing ? { rotate: 360 } : { rotate: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center justify-center"
        >
          <RefreshCw className="h-4 w-4 text-white/60" aria-hidden />
        </motion.span>
      </motion.button>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 h-11 w-11 rounded-full bg-white/[0.06] flex items-center justify-center transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Hide ice-breaker question for 30 seconds"
          title="Hide"
        >
          <X className="h-4 w-4 text-white/60" aria-hidden />
        </button>
      ) : null}
    </div>
  );
};
