import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Plus, X, Loader2, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { supabase } from "@/integrations/supabase/client";
import { getImageUrl } from "@/utils/imageUrl";
import { toast } from "sonner";

const MAX_PHOTOS = 6;
const MIN_PHOTOS = 2;

interface PhotosStepProps {
  photos: string[];
  onPhotosChange: (v: string[]) => void;
  onNext: () => void;
  userId: string;
}

export const PhotosStep = ({ photos, onPhotosChange, onNext, userId }: PhotosStepProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);

  const handleSlotClick = (slot: number) => {
    if (photos[slot]) return;
    setPendingSlot(slot);
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || pendingSlot === null) return;
    e.target.value = "";

    const slot = pendingSlot;
    setPendingSlot(null);
    setUploadingSlot(slot);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const path = await uploadImageToBunny(file, session.access_token);
      const next = [...photos];
      next[slot] = path;
      const filtered = next.filter(Boolean);
      onPhotosChange(filtered);
    } catch (err: any) {
      toast.error(err?.message || "Upload failed. Please try again.");
    } finally {
      setUploadingSlot(null);
    }
  };

  const removePhoto = (idx: number) => {
    onPhotosChange(photos.filter((_, i) => i !== idx));
  };

  const buttonLabel =
    photos.length === 0
      ? "Add at least 2 photos"
      : photos.length === 1
        ? "Add 1 more photo"
        : "Continue";

  return (
    <div className="flex flex-col gap-6 pt-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Add your photos
        </h1>
        <p className="text-muted-foreground mt-2">
          Profiles with 3+ photos get way more matches.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: MAX_PHOTOS }).map((_, i) => {
          const photo = photos[i];
          const isUploading = uploadingSlot === i;

          return (
            <motion.div
              key={i}
              className="relative aspect-[3/4] rounded-xl overflow-hidden"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
            >
              {photo ? (
                <>
                  <img
                    src={getImageUrl(photo)}
                    alt={`Photo ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                  {i === 0 && (
                    <div className="absolute top-1 left-1 flex items-center gap-1 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                      <Crown className="w-3 h-3" /> Main
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => handleSlotClick(photos.length)}
                  disabled={isUploading}
                  className="w-full h-full border-2 border-dashed border-secondary rounded-xl flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition-colors"
                >
                  {isUploading ? (
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-5 h-5 text-muted-foreground" />
                      {i < MIN_PHOTOS && (
                        <span className="text-[10px] text-muted-foreground">Required</span>
                      )}
                    </>
                  )}
                </button>
              )}
            </motion.div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        💡 First photo should clearly show your face.
      </p>

      <Button
        onClick={onNext}
        disabled={photos.length < MIN_PHOTOS}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        {buttonLabel}
      </Button>
    </div>
  );
};
