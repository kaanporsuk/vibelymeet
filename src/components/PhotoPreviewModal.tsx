import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PhotoPreviewModalProps {
  photos: string[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
  showZoom?: boolean;
}

export const PhotoPreviewModal = ({
  photos,
  initialIndex = 0,
  isOpen,
  onClose,
  showZoom = true,
}: PhotoPreviewModalProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsZoomed(false);
    }
  }, [isOpen, initialIndex]);

  const handleNext = useCallback(() => {
    if (!isZoomed) {
      setCurrentIndex((prev) => (prev + 1) % photos.length);
    }
  }, [photos.length, isZoomed]);

  const handlePrev = useCallback(() => {
    if (!isZoomed) {
      setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
    }
  }, [photos.length, isZoomed]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") handleNext();
      if (e.key === "ArrowLeft") handlePrev();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handleNext, handlePrev]);

  if (!isOpen || photos.length === 0) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-lg flex flex-col"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isZoomed) onClose();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 shrink-0">
            <div className="text-sm text-muted-foreground">
              {currentIndex + 1} / {photos.length}
            </div>
            <div className="flex items-center gap-2">
              {showZoom && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsZoomed(!isZoomed)}
                  className="w-10 h-10 rounded-full"
                >
                  {isZoomed ? (
                    <ZoomOut className="w-5 h-5" />
                  ) : (
                    <ZoomIn className="w-5 h-5" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-10 h-10 rounded-full"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Photo container */}
          <div className="flex-1 flex items-center justify-center relative overflow-hidden px-4 min-h-0">
            {/* Navigation arrows */}
            {photos.length > 1 && !isZoomed && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrev}
                  className="absolute left-4 z-10 w-12 h-12 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70"
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNext}
                  className="absolute right-4 z-10 w-12 h-12 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70"
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}

            {/* Photo with animation */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "flex items-center justify-center w-full h-full",
                  isZoomed && "cursor-zoom-out overflow-auto",
                  !isZoomed && "cursor-zoom-in"
                )}
                onClick={() => showZoom && setIsZoomed(!isZoomed)}
              >
                <img
                  src={photos[currentIndex]}
                  alt={`Photo ${currentIndex + 1}`}
                  className={cn(
                    "max-w-full max-h-full object-contain rounded-xl transition-transform duration-300",
                    isZoomed && "scale-150 max-h-none max-w-none"
                  )}
                  draggable={false}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Thumbnail strip */}
          {photos.length > 1 && !isZoomed && (
            <div className="shrink-0 px-4 pb-4">
              <div className="flex justify-center gap-2 overflow-x-auto py-2 max-w-full">
                {photos.map((photo, index) => (
                  <motion.button
                    key={index}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setCurrentIndex(index)}
                    className={cn(
                      "shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all",
                      index === currentIndex
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-transparent opacity-60 hover:opacity-100"
                    )}
                  >
                    <img
                      src={photo}
                      alt={`Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
