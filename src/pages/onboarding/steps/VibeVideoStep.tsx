import { useRef, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { heroVideoStart } from "@/lib/heroVideo/heroVideoUploadController";
import VibeStudioModal from "@/components/vibe-video/VibeStudioModal";

interface VibeVideoStepProps {
  onNext: () => void;
  onSkip: () => void;
}

const MAX_DURATION_S = 20;

export const VibeVideoStep = ({ onNext, onSkip }: VibeVideoStepProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  // Tracks whether heroVideoStart() was called during the current modal session.
  // Reset on every open; set only via onUploadStarted — never from global controller state.
  const uploadStartedThisSession = useRef(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.type.startsWith("video/")) {
      toast.error("Please select a video file.");
      return;
    }

    // Duration guard
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        const url = URL.createObjectURL(file);
        video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
        video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
        video.src = url;
      });
      if (duration > MAX_DURATION_S) {
        toast.error(`Video must be ${MAX_DURATION_S} seconds or shorter.`);
        return;
      }
    } catch {
      // Can't read duration — allow; Bunny will enforce server-side
    }

    // Hand off to controller — upload runs in the background.
    heroVideoStart(file);
    onNext();
  };

  return (
    <>
      <div className="flex flex-col gap-6 pt-12 items-center text-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">
            Stand out with a Vibe Video
          </h1>
          <p className="text-muted-foreground mt-2">
            Show your energy before the first chat.
          </p>
        </div>

        <div className="w-full aspect-[9/16] max-w-[200px] rounded-2xl glass-card flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
              <Video className="w-6 h-6 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground">Your video will appear on your profile</p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="w-full space-y-3">
          <Button
            onClick={() => {
              uploadStartedThisSession.current = false;
              setShowRecorder(true);
            }}
            className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
          >
            <span className="flex items-center gap-2">
              <Video className="w-4 h-4" /> Record a Vibe Video
            </span>
          </Button>

          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            className="w-full py-6"
          >
            Upload a video (up to {MAX_DURATION_S}s)
          </Button>

          <button
            onClick={onSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-center"
          >
            I'll do this later
          </button>
        </div>
      </div>

      <VibeStudioModal
        open={showRecorder}
        onUploadStarted={() => {
          uploadStartedThisSession.current = true;
        }}
        onOpenChange={(open) => {
          setShowRecorder(open);
          // Advance only if heroVideoStart() was confirmed during this exact modal
          // session — not based on global controller state, which can be non-idle
          // from a prior attempt unrelated to this open cycle.
          if (!open && uploadStartedThisSession.current) onNext();
        }}
      />
    </>
  );
};
