import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TwoTruthsCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (statements: string[], lieIndex: number) => void;
}

export const TwoTruthsCreator = ({ isOpen, onClose, onSubmit }: TwoTruthsCreatorProps) => {
  const [statements, setStatements] = useState(["", "", ""]);
  const [lieIndex, setLieIndex] = useState<number>(2);

  const handleSubmit = () => {
    if (statements.every(s => s.trim().length > 0)) {
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
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md"
          >
            <div className="glass-card rounded-2xl overflow-hidden border border-pink-500/30">
              {/* Header */}
              <div className="p-4 border-b border-pink-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎭</span>
                  <h3 className="font-semibold text-foreground">Two Truths & A Lie</h3>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Write 2 truths and 1 lie. Mark which one is the lie!
                </p>

                {statements.map((statement, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center gap-2">
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
                    </div>
                    <input
                      type="text"
                      value={statement}
                      onChange={(e) => updateStatement(index, e.target.value)}
                      placeholder={`Statement ${index + 1}...`}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl text-sm",
                        "bg-secondary/50 border",
                        lieIndex === index ? "border-pink-500/50" : "border-border/50",
                        "focus:outline-none focus:border-pink-500/50",
                        "placeholder:text-muted-foreground"
                      )}
                    />
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-pink-500/20">
                <button
                  onClick={handleSubmit}
                  disabled={!statements.every(s => s.trim().length > 0)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-semibold disabled:opacity-50 transition-opacity"
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
