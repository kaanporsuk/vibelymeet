import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHARADES_EMOJI_PICKER } from "../../../../shared/vibely-games/charadesEmojiPicker";

interface CharadesCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (answer: string, emojis: string[]) => void;
}

export const CharadesCreator = ({ isOpen, onClose, onSubmit }: CharadesCreatorProps) => {
  const [answer, setAnswer] = useState("");
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);

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
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md max-h-[80vh] overflow-hidden"
          >
            <div className="glass-card rounded-2xl overflow-hidden border border-purple-500/30">
              {/* Header */}
              <div className="p-4 border-b border-purple-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">👻</span>
                  <h3 className="font-semibold text-foreground">Emoji Charades</h3>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className="text-sm text-muted-foreground block mb-2">
                    Movie, song, or show title:
                  </label>
                  <input
                    type="text"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="e.g., Titanic, Thriller, Breaking Bad..."
                    className="w-full px-4 py-3 rounded-xl text-sm bg-secondary/50 border border-border/50 focus:outline-none focus:border-purple-500/50 placeholder:text-muted-foreground"
                  />
                </div>

                {/* Selected Emojis Preview */}
                <div className="min-h-[60px] p-3 rounded-xl bg-secondary/30 border border-border/30 flex items-center justify-center gap-3">
                  {selectedEmojis.length > 0 ? (
                    selectedEmojis.map((emoji, idx) => (
                      <motion.span
                        key={idx}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="text-3xl cursor-pointer hover:scale-110 transition-transform"
                        onClick={() => toggleEmoji(emoji)}
                      >
                        {emoji}
                      </motion.span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Select up to 5 emojis</span>
                  )}
                </div>

                {/* Emoji Picker */}
                <div className="grid grid-cols-8 gap-2">
                  {CHARADES_EMOJI_PICKER.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => toggleEmoji(emoji)}
                      className={cn(
                        "text-xl p-2 rounded-lg transition-all",
                        selectedEmojis.includes(emoji)
                          ? "bg-purple-500/30 scale-110"
                          : "bg-secondary/50 hover:bg-secondary"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-purple-500/20">
                <button
                  onClick={handleSubmit}
                  disabled={!answer.trim() || selectedEmojis.length === 0}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 text-white font-semibold disabled:opacity-50 transition-opacity"
                >
                  Send Challenge
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
