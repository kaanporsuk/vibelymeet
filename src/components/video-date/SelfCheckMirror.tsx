import { motion } from "framer-motion";
import { Camera, CameraOff, Mic, MicOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AudioVisualizer } from "./AudioVisualizer";

interface SelfCheckMirrorProps {
  isCameraOn: boolean;
  isMicOn: boolean;
  isBlurOn: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onToggleBlur: () => void;
}

export const SelfCheckMirror = ({
  isCameraOn,
  isMicOn,
  isBlurOn,
  onToggleCamera,
  onToggleMic,
  onToggleBlur,
}: SelfCheckMirrorProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="relative w-full max-w-md aspect-[3/4] rounded-[2rem] overflow-hidden"
    >
      {/* Video Feed / Placeholder */}
      <div className="absolute inset-0 bg-gradient-to-br from-secondary to-background">
        {isCameraOn ? (
          <img
            src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=600&fit=crop"
            alt="Your camera"
            className={`w-full h-full object-cover ${isBlurOn ? 'blur-sm' : ''}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <CameraOff className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Camera Off</p>
            </div>
          </div>
        )}
      </div>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

      {/* "You" Label */}
      <div className="absolute top-4 left-4">
        <div className="px-3 py-1 rounded-full bg-background/60 backdrop-blur-md border border-border/30">
          <span className="text-sm font-medium text-foreground">You</span>
        </div>
      </div>

      {/* Audio Visualizer */}
      <div className="absolute bottom-20 left-0 right-0">
        <AudioVisualizer isActive={isMicOn && isCameraOn} />
      </div>

      {/* Floating Controls */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 rounded-2xl bg-background/60 backdrop-blur-xl border border-border/30"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCamera}
          className={`rounded-xl transition-all ${
            !isCameraOn ? 'bg-destructive/20 text-destructive' : 'hover:bg-secondary'
          }`}
        >
          {isCameraOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleMic}
          className={`rounded-xl transition-all ${
            !isMicOn ? 'bg-destructive/20 text-destructive' : 'hover:bg-secondary'
          }`}
        >
          {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </Button>

        <div className="w-px h-6 bg-border/50" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleBlur}
          className={`rounded-xl transition-all ${
            isBlurOn ? 'bg-primary/20 text-primary' : 'hover:bg-secondary'
          }`}
        >
          <Sparkles className="w-5 h-5" />
        </Button>
      </motion.div>

      {/* Glow Effect */}
      <div className="absolute -inset-1 rounded-[2.5rem] bg-gradient-to-r from-[hsl(var(--neon-violet)/0.3)] to-[hsl(var(--neon-pink)/0.3)] blur-xl -z-10" />
    </motion.div>
  );
};
