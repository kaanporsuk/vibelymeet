import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, RotateCw } from "lucide-react";
import { SCAVENGER_PROMPTS } from "@/types/games";
import { cn } from "@/lib/utils";

interface ScavengerCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (prompt: string, photoUrl: string) => void;
}

export const ScavengerCreator = ({ isOpen, onClose, onSubmit }: ScavengerCreatorProps) => {
  const [prompt, setPrompt] = useState(() => 
    SCAVENGER_PROMPTS[Math.floor(Math.random() * SCAVENGER_PROMPTS.length)]
  );
  const [isSpinning, setIsSpinning] = useState(false);
  const [photoUploaded, setPhotoUploaded] = useState(false);

  const spinWheel = () => {
    setIsSpinning(true);
    let spins = 0;
    const interval = setInterval(() => {
      setPrompt(SCAVENGER_PROMPTS[Math.floor(Math.random() * SCAVENGER_PROMPTS.length)]);
      spins++;
      if (spins >= 10) {
        clearInterval(interval);
        setIsSpinning(false);
      }
    }, 100);
  };

  const handleUpload = () => {
    // Mock photo upload
    setPhotoUploaded(true);
  };

  const handleSubmit = () => {
    if (photoUploaded) {
      onSubmit(prompt, "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400");
      setPhotoUploaded(false);
      spinWheel();
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
            <div className="glass-card rounded-2xl overflow-hidden border border-green-500/30">
              {/* Header */}
              <div className="p-4 border-b border-green-500/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📸</span>
                  <h3 className="font-semibold text-foreground">Scavenger Hunt</h3>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Spin for a prompt, snap your photo!
                </p>

                {/* Prompt Display */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 text-center">
                  <motion.p
                    key={prompt}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-semibold text-lg text-foreground"
                  >
                    {prompt}
                  </motion.p>
                </div>

                {/* Spin Button */}
                <button
                  onClick={spinWheel}
                  disabled={isSpinning}
                  className="w-full py-3 rounded-xl bg-secondary hover:bg-secondary/80 flex items-center justify-center gap-2 transition-colors"
                >
                  <motion.div
                    animate={{ rotate: isSpinning ? 360 : 0 }}
                    transition={{ duration: 0.5, repeat: isSpinning ? Infinity : 0 }}
                  >
                    <RotateCw className="w-5 h-5 text-green-400" />
                  </motion.div>
                  <span className="text-foreground font-medium">
                    {isSpinning ? "Spinning..." : "Spin for new prompt"}
                  </span>
                </button>

                {/* Photo Upload */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUpload}
                  className={cn(
                    "w-full aspect-video rounded-xl flex flex-col items-center justify-center gap-3 transition-all",
                    "border-2 border-dashed",
                    photoUploaded 
                      ? "bg-green-500/20 border-green-500/50" 
                      : "bg-secondary/50 border-green-500/30 hover:border-green-500/50"
                  )}
                >
                  {photoUploaded ? (
                    <>
                      <div className="w-12 h-12 rounded-full bg-green-500/30 flex items-center justify-center">
                        <span className="text-2xl">✓</span>
                      </div>
                      <span className="text-green-400 font-medium">Photo ready!</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-8 h-8 text-green-400" />
                      <span className="text-muted-foreground">Tap to take photo</span>
                    </>
                  )}
                </motion.button>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-green-500/20">
                <button
                  onClick={handleSubmit}
                  disabled={!photoUploaded}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold disabled:opacity-50 transition-opacity"
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
