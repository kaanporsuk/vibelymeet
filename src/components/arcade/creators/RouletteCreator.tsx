import { useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { ROULETTE_QUESTIONS } from "@/types/games";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";

interface RouletteCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (question: string, answer: string) => void;
}

export const RouletteCreator = ({ isOpen, onClose, onSubmit }: RouletteCreatorProps) => {
  const answerInputId = useId();
  const [question, setQuestion] = useState(() => 
    ROULETTE_QUESTIONS[Math.floor(Math.random() * ROULETTE_QUESTIONS.length)]
  );
  const [answer, setAnswer] = useState("");
  const [isSpinning, setIsSpinning] = useState(false);
  const spinIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current !== null) {
        window.clearInterval(spinIntervalRef.current);
      }
    };
  }, []);

  const spinQuestion = () => {
    if (isSpinning) return;
    if (spinIntervalRef.current !== null) {
      window.clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    setIsSpinning(true);
    let spins = 0;
    spinIntervalRef.current = window.setInterval(() => {
      setQuestion(ROULETTE_QUESTIONS[Math.floor(Math.random() * ROULETTE_QUESTIONS.length)]);
      spins++;
      if (spins >= 8) {
        if (spinIntervalRef.current !== null) {
          window.clearInterval(spinIntervalRef.current);
          spinIntervalRef.current = null;
        }
        setIsSpinning(false);
      }
    }, 120);
  };

  const handleSubmit = () => {
    if (answer.trim() && !isSpinning) {
      onSubmit(question, answer);
      setAnswer("");
      spinQuestion();
    }
  };

  return (
    <ArcadeCreatorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Vibe Roulette"
      icon="🎡"
      accentClassName="border-cyan-500/30"
      contentClassName="space-y-4"
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!answer.trim() || isSpinning}
          className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          Send Challenge
        </button>
      }
    >
      <p className="text-center text-sm text-muted-foreground">
        Answer the deep question. They'll have to answer to see yours!
      </p>

      <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/20 to-teal-500/20 p-4">
        <motion.p
          key={question}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center font-medium italic text-foreground"
        >
          "{question}"
        </motion.p>
      </div>

      <button
        type="button"
        onClick={spinQuestion}
        disabled={isSpinning}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-2 transition-colors hover:bg-secondary/80 disabled:opacity-60"
      >
        <motion.div
          animate={{ rotate: isSpinning ? 360 : 0 }}
          transition={{ duration: 0.5, repeat: isSpinning ? Infinity : 0 }}
        >
          <RefreshCw className="h-4 w-4 text-cyan-400" />
        </motion.div>
        <span className="text-sm text-muted-foreground">
          {isSpinning ? "Spinning..." : "Different question"}
        </span>
      </button>

      <div>
        <label htmlFor={answerInputId} className="mb-2 block text-sm text-muted-foreground">
          Your answer (will be hidden until they respond):
        </label>
        <textarea
          id={answerInputId}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Be honest and vulnerable..."
          rows={3}
          className="w-full resize-none rounded-xl border border-border/50 bg-secondary/50 px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-cyan-500/50 focus:outline-none"
        />
      </div>
    </ArcadeCreatorShell>
  );
};
