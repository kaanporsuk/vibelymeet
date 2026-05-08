import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";

interface TwoTruthsCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (statements: string[], lieIndex: number) => void;
}

export const TwoTruthsCreator = ({ isOpen, onClose, onSubmit }: TwoTruthsCreatorProps) => {
  const [statements, setStatements] = useState(["", "", ""]);
  const [lieIndex, setLieIndex] = useState<number>(2);
  const canSubmit = statements.every(s => s.trim().length > 0);

  const handleSubmit = () => {
    if (canSubmit) {
      onSubmit(statements, lieIndex);
      setStatements(["", "", ""]);
      setLieIndex(2);
    }
  };

  const updateStatement = (index: number, value: string) => {
    const newStatements = [...statements];
    newStatements[index] = value;
    setStatements(newStatements);
  };

  return (
    <ArcadeCreatorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Two Truths & A Lie"
      icon="🎭"
      accentClassName="border-pink-500/30"
      contentClassName="space-y-4"
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          Send Challenge
        </button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Write 2 truths and 1 lie. Mark which one is the lie!
      </p>

      {statements.map((statement, index) => (
        <div key={index} className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="lie"
              checked={lieIndex === index}
              onChange={() => setLieIndex(index)}
              className="accent-pink-500"
            />
            <span className="text-xs text-muted-foreground">
              {lieIndex === index ? "This is the lie" : "Mark as lie"}
            </span>
          </label>
          <input
            type="text"
            value={statement}
            onChange={(e) => updateStatement(index, e.target.value)}
            aria-label={`Statement ${index + 1}`}
            placeholder={`Statement ${index + 1}...`}
            className={cn(
              "w-full rounded-xl border bg-secondary/50 px-4 py-3 text-sm",
              lieIndex === index ? "border-pink-500/50" : "border-border/50",
              "placeholder:text-muted-foreground focus:border-pink-500/50 focus:outline-none",
            )}
          />
        </div>
      ))}
    </ArcadeCreatorShell>
  );
};
