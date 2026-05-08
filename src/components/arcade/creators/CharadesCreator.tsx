import { useId, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CHARADES_EMOJI_PICKER } from "@/types/games";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";

interface CharadesCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (answer: string, emojis: string[]) => void;
}

export const CharadesCreator = ({ isOpen, onClose, onSubmit }: CharadesCreatorProps) => {
  const answerInputId = useId();
  const [answer, setAnswer] = useState("");
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);
  const isReady = answer.trim().length > 0 && selectedEmojis.length > 0;

  const toggleEmoji = (emoji: string) => {
    if (selectedEmojis.includes(emoji)) {
      setSelectedEmojis(selectedEmojis.filter(e => e !== emoji));
    } else if (selectedEmojis.length < 5) {
      setSelectedEmojis([...selectedEmojis, emoji]);
    }
  };

  const handleSubmit = () => {
    if (answer.trim() && selectedEmojis.length > 0) {
      onSubmit(answer, selectedEmojis);
      setAnswer("");
      setSelectedEmojis([]);
    }
  };

  return (
    <ArcadeCreatorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Emoji Charades"
      icon="👻"
      accentClassName="border-purple-500/30"
      contentClassName="space-y-4"
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isReady}
          className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          Send Challenge
        </button>
      }
    >
      <div>
        <label htmlFor={answerInputId} className="mb-2 block text-sm text-muted-foreground">
          Movie, song, or show title:
        </label>
        <input
          id={answerInputId}
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="e.g., Titanic, Thriller, Breaking Bad..."
          className="w-full rounded-xl border border-border/50 bg-secondary/50 px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-purple-500/50 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">Selected emojis</span>
          <span className="text-xs tabular-nums text-muted-foreground">{selectedEmojis.length}/5</span>
        </div>
        <div className="flex min-h-16 flex-wrap items-center justify-center gap-2 rounded-xl border border-border/30 bg-secondary/30 p-3">
          {selectedEmojis.length > 0 ? (
            selectedEmojis.map((emoji) => (
              <motion.button
                key={emoji}
                type="button"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                onClick={() => toggleEmoji(emoji)}
                aria-label={`Remove ${emoji}`}
                className="grid h-10 w-10 place-items-center rounded-lg text-3xl transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500/60"
              >
                {emoji}
              </motion.button>
            ))
          ) : (
            <span className="text-center text-sm text-muted-foreground">Select up to 5 emojis</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {CHARADES_EMOJI_PICKER.map((emoji) => {
          const selected = selectedEmojis.includes(emoji);
          const disabled = !selected && selectedEmojis.length >= 5;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => toggleEmoji(emoji)}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${selected ? "Remove" : "Add"} ${emoji}`}
              className={cn(
                "aspect-square rounded-lg text-xl transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/60",
                selected
                  ? "scale-105 bg-purple-500/30"
                  : "bg-secondary/50 hover:bg-secondary",
                disabled && "cursor-not-allowed opacity-35 hover:bg-secondary/50",
              )}
            >
              {emoji}
            </button>
          );
        })}
      </div>
    </ArcadeCreatorShell>
  );
};
