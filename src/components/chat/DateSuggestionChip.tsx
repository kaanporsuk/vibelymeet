import { motion, AnimatePresence } from "framer-motion";
import { Video, Sparkles } from "lucide-react";

interface DateSuggestionChipProps {
  visible: boolean;
  onSuggest: () => void;
  onDismiss: () => void;
}

export const DateSuggestionChip = ({
  visible,
  onSuggest,
  onDismiss,
}: DateSuggestionChipProps) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          className="absolute bottom-full left-4 right-4 mb-2"
        >
          <div className="glass-card rounded-2xl p-3 border border-primary/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-sm text-foreground">
                Suggest a Video Date? 📹
              </span>
            </div>

            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={onDismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
              >
                Dismiss
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                onClick={onSuggest}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-primary text-primary-foreground text-sm font-medium"
              >
                <Video className="w-3.5 h-3.5" />
                Send Invite
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
