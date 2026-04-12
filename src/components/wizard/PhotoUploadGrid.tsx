import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Camera, Plane, Music, Utensils, Dumbbell, X } from "lucide-react";
import { toast } from "sonner";

import { isAllowedProfilePhotoUploadFile, PROFILE_PHOTO_ACCEPT } from "@/lib/photoUtils";

interface PhotoUploadGridProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  onFilesChange?: (files: (File | null)[]) => void;
}

const placeholders = [
  { icon: Crown, text: "Main photo", hint: "Your best shot!" },
  { icon: Plane, text: "Travel pic", hint: "Show your adventures" },
  { icon: Music, text: "Hobby shot", hint: "What you love" },
  { icon: Utensils, text: "Food moment", hint: "Foodie vibes" },
  { icon: Dumbbell, text: "Active you", hint: "Show your energy" },
  { icon: Camera, text: "Fun photo", hint: "Make them smile" },
];

const PhotoUploadGrid = ({ photos, onPhotosChange, onFilesChange }: PhotoUploadGridProps) => {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [files, setFiles] = useState<(File | null)[]>(Array(6).fill(null));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const updateFiles = (newFiles: (File | null)[]) => {
    setFiles(newFiles);
    onFilesChange?.(newFiles);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, slot: number) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!isAllowedProfilePhotoUploadFile(file)) {
        toast.error("Use JPEG, PNG, or WebP for profile photos.");
        setActiveSlot(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const newPhotos = [...photos];
        newPhotos[slot] = reader.result as string;
        onPhotosChange(newPhotos);
        
        const newFiles = [...files];
        newFiles[slot] = file;
        updateFiles(newFiles);
      };
      reader.readAsDataURL(file);
    }
    setActiveSlot(null);
  };

  const handleDrop = (e: React.DragEvent, slot: number) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files?.[0];
    if (file && isAllowedProfilePhotoUploadFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        const newPhotos = [...photos];
        newPhotos[slot] = reader.result as string;
        onPhotosChange(newPhotos);
        
        const newFiles = [...files];
        newFiles[slot] = file;
        updateFiles(newFiles);
      };
      reader.readAsDataURL(file);
    } else if (file) {
      toast.error("Use JPEG, PNG, or WebP for profile photos.");
    }
  };

  const removePhoto = (slot: number) => {
    const newPhotos = [...photos];
    newPhotos[slot] = "";
    onPhotosChange(newPhotos);
    
    const newFiles = [...files];
    newFiles[slot] = null;
    updateFiles(newFiles);
  };

  const triggerUpload = (slot: number) => {
    setActiveSlot(slot);
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={PROFILE_PHOTO_ACCEPT}
        className="hidden"
        onChange={(e) => activeSlot !== null && handleFileSelect(e, activeSlot)}
      />

      <div className="grid grid-cols-3 gap-3">
        {placeholders.map((placeholder, index) => {
          const hasPhoto = photos[index] && photos[index] !== "";
          const Icon = placeholder.icon;
          const isMain = index === 0;

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() => !hasPhoto && triggerUpload(index)}
              className={`
                relative aspect-[3/4] rounded-2xl overflow-hidden cursor-pointer
                transition-all duration-300
                ${isMain ? "col-span-2 row-span-2" : ""}
                ${dragOver === index ? "ring-2 ring-primary scale-105" : ""}
                ${!hasPhoto ? "border-2 border-dashed border-border hover:border-primary/50 hover:bg-secondary/50" : ""}
              `}
            >
              <AnimatePresence mode="wait">
                {hasPhoto ? (
                  <motion.div
                    key="photo"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative w-full h-full group"
                  >
                    <img
                      src={photos[index]}
                      alt={`Photo ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    
                    {/* Main photo badge */}
                    {isMain && (
                      <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 flex items-center gap-1">
                        <Crown className="w-3 h-3 text-white" />
                        <span className="text-xs font-bold text-white">Main</span>
                      </div>
                    )}

                    {/* Remove button */}
                    <motion.button
                      initial={{ opacity: 0, scale: 0 }}
                      whileHover={{ scale: 1.1 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto(index);
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4 text-foreground" />
                    </motion.button>

                    {/* Hover overlay */}
                    <div 
                      className="absolute inset-0 bg-background/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      onClick={() => triggerUpload(index)}
                    >
                      <Camera className="w-8 h-8 text-foreground" />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col items-center justify-center p-3 bg-secondary/30"
                  >
                    <div className={`
                      w-12 h-12 rounded-full flex items-center justify-center mb-2
                      ${isMain ? "bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30" : "bg-primary/10 border border-primary/20"}
                    `}>
                      <Icon className={`w-5 h-5 ${isMain ? "text-yellow-500" : "text-primary"}`} />
                    </div>
                    <span className="text-xs font-medium text-foreground text-center">
                      {placeholder.text}
                    </span>
                    <span className="text-[10px] text-muted-foreground text-center mt-1">
                      {placeholder.hint}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Drag & drop photos or tap to upload
      </p>
    </div>
  );
};

export default PhotoUploadGrid;
