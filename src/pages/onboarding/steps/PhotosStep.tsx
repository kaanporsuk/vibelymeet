import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, X, Loader2, Crown, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { supabase } from "@/integrations/supabase/client";
import { getImageUrl } from "@/utils/imageUrl";
import { toast } from "sonner";

const MAX_PHOTOS = 6;
const MIN_PHOTOS = 2;

type QueueItem = {
  id: string;
  file: File;
  preview: string;
  status: "uploading" | "failed";
  error?: string;
};

interface PhotosStepProps {
  photos: string[];
  onPhotosChange: (v: string[]) => void;
  onNext: () => void;
  userId: string;
}

export const PhotosStep = ({ photos, onPhotosChange, onNext }: PhotosStepProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  // Always-current photos ref so async callbacks don't capture stale prop value
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Track all blob URLs so we can revoke them on unmount
  const blobUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => { blobUrlsRef.current.forEach(URL.revokeObjectURL); };
  }, []);

  const revokeBlob = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    blobUrlsRef.current = blobUrlsRef.current.filter((u) => u !== url);
  }, []);

  const uploadItem = useCallback(async (item: QueueItem, session: { access_token: string }) => {
    try {
      const path = await uploadImageToBunny(item.file, session.access_token, null, "onboarding");
      // Remove from queue — success lands in parent's photos via caller
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
      revokeBlob(item.preview);
      return path;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "failed" as const, error: msg } : q))
      );
      return null;
    }
  }, [revokeBlob]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const currentPhotos = photosRef.current;
    const currentQueue = queue; // snapshot — set state will supersede
    const totalOccupied = currentPhotos.length + currentQueue.length;
    const available = MAX_PHOTOS - totalOccupied;

    if (available <= 0) {
      toast.error("Maximum 6 photos reached");
      return;
    }

    const toAdd = files.slice(0, available);

    const newItems: QueueItem[] = toAdd.map((file) => {
      const preview = URL.createObjectURL(file);
      blobUrlsRef.current.push(preview);
      return { id: crypto.randomUUID(), file, preview, status: "uploading" as const };
    });

    setQueue((prev) => [...prev, ...newItems]);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Not authenticated");
      setQueue((prev) => prev.filter((q) => !newItems.find((i) => i.id === q.id)));
      newItems.forEach((i) => revokeBlob(i.preview));
      return;
    }

    // Upload all in parallel; collect successful paths
    const results = await Promise.allSettled(newItems.map((item) => uploadItem(item, session)));

    const newPaths = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);

    if (newPaths.length > 0) {
      onPhotosChange([...photosRef.current, ...newPaths]);
    }
  }, [queue, uploadItem, onPhotosChange, revokeBlob]);

  const retryItem = useCallback(async (itemId: string) => {
    const item = queue.find((q) => q.id === itemId);
    if (!item) return;

    setQueue((prev) =>
      prev.map((q) => (q.id === itemId ? { ...q, status: "uploading" as const, error: undefined } : q))
    );

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Not authenticated");
      setQueue((prev) =>
        prev.map((q) => (q.id === itemId ? { ...q, status: "failed" as const, error: "Not authenticated" } : q))
      );
      return;
    }

    const path = await uploadItem(item, session);
    if (path) {
      onPhotosChange([...photosRef.current, path]);
    }
  }, [queue, uploadItem, onPhotosChange]);

  const removeQueued = useCallback((itemId: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === itemId);
      if (item) revokeBlob(item.preview);
      return prev.filter((q) => q.id !== itemId);
    });
  }, [revokeBlob]);

  const removePhoto = useCallback((idx: number) => {
    onPhotosChange(photos.filter((_, i) => i !== idx));
  }, [photos, onPhotosChange]);

  const hasUploading = queue.some((q) => q.status === "uploading");
  const canContinue = photos.length >= MIN_PHOTOS && !hasUploading;

  const totalDisplayed = photos.length + queue.length;
  const emptySlots = Math.max(0, MAX_PHOTOS - totalDisplayed);

  const buttonLabel =
    photos.length === 0
      ? "Add at least 2 photos"
      : photos.length === 1
        ? "Add 1 more photo"
        : hasUploading
          ? "Uploading…"
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
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="grid grid-cols-3 gap-3">
        {/* Confirmed (uploaded) photos */}
        {photos.map((photo, i) => (
          <motion.div
            key={`photo-${i}-${photo}`}
            className="relative aspect-[3/4] rounded-xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04 }}
          >
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
          </motion.div>
        ))}

        {/* Queued items — uploading or failed */}
        {queue.map((item, i) => (
          <motion.div
            key={item.id}
            className="relative aspect-[3/4] rounded-xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04 }}
          >
            <img
              src={item.preview}
              alt="Queued"
              className="w-full h-full object-cover"
            />

            {item.status === "uploading" && (
              <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}

            {item.status === "failed" && (
              <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center gap-1.5 p-2">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <p className="text-[10px] text-white/80 text-center leading-tight line-clamp-2">
                  {item.error ?? "Upload failed"}
                </p>
                <button
                  onClick={() => void retryItem(item.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-[10px] text-white"
                >
                  <RotateCcw className="w-3 h-3" /> Retry
                </button>
              </div>
            )}

            <button
              onClick={() => removeQueued(item.id)}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </motion.div>
        ))}

        {/* Empty slots */}
        {Array.from({ length: emptySlots }).map((_, i) => {
          const slotNum = totalDisplayed + i;
          return (
            <motion.div
              key={`empty-${i}`}
              className="relative aspect-[3/4] rounded-xl overflow-hidden"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: slotNum * 0.04 }}
            >
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-full border-2 border-dashed border-secondary rounded-xl flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition-colors"
              >
                <Plus className="w-5 h-5 text-muted-foreground" />
                {slotNum < MIN_PHOTOS && (
                  <span className="text-[10px] text-muted-foreground">Required</span>
                )}
              </button>
            </motion.div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        💡 Select multiple photos at once — they&apos;ll fill your slots automatically.
      </p>

      <Button
        onClick={onNext}
        disabled={!canContinue}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        {buttonLabel}
      </Button>
    </div>
  );
};
