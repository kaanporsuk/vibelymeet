import { useState } from "react";
import { Plus, X, Sparkles, Crown } from "lucide-react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { cn } from "@/lib/utils";

interface PhotoGalleryProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  editable?: boolean;
}

export const PhotoGallery = ({ photos, onPhotosChange, editable = false }: PhotoGalleryProps) => {
  const [items, setItems] = useState(photos);
  const maxPhotos = 6;

  const handleReorder = (newOrder: string[]) => {
    setItems(newOrder);
    onPhotosChange(newOrder);
  };

  const handleRemove = (index: number) => {
    const newPhotos = items.filter((_, i) => i !== index);
    setItems(newPhotos);
    onPhotosChange(newPhotos);
  };

  const handleAdd = () => {
    // In real app, this would open file picker
    const mockNewPhoto = `https://images.unsplash.com/photo-${Date.now()}?w=400`;
    const newPhotos = [...items, mockNewPhoto];
    setItems(newPhotos);
    onPhotosChange(newPhotos);
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
              index === 0 ? "col-span-2 row-span-2 aspect-[4/5]" : "aspect-square"
            )}
          >
            <img
              src={photo}
              alt={`Photo ${index + 1}`}
              className="w-full h-full object-cover"
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
            onClick={handleAdd}
            className="aspect-square rounded-2xl border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Plus className="w-6 h-6 text-muted-foreground" />
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
