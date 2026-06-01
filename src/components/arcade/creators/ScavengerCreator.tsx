import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, ImagePlus, RotateCw } from "lucide-react";
import { SCAVENGER_PROMPTS } from "@/types/games";
import { cn } from "@/lib/utils";
import { ArcadeCreatorShell } from "./ArcadeCreatorShell";
import { uploadWebScavengerPhoto } from "@/lib/scavengerPhotoUpload";

interface ScavengerCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  matchId?: string | null;
  onSubmit: (prompt: string, photoUrl: string) => void;
}

export const ScavengerCreator = ({ isOpen, onClose, matchId, onSubmit }: ScavengerCreatorProps) => {
  const [prompt, setPrompt] = useState(() => 
    SCAVENGER_PROMPTS[Math.floor(Math.random() * SCAVENGER_PROMPTS.length)]
  );
  const [isSpinning, setIsSpinning] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const spinIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current !== null) {
        window.clearInterval(spinIntervalRef.current);
      }
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    if (!isOpen) {
      setPhotoFile(null);
      setError(null);
      setUploading(false);
      setPhotoPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    }
  }, [isOpen]);

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

  const handleFileSelected = (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    setPhotoFile(file);
    setPhotoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  };

  const handleSubmit = async () => {
    if (!photoFile || isSpinning || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const photoUrl = await uploadWebScavengerPhoto(photoFile, matchId);
      onSubmit(prompt, photoUrl);
      setPhotoFile(null);
      setPhotoPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      spinWheel();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not upload this photo.");
    } finally {
      setUploading(false);
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
          onClick={() => void handleSubmit()}
          disabled={!photoFile || isSpinning || uploading}
          className="w-full rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Send Challenge"}
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

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          handleFileSelected(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleFileSelected(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      <div
        className={cn(
          "relative flex aspect-video w-full overflow-hidden rounded-xl border-2 border-dashed transition-all",
          photoFile ? "border-green-500/50 bg-green-500/20" : "border-green-500/30 bg-secondary/50",
        )}
      >
        {photoPreview ? (
          <img src={photoPreview} alt="Selected scavenger challenge" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <Camera className="h-8 w-8 text-green-400" />
            <span className="text-muted-foreground">Add a photo</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => cameraInputRef.current?.click()}
          disabled={uploading}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-60"
        >
          <Camera className="h-4 w-4 text-green-400" />
          Take photo
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => libraryInputRef.current?.click()}
          disabled={uploading}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary px-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-60"
        >
          <ImagePlus className="h-4 w-4 text-green-400" />
          Choose
        </motion.button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </ArcadeCreatorShell>
  );
};
