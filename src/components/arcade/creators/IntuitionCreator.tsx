import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw } from "lucide-react";
import { INTUITION_OPTIONS } from "@/types/games";
import { cn } from "@/lib/utils";

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
            <div className="glass-card rounded-2xl overflow-hidden border border-indigo-500/30">
              {/* Header */}
              <div className="p-4 border-b border-indigo-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔮</span>
                  <h3 className="font-semibold text-foreground">Intuition Test</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={shuffleOptions}
                    className="p-2 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  I bet <span className="text-foreground font-medium">{matchName}</span> prefers...
                </p>

                <div className="space-y-3">
                  {options.map((option, index) => (
                    <motion.button
                      key={index}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setPrediction(index as 0 | 1)}
                      className={cn(
                        "w-full p-4 rounded-xl text-center transition-all",
                        "border",
                        prediction === index 
                          ? "bg-indigo-500/20 border-indigo-500/50" 
                          : "bg-secondary/50 border-border/50 hover:border-indigo-500/30"
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
                    className="text-sm text-center text-muted-foreground"
                  >
                    You think they prefer <span className="text-indigo-400 font-medium">{options[prediction]}</span>
                  </motion.p>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-indigo-500/20">
                <button
                  onClick={handleSubmit}
                  disabled={prediction === null}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-semibold disabled:opacity-50 transition-opacity"
                >
                  Send Prediction
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
