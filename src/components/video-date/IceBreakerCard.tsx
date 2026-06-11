import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchVideoDateSessionRow } from "@/lib/videoDateSessionRow";
import {
  fallbackVideoDateIceBreakerState,
  VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS,
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

export const IceBreakerCard = ({
  sessionId,
  onPromptChange,
  onDismiss,
}: IceBreakerCardProps) => {
  const [questionState, setQuestionState] = useState<VideoDateIceBreakerState>(() => fallbackVideoDateIceBreakerState());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [manualPause, setManualPause] = useState<{ startedAtMs: number; untilMs: number } | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const seedQuestionState = useCallback(async () => {
    if (!sessionId) return;

    const { data } = await fetchVideoDateSessionRow(sessionId);

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

  const effectiveNowMs = useMemo(() => {
    if (!manualPause) return nowMs;
    const pauseMs = Math.max(0, manualPause.untilMs - manualPause.startedAtMs);
    if (nowMs < manualPause.untilMs) return manualPause.startedAtMs;
    return nowMs - pauseMs;
  }, [manualPause, nowMs]);

  const currentIndex = useMemo(
    () =>
      resolveVideoDateIceBreakerIndex(
        questionState.questions.length,
        questionState.questionIndex,
        questionState.questionAnchorAt,
        effectiveNowMs,
      ),
    [effectiveNowMs, questionState.questionAnchorAt, questionState.questionIndex, questionState.questions.length],
  );
  const currentPrompt = questionState.questions[currentIndex] ?? questionState.questions[0] ?? "";

  useEffect(() => {
    if (currentPrompt) onPromptChange?.(currentPrompt);
  }, [currentPrompt, onPromptChange]);

  const advancePrompt = useCallback(async () => {
    if (!questionState.questions.length) return;

    setIsAdvancing(true);
    const pauseStartedAtMs = Date.now();
    setManualPause({
      startedAtMs: pauseStartedAtMs,
      untilMs: pauseStartedAtMs + VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS,
    });
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
      className="relative w-full overflow-hidden rounded-[1.45rem] border border-white/[0.12] bg-[rgba(14,14,18,0.58)] px-3.5 py-3 backdrop-blur-2xl"
      style={{
        boxShadow:
          "0 22px 64px rgb(0 0 0 / 0.36), 0 0 0 1px hsl(var(--primary) / 0.08), inset 0 1px 0 rgb(255 255 255 / 0.1)",
      }}
      role="group"
      aria-label="Ice-breaker question"
    >
      <div className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary via-accent to-neon-cyan" aria-hidden />
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/[0.12] shadow-[0_0_22px_hsl(var(--primary)/0.16)]">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.p
              key={currentPrompt}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="min-w-0 text-left text-[15px] font-display font-semibold leading-5 text-white sm:text-[16px] line-clamp-2"
            >
              {currentPrompt}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <motion.button
            type="button"
            onClick={advancePrompt}
            whileTap={{ scale: 0.9 }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.075] transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.055] transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Hide ice-breaker question"
              title="Hide"
            >
              <X className="h-4 w-4 text-white/60" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
