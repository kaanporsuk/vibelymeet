import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { INTUITION_OPTIONS } from "@/types/games";
import { cn } from "@/lib/utils";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";

interface IntuitionCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  matchName: string;
  onSubmit: (options: [string, string], prediction: 0 | 1) => void;
}

export const IntuitionCreator = ({ isOpen, onClose, matchName, onSubmit }: IntuitionCreatorProps) => {
  const [options, setOptions] = useState<[string, string]>(() => 
    INTUITION_OPTIONS[Math.floor(Math.random() * INTUITION_OPTIONS.length)] as [string, string]
  );
  const [prediction, setPrediction] = useState<0 | 1 | null>(null);

  const shuffleOptions = () => {
    const newOptions = INTUITION_OPTIONS[Math.floor(Math.random() * INTUITION_OPTIONS.length)] as [string, string];
    setOptions(newOptions);
    setPrediction(null);
  };

  const handleSubmit = () => {
    if (prediction !== null) {
      onSubmit(options, prediction);
      setPrediction(null);
      shuffleOptions();
    }
  };

  return (
    <ArcadeCreatorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Intuition Test"
      icon="🔮"
      accentClassName="border-indigo-500/30"
      contentClassName="space-y-4"
      headerAction={
        <button
          type="button"
          onClick={shuffleOptions}
          aria-label="Shuffle intuition options"
          className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      }
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={prediction === null}
          className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          Send Prediction
        </button>
      }
    >
      <p className="text-center text-sm text-muted-foreground">
        I bet <span className="font-medium text-foreground">{matchName}</span> prefers...
      </p>

      <div className="space-y-3">
        {options.map((option, index) => (
          <motion.button
            key={option}
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => setPrediction(index as 0 | 1)}
            aria-pressed={prediction === index}
            className={cn(
              "w-full rounded-xl border p-4 text-center transition-all",
              prediction === index
                ? "border-indigo-500/50 bg-indigo-500/20"
                : "border-border/50 bg-secondary/50 hover:border-indigo-500/30",
            )}
          >
            <span className="font-medium text-foreground">{option}</span>
          </motion.button>
        ))}
      </div>

      {prediction !== null && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-sm text-muted-foreground"
        >
          You think they prefer <span className="font-medium text-indigo-400">{options[prediction]}</span>
        </motion.p>
      )}
    </ArcadeCreatorShell>
  );
};
