import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, RotateCw } from "lucide-react";
import { SCAVENGER_PROMPTS } from "@/types/games";
import { cn } from "@/lib/utils";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";

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
  const spinIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current !== null) {
        window.clearInterval(spinIntervalRef.current);
      }
    };
  }, []);

  const spinWheel = () => {
    if (isSpinning) return;
    if (spinIntervalRef.current !== null) {
      window.clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    setIsSpinning(true);
    let spins = 0;
    spinIntervalRef.current = window.setInterval(() => {
      setPrompt(SCAVENGER_PROMPTS[Math.floor(Math.random() * SCAVENGER_PROMPTS.length)]);
      spins++;
      if (spins >= 10) {
        if (spinIntervalRef.current !== null) {
          window.clearInterval(spinIntervalRef.current);
          spinIntervalRef.current = null;
        }
        setIsSpinning(false);
      }
    }, 100);
  };

  const handleUpload = () => {
    // Mock photo upload
    setPhotoUploaded(true);
  };

  const handleSubmit = () => {
    if (photoUploaded && !isSpinning) {
      onSubmit(prompt, "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400");
      setPhotoUploaded(false);
      spinWheel();
    }
  };

  return (
    <ArcadeCreatorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Scavenger Hunt"
      icon="📸"
      accentClassName="border-green-500/30"
      contentClassName="space-y-4"
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!photoUploaded || isSpinning}
          className="w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          Send Challenge
        </button>
      }
    >
      <p className="text-center text-sm text-muted-foreground">
        Spin for a prompt, snap your photo!
      </p>

      <div className="rounded-xl border border-green-500/30 bg-gradient-to-br from-green-500/20 to-emerald-500/20 p-4 text-center">
        <motion.p
          key={prompt}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-lg font-semibold text-foreground"
        >
          {prompt}
        </motion.p>
      </div>

      <button
        type="button"
        onClick={spinWheel}
        disabled={isSpinning}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-3 transition-colors hover:bg-secondary/80 disabled:opacity-60"
      >
        <motion.div
          animate={{ rotate: isSpinning ? 360 : 0 }}
          transition={{ duration: 0.5, repeat: isSpinning ? Infinity : 0 }}
        >
          <RotateCw className="h-5 w-5 text-green-400" />
        </motion.div>
        <span className="font-medium text-foreground">
          {isSpinning ? "Spinning..." : "Spin for new prompt"}
        </span>
      </button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={handleUpload}
        aria-pressed={photoUploaded}
        className={cn(
          "flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all",
          photoUploaded
            ? "border-green-500/50 bg-green-500/20"
            : "border-green-500/30 bg-secondary/50 hover:border-green-500/50",
        )}
      >
        {photoUploaded ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/30">
              <span className="text-2xl">✓</span>
            </div>
            <span className="font-medium text-green-400">Photo ready!</span>
          </>
        ) : (
          <>
            <Camera className="h-8 w-8 text-green-400" />
            <span className="text-muted-foreground">Tap to take photo</span>
          </>
        )}
      </motion.button>
    </ArcadeCreatorShell>
  );
};
