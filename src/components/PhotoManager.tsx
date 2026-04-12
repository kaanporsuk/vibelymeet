import { useRef, useState } from "react";
import { Plus, X, Crown, Upload, GripVertical, Image as ImageIcon, Expand } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isAllowedProfilePhotoUploadFile, PROFILE_PHOTO_ACCEPT, resolvePhotoUrl } from "@/lib/photoUtils";
import { PhotoPreviewModal } from "@/components/PhotoPreviewModal";

interface PhotoManagerProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  photoFiles?: (File | null)[];
  onPhotoFilesChange?: (files: (File | null)[]) => void;
}

const MAX_PHOTOS = 6;

export const PhotoManager = ({
  photos,
  onPhotosChange,
  photoFiles = [],
  onPhotoFilesChange,
}: PhotoManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ isOpen: boolean; index: number }>({
    isOpen: false,
    index: 0,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = MAX_PHOTOS - photos.length;
    const picked = Array.from(files);
    const allowed = picked.filter(isAllowedProfilePhotoUploadFile);
    if (allowed.length < picked.length) {
      toast.error("Use JPEG, PNG, or WebP for profile photos.");
    }
    const filesToAdd = allowed.slice(0, remainingSlots);

    const newPhotos = [...photos];
    const newFiles = [...photoFiles];

    filesToAdd.forEach((file) => {
      const url = URL.createObjectURL(file);
      newPhotos.push(url);
      newFiles.push(file);
    });

    onPhotosChange(newPhotos);
    onPhotoFilesChange?.(newFiles);
    e.target.value = "";
  };

  const handleRemove = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    const newFiles = photoFiles.filter((_, i) => i !== index);
    
    onPhotosChange(newPhotos);
    onPhotoFilesChange?.(newFiles);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newPhotos = [...photos];
      const newFiles = [...photoFiles];

      // Swap positions
      const [draggedPhoto] = newPhotos.splice(draggedIndex, 1);
      newPhotos.splice(dragOverIndex, 0, draggedPhoto);

      const [draggedFile] = newFiles.splice(draggedIndex, 1);
      newFiles.splice(dragOverIndex, 0, draggedFile);

      onPhotosChange(newPhotos);
      onPhotoFilesChange?.(newFiles);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const moveToMain = (index: number) => {
    if (index === 0) return;
    
    const newPhotos = [...photos];
    const newFiles = [...photoFiles];

    const [photo] = newPhotos.splice(index, 1);
    newPhotos.unshift(photo);

    const [file] = newFiles.splice(index, 1);
    newFiles.unshift(file);

    onPhotosChange(newPhotos);
    onPhotoFilesChange?.(newFiles);
  };

  const emptySlots = MAX_PHOTOS - photos.length;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={PROFILE_PHOTO_ACCEPT}
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Photo Grid */}
      <div className="grid grid-cols-3 gap-3">
        <AnimatePresence mode="popLayout">
          {photos.map((photo, index) => (
            <motion.div
              key={photo}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ 
                opacity: draggedIndex === index ? 0.5 : 1, 
                scale: dragOverIndex === index ? 1.05 : 1,
              }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDragLeave={handleDragLeave}
              className={cn(
                "relative aspect-square rounded-2xl overflow-hidden group cursor-grab active:cursor-grabbing",
                index === 0 && "col-span-2 row-span-2",
                dragOverIndex === index && "ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
            >
              <img
                src={resolvePhotoUrl(photo)}
                alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover"
                draggable={false}
              />

              {/* Overlay with actions */}
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-background/40 opacity-0 group-hover:opacity-100 transition-opacity" />

              {/* Top left: Main badge OR Make Main button */}
              <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {index === 0 ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium">
                    <Crown className="w-3 h-3" />
                    Main
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs px-2 bg-background/80 backdrop-blur-sm hover:bg-background"
                    onClick={() => moveToMain(index)}
                  >
                    <Crown className="w-3 h-3 mr-1" />
                    Make Main
                  </Button>
                )}
              </div>

              {/* Top right: Expand and drag handle */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewPhoto({ isOpen: true, index });
                  }}
                >
                  <Expand className="w-3.5 h-3.5 text-foreground" />
                </Button>
                <div className="w-7 h-7 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              {/* Bottom right: Position number and delete */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-xs font-bold text-foreground">
                  {index + 1}
                </div>
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-7 w-7 rounded-full"
                  onClick={() => handleRemove(index)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          ))}

          {/* Empty slots / Add buttons */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <motion.button
              key={`empty-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "aspect-square rounded-2xl border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition-all group",
                photos.length === 0 && i === 0 && "col-span-2 row-span-2"
              )}
            >
              <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                {photos.length === 0 && i === 0 ? (
                  <ImageIcon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                ) : (
                  <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                )}
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                {photos.length === 0 && i === 0 ? "Add main photo" : "Add photo"}
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Upload Button */}
      {photos.length < MAX_PHOTOS && (
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4" />
          Upload Photos ({photos.length}/{MAX_PHOTOS})
        </Button>
      )}

      {/* Tips */}
      <div className="space-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <GripVertical className="w-3 h-3" />
          Drag photos to reorder them
        </p>
        <p className="flex items-center gap-2">
          <Crown className="w-3 h-3 text-primary" />
          Your main photo is shown first on your profile
        </p>
        <p className="flex items-center gap-2">
          <Expand className="w-3 h-3" />
          Tap expand to view full-screen
        </p>
      </div>

      {/* Photo Preview Modal */}
      <PhotoPreviewModal
        photos={photos}
        initialIndex={previewPhoto.index}
        isOpen={previewPhoto.isOpen}
        onClose={() => setPreviewPhoto({ isOpen: false, index: 0 })}
        showZoom={true}
      />
    </div>
  );
};
