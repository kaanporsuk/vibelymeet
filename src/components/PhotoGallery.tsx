import { useEffect, useRef, useState } from "react";
import { Plus, X, Sparkles, Crown, Upload } from "lucide-react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { cn } from "@/lib/utils";

interface PhotoGalleryProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  photoFiles?: (File | null)[];
  onPhotoFilesChange?: (files: (File | null)[]) => void;
  editable?: boolean;
  onPhotoClick?: (index: number) => void;
}

export const PhotoGallery = ({
  photos,
  onPhotosChange,
  photoFiles,
  onPhotoFilesChange,
  editable = false,
  onPhotoClick,
}: PhotoGalleryProps) => {
  const [items, setItems] = useState(photos);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const maxPhotos = 6;

  useEffect(() => {
    setItems(photos);
  }, [photos]);

  const syncFilesToNewOrder = (newOrder: string[], prevOrder: string[]) => {
    if (!photoFiles || !onPhotoFilesChange) return;

    const indexByPhoto = new Map<string, number>();
    prevOrder.forEach((p, idx) => indexByPhoto.set(p, idx));

    const nextFiles = newOrder.map((p) => photoFiles[indexByPhoto.get(p) ?? -1] ?? null);
    onPhotoFilesChange(nextFiles);
  };

  const handleReorder = (newOrder: string[]) => {
    setItems(newOrder);
    syncFilesToNewOrder(newOrder, items);
    onPhotosChange(newOrder);
  };

  const handleRemove = (index: number) => {
    const newPhotos = items.filter((_, i) => i !== index);
    setItems(newPhotos);
    onPhotosChange(newPhotos);

    if (photoFiles && onPhotoFilesChange) {
      const nextFiles = photoFiles.filter((_, i) => i !== index);
      onPhotoFilesChange(nextFiles);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (items.length >= maxPhotos) return;

    const url = URL.createObjectURL(file);
    const newPhotos = [...items, url];
    setItems(newPhotos);
    onPhotosChange(newPhotos);

    if (onPhotoFilesChange) {
      const nextFiles = [...(photoFiles ?? items.map(() => null)), file];
      onPhotoFilesChange(nextFiles);
    }

    // allow re-selecting the same file
    e.currentTarget.value = "";
  };

  if (!editable) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {photos.slice(0, 6).map((photo, index) => (
          <motion.div
            key={photo}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1 }}
            className={cn(
              "relative overflow-hidden rounded-2xl",
              index === 0 ? "col-span-2 row-span-2 aspect-[4/5]" : "aspect-square",
              onPhotoClick && "cursor-pointer"
            )}
            onClick={() => onPhotoClick?.(index)}
            whileHover={onPhotoClick ? { scale: 1.02 } : undefined}
            whileTap={onPhotoClick ? { scale: 0.98 } : undefined}
          >
            <img
              src={photo}
              alt={`Photo ${index + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {index === 0 && (
              <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-background/80 backdrop-blur-sm">
                <Crown className="w-3 h-3 text-neon-pink" />
                <span className="text-xs font-medium">Main</span>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      <p className="text-xs text-muted-foreground">
        Drag to reorder • First photo is your main vibe
      </p>

      <Reorder.Group
        axis="y"
        values={items}
        onReorder={handleReorder}
        className="grid grid-cols-3 gap-2"
      >
        <AnimatePresence>
          {items.map((photo, index) => (
            <Reorder.Item
              key={photo}
              value={photo}
              className={cn(
                "relative overflow-hidden rounded-2xl cursor-grab active:cursor-grabbing",
                index === 0 ? "col-span-2 row-span-2 aspect-[4/5]" : "aspect-square"
              )}
              whileDrag={{ scale: 1.05, zIndex: 10 }}
            >
              <img
                src={photo}
                alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />

              {/* Overlay gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent opacity-0 hover:opacity-100 transition-opacity" />

              {/* Main badge */}
              {index === 0 && (
                <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-neon-pink/20 backdrop-blur-sm border border-neon-pink/30">
                  <Crown className="w-3 h-3 text-neon-pink" />
                  <span className="text-xs font-medium text-neon-pink">Main</span>
                </div>
              )}

              {/* Remove button */}
              <button
                onClick={() => handleRemove(index)}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/80 backdrop-blur-sm flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                aria-label="Remove photo"
                title="Remove photo"
                type="button"
              >
                <X className="w-3 h-3" />
              </button>

              {/* Position indicator */}
              <div className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-xs font-bold">
                {index + 1}
              </div>
            </Reorder.Item>
          ))}
        </AnimatePresence>

        {/* Add photo button */}
        {items.length < maxPhotos && (
          <motion.button
            onClick={openFilePicker}
            className="aspect-square rounded-2xl border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
          >
            <div className="flex items-center justify-center gap-2">
              <Plus className="w-5 h-5 text-muted-foreground" />
              <Upload className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">Add</span>
          </motion.button>
        )}
      </Reorder.Group>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="w-3 h-3 text-neon-violet" />
        <span>Pro tip: Variety wins. Show your range.</span>
      </div>
    </div>
  );
};

