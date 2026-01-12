import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, PanInfo, useAnimation } from "framer-motion";
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
  const [zoomScale, setZoomScale] = useState(1);
  const [dragDirection, setDragDirection] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lastTapRef = useRef<number>(0);
  const initialPinchDistanceRef = useRef<number | null>(null);
  const initialScaleRef = useRef<number>(1);
  const controls = useAnimation();

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsZoomed(false);
      setZoomScale(1);
      setDragDirection(null);
    }
  }, [isOpen, initialIndex]);

  // Handle double-tap to zoom
  const handleDoubleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    
    if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
      // Double tap detected
      if (isZoomed) {
        setZoomScale(1);
        setIsZoomed(false);
        controls.start({ scale: 1, x: 0, y: 0 });
      } else {
        setZoomScale(2.5);
        setIsZoomed(true);
        controls.start({ scale: 2.5 });
      }
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [isZoomed, controls]);

  // Pinch to zoom handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      initialPinchDistanceRef.current = distance;
      initialScaleRef.current = zoomScale;
    }
  }, [zoomScale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistanceRef.current !== null) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      const scale = (distance / initialPinchDistanceRef.current) * initialScaleRef.current;
      const clampedScale = Math.min(Math.max(scale, 1), 4);
      
      setZoomScale(clampedScale);
      setIsZoomed(clampedScale > 1);
      controls.start({ scale: clampedScale });
    }
  }, [controls]);

  const handleTouchEnd = useCallback(() => {
    initialPinchDistanceRef.current = null;
    
    // Snap back to 1 if scale is close to 1
    if (zoomScale < 1.1) {
      setZoomScale(1);
      setIsZoomed(false);
      controls.start({ scale: 1, x: 0, y: 0 });
    }
  }, [zoomScale, controls]);

  const handleNext = useCallback(() => {
    if (!isZoomed && currentIndex < photos.length - 1) {
      setDragDirection("left");
      setCurrentIndex((prev) => prev + 1);
    }
  }, [photos.length, isZoomed, currentIndex]);

  const handlePrev = useCallback(() => {
    if (!isZoomed && currentIndex > 0) {
      setDragDirection("right");
      setCurrentIndex((prev) => prev - 1);
    }
  }, [isZoomed, currentIndex]);

  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (isZoomed) return;

    const swipeThreshold = 50;
    const velocityThreshold = 500;

    if (
      info.offset.x < -swipeThreshold ||
      info.velocity.x < -velocityThreshold
    ) {
      handleNext();
    } else if (
      info.offset.x > swipeThreshold ||
      info.velocity.x > velocityThreshold
    ) {
      handlePrev();
    }
  };

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

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || photos.length === 0) return null;

  const slideVariants = {
    enter: (direction: "left" | "right" | null) => ({
      x: direction === "left" ? 300 : direction === "right" ? -300 : 0,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: "left" | "right" | null) => ({
      x: direction === "left" ? -300 : direction === "right" ? 300 : 0,
      opacity: 0,
    }),
  };

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
                  onClick={() => {
                    if (isZoomed) {
                      setZoomScale(1);
                      setIsZoomed(false);
                      controls.start({ scale: 1, x: 0, y: 0 });
                    } else {
                      setZoomScale(2.5);
                      setIsZoomed(true);
                      controls.start({ scale: 2.5 });
                    }
                  }}
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
          <div
            ref={containerRef}
            className="flex-1 flex items-center justify-center relative overflow-hidden px-4 min-h-0"
          >
            {/* Navigation arrows */}
            {photos.length > 1 && !isZoomed && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="absolute left-4 z-10 w-12 h-12 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70 disabled:opacity-30"
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNext}
                  disabled={currentIndex === photos.length - 1}
                  className="absolute right-4 z-10 w-12 h-12 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background/70 disabled:opacity-30"
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}

            {/* Photo with swipe animation */}
            <AnimatePresence mode="wait" custom={dragDirection}>
              <motion.div
                key={currentIndex}
                custom={dragDirection}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeOut" }}
                drag={!isZoomed && photos.length > 1 ? "x" : isZoomed ? true : false}
                dragConstraints={isZoomed ? { left: -200, right: 200, top: -200, bottom: 200 } : { left: 0, right: 0 }}
                dragElastic={isZoomed ? 0.1 : 0.2}
                onDragEnd={handleDragEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={handleDoubleTap}
                className={cn(
                  "flex items-center justify-center w-full h-full",
                  isZoomed && "cursor-grab active:cursor-grabbing",
                  !isZoomed && photos.length > 1 && "cursor-grab active:cursor-grabbing touch-pan-y",
                  !isZoomed && photos.length === 1 && showZoom && "cursor-zoom-in"
                )}
              >
                <motion.img
                  ref={imageRef}
                  src={photos[currentIndex]}
                  alt={`Photo ${currentIndex + 1}`}
                  animate={controls}
                  className="max-w-full max-h-full object-contain rounded-xl select-none"
                  draggable={false}
                  style={{ touchAction: isZoomed ? "none" : "pan-y" }}
                />
              </motion.div>
            </AnimatePresence>

            {/* Swipe hint for mobile */}
            {!isZoomed && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/60 md:hidden">
                {photos.length > 1 ? "Swipe to navigate • Double-tap to zoom" : "Double-tap to zoom"}
              </div>
            )}
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
                    onClick={() => {
                      setDragDirection(index > currentIndex ? "left" : "right");
                      setCurrentIndex(index);
                    }}
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
