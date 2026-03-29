import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatPhotoItem = { id: string; url: string };

type ChatPhotoLightboxProps = {
  items: ChatPhotoItem[];
  initialId: string;
  onClose: () => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export function ChatPhotoLightbox({ items, initialId, onClose }: ChatPhotoLightboxProps) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number } | null>(null);

  useEffect(() => {
    const i = items.findIndex((it) => it.id === initialId);
    setIndex(i >= 0 ? i : 0);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [initialId, items]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && items.length > 1) {
        setIndex((p) => (p > 0 ? p - 1 : items.length - 1));
        setScale(1);
        setPan({ x: 0, y: 0 });
      }
      if (e.key === "ArrowRight" && items.length > 1) {
        setIndex((p) => (p < items.length - 1 ? p + 1 : 0));
        setScale(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  const current = items[index];
  const canPan = scale > 1.02;

  const resetTransform = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta));
      if (next <= MIN_SCALE) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { dist };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchRef.current.dist;
      pinchRef.current.dist = dist;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * ratio)));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  if (items.length === 0 || !current) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[200] flex flex-col bg-black"
    >
      <div className="relative z-10 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <span className="text-xs text-white/50 tabular-nums">
          {items.length > 1 ? `${index + 1} / ${items.length}` : "\u00a0"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-10 w-10 rounded-full text-white hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-6 w-6" />
        </Button>
      </div>

      {items.length > 1 && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute left-2 top-1/2 z-20 -translate-y-1/2 h-11 w-11 rounded-full text-white hover:bg-white/10"
            onClick={() => {
              setIndex((p) => (p > 0 ? p - 1 : items.length - 1));
              resetTransform();
            }}
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-8 w-8" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 z-20 -translate-y-1/2 h-11 w-11 rounded-full text-white hover:bg-white/10"
            onClick={() => {
              setIndex((p) => (p < items.length - 1 ? p + 1 : 0));
              resetTransform();
            }}
            aria-label="Next photo"
          >
            <ChevronRight className="h-8 w-8" />
          </Button>
        </>
      )}

      <div
        className="relative z-10 flex flex-1 items-center justify-center overflow-hidden px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <motion.div
          drag={canPan ? false : "y"}
          dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
          dragElastic={{ top: 0.4, bottom: 0.4, left: 0, right: 0 }}
          onDragEnd={(_, info) => {
            if (canPan) return;
            if (Math.abs(info.offset.y) > 88 || info.velocity.y > 400) {
              onClose();
            }
          }}
          className="flex max-h-full max-w-full items-center justify-center"
        >
          <div
            className={cn(
              "relative flex max-h-[min(88dvh,880px)] max-w-[min(96vw,1200px)] items-center justify-center",
              canPan && "touch-none",
            )}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: "center center",
            }}
            onPointerDown={(e) => {
              if (!canPan) return;
              e.preventDefault();
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              const el = e.currentTarget;
              const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
              const move = (ev: PointerEvent) => {
                setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
              };
              const up = () => {
                el.releasePointerCapture(e.pointerId);
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
            }}
          >
            <motion.img
              key={current.id}
              src={current.url}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="max-h-[min(88dvh,880px)] max-w-[min(96vw,1200px)] select-none object-contain"
            />
          </div>
        </motion.div>
      </div>

      <p className="pointer-events-none pb-2 text-center text-[10px] text-white/35">
        Pinch or scroll to zoom · drag down to close
      </p>
    </motion.div>
  );
}
