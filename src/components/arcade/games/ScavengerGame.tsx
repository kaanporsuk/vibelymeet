import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ScavengerPayload } from "@/types/games";
import { cn } from "@/lib/utils";
import { Camera, Lock, Image, ImagePlus } from "lucide-react";
import { uploadWebScavengerPhoto } from "@/lib/scavengerPhotoUpload";
import { getImageUrl } from "@/utils/imageUrl";
import { useMediaAsset } from "@/hooks/useMediaAsset";

interface ScavengerGameProps {
  payload: ScavengerPayload;
  isOwn: boolean;
  matchId?: string | null;
  senderPhotoMessageId?: string | null;
  receiverPhotoMessageId?: string | null;
  onUploadPhoto?: (photoUrl: string) => void;
}

function isImmediatelyDisplayablePhotoRef(value: string | null | undefined): boolean {
  return !!value && /^(https?:|blob:|data:)/i.test(value);
}

function ResolvedScavengerPhoto({
  sourceRef,
  messageId,
  alt,
}: {
  sourceRef: string;
  messageId?: string | null;
  alt: string;
}) {
  const initialUrl = isImmediatelyDisplayablePhotoRef(sourceRef) ? sourceRef : null;
  const media = useMediaAsset({
    kind: "image",
    messageId,
    sourceRef,
    initialUrl,
    enabled: !!sourceRef,
  });
  const src = media.url ? getImageUrl(media.url) : initialUrl ? getImageUrl(initialUrl) : "";
  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-secondary/40">
        <Image className="h-7 w-7 text-muted-foreground/50" />
      </div>
    );
  }
  return <img src={src} alt={alt} className="h-full w-full object-cover" />;
}

export const ScavengerGame = ({
  payload,
  isOwn,
  matchId,
  senderPhotoMessageId,
  receiverPhotoMessageId,
  onUploadPhoto,
}: ScavengerGameProps) => {
  const [hasReplied, setHasReplied] = useState(!!payload.data.receiverPhotoUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const isUnlocked = payload.data.isUnlocked;

  const handlePhotoFile = async (file: File | undefined | null) => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const photoUrl = await uploadWebScavengerPhoto(file, matchId);
      setHasReplied(true);
      onUploadPhoto?.(photoUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload this photo.");
    } finally {
      setUploading(false);
    }
  };

  const compact = isUnlocked || hasReplied;
  const senderPhotoRef = payload.data.senderPhotoUrl?.trim() || "";
  const receiverPhotoRef = payload.data.receiverPhotoUrl?.trim() || "";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "w-full max-w-[min(100%,19rem)] rounded-xl overflow-hidden break-words",
        "bg-gradient-to-br from-green-500/20 to-emerald-600/20",
        "border border-green-500/30 backdrop-blur-sm"
      )}
    >
      {/* Header */}
      <div className={cn("border-b border-green-500/20", compact ? "px-2 py-1.5" : "px-2.5 py-2")}>
        <div className="flex items-center gap-1.5">
          <span className={compact ? "text-base" : "text-xl"}>📸</span>
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-foreground leading-tight">Scavenger Hunt</h4>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {isUnlocked ? "Photos revealed!" : "Reply to unlock"}
            </p>
          </div>
        </div>
      </div>

      {/* Prompt */}
      <div className={cn("text-center border-b border-green-500/20", compact ? "px-2 py-1.5" : "px-2.5 py-2")}>
        <p className="text-xs font-medium text-foreground leading-snug">{payload.data.prompt}</p>
      </div>

      {/* Photos Grid */}
      <div className={cn("grid grid-cols-2", compact ? "p-1.5 gap-1" : "p-2 gap-1.5")}>
        {/* Sender's Photo */}
        <div className="aspect-square rounded-lg overflow-hidden relative">
          {isUnlocked && senderPhotoRef ? (
            <motion.div
              initial={{ filter: "blur(20px)" }}
              animate={{ filter: "blur(0px)" }}
              transition={{ duration: 0.5 }}
              className="w-full h-full object-cover"
            >
              <ResolvedScavengerPhoto
                sourceRef={senderPhotoRef}
                messageId={senderPhotoMessageId}
                alt="Sender's photo"
              />
            </motion.div>
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
        <div className="aspect-square rounded-lg overflow-hidden relative">
          {isUnlocked && hasReplied && receiverPhotoRef ? (
            <motion.div
              initial={{ filter: "blur(20px)" }}
              animate={{ filter: "blur(0px)" }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="w-full h-full object-cover"
            >
              <ResolvedScavengerPhoto
                sourceRef={receiverPhotoRef}
                messageId={receiverPhotoMessageId}
                alt="Receiver's photo"
              />
            </motion.div>
          ) : hasReplied ? (
            <div className="w-full h-full bg-green-500/20 flex items-center justify-center">
              <p className="text-xs text-green-400 text-center px-2">Photo submitted! Waiting for reveal...</p>
            </div>
          ) : !isOwn ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed border-green-500/30 bg-secondary/50 p-2">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  void handlePhotoFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={libraryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handlePhotoFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <Camera className="h-5 w-5 text-green-400" />
              <span className="text-center text-[11px] font-medium leading-tight text-green-400">
                {uploading ? "Uploading..." : "Reply with photo"}
              </span>
              <div className="grid w-full grid-cols-2 gap-1">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded-md bg-green-500/20 px-1.5 py-1 text-[10px] font-bold text-green-300 disabled:opacity-50"
                >
                  Camera
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => libraryInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded-md bg-green-500/20 px-1.5 py-1 text-[10px] font-bold text-green-300 disabled:opacity-50"
                >
                  <ImagePlus className="mx-auto h-3 w-3" />
                </motion.button>
              </div>
            </div>
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
        <div className="px-2.5 pb-2">
          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            {error ?? "Upload your photo to see theirs"}
          </p>
        </div>
      )}
    </motion.div>
  );
};
