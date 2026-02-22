import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScavengerPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Camera, Lock, Image } from "lucide-react";

interface ScavengerGameProps {
  payload: ScavengerPayload;
  isOwn: boolean;
  onUploadPhoto?: (photoUrl: string) => void;
}

export const ScavengerGame = ({ payload, isOwn, onUploadPhoto }: ScavengerGameProps) => {
  const [hasReplied, setHasReplied] = useState(!!payload.data.receiverPhotoUrl);
  const isUnlocked = payload.data.isUnlocked;

  // Mock photo upload
  const handleUploadPhoto = () => {
    // In real implementation, this would open camera/gallery
    const mockPhoto = "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400";
    setHasReplied(true);
    onUploadPhoto?.(mockPhoto);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-full max-w-[280px] rounded-2xl overflow-hidden",
        "bg-gradient-to-br from-green-500/20 to-emerald-600/20",
        "border border-green-500/30 backdrop-blur-sm"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-green-500/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📸</span>
          <div>
            <h4 className="font-semibold text-sm text-foreground">Scavenger Hunt</h4>
            <p className="text-xs text-muted-foreground">
              {isUnlocked ? "Photos revealed!" : "Reply to unlock"}
            </p>
          </div>
        </div>
      </div>

      {/* Prompt */}
      <div className="p-3 text-center border-b border-green-500/20">
        <p className="text-sm font-medium text-foreground">{payload.data.prompt}</p>
      </div>

      {/* Photos Grid */}
      <div className="p-3 grid grid-cols-2 gap-2">
        {/* Sender's Photo */}
        <div className="aspect-square rounded-xl overflow-hidden relative">
          {isUnlocked ? (
            <motion.img
              initial={{ filter: "blur(20px)" }}
              animate={{ filter: "blur(0px)" }}
              transition={{ duration: 0.5 }}
              src={payload.data.senderPhotoUrl || "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400"}
              alt="Sender's photo"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-secondary/50 flex items-center justify-center relative">
              {/* Blurred placeholder */}
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/20 to-emerald-500/20" 
                   style={{ filter: 'blur(5px)' }}>
                <Image className="w-8 h-8 text-muted-foreground/30 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <Lock className="w-6 h-6 text-muted-foreground relative z-10" />
            </div>
          )}
          <div className="absolute bottom-1 left-1 text-xs px-1.5 py-0.5 rounded bg-background/80 text-foreground">
            {isOwn ? 'You' : 'Them'}
          </div>
        </div>

        {/* Receiver's Photo / Upload Button */}
        <div className="aspect-square rounded-xl overflow-hidden relative">
          {isUnlocked && hasReplied ? (
            <motion.img
              initial={{ filter: "blur(20px)" }}
              animate={{ filter: "blur(0px)" }}
              transition={{ duration: 0.5, delay: 0.2 }}
              src={payload.data.receiverPhotoUrl || "https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=400"}
              alt="Receiver's photo"
              className="w-full h-full object-cover"
            />
          ) : hasReplied ? (
            <div className="w-full h-full bg-green-500/20 flex items-center justify-center">
              <p className="text-xs text-green-400 text-center px-2">Photo submitted! Waiting for reveal...</p>
            </div>
          ) : !isOwn ? (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleUploadPhoto}
              className="w-full h-full bg-secondary/50 hover:bg-green-500/20 flex flex-col items-center justify-center gap-2 transition-colors border-2 border-dashed border-green-500/30"
            >
              <Camera className="w-6 h-6 text-green-400" />
              <span className="text-xs text-green-400 font-medium">Reply with Photo</span>
            </motion.button>
          ) : (
            <div className="w-full h-full bg-secondary/30 flex items-center justify-center">
              <p className="text-xs text-muted-foreground text-center px-2">Waiting for reply...</p>
            </div>
          )}
          {(isUnlocked && hasReplied) && (
            <div className="absolute bottom-1 left-1 text-xs px-1.5 py-0.5 rounded bg-background/80 text-foreground">
              {isOwn ? 'Them' : 'You'}
            </div>
          )}
        </div>
      </div>

      {/* Status message */}
      {!isUnlocked && !isOwn && !hasReplied && (
        <div className="px-3 pb-3">
          <p className="text-xs text-center text-muted-foreground">
            Upload your photo to see theirs 👀
          </p>
        </div>
      )}
    </motion.div>
  );
};
