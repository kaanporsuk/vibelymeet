import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  X,
  Plus,
  Loader2,
  Crown,
  Maximize2,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { thumbnailUrl, fullScreenUrl } from "@/utils/imageUrl";
import { uploadImageToBunny } from "@/services/imageUploadService";
import { updateMyProfile } from "@/services/profileService";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────

interface PhotoManageDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  photos: string[];
  onPhotosChanged: () => void;
}

const MAX_PHOTOS = 6;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getCoachingMessage(count: number): string {
  if (count === 0) return "Add your first photo to get started";
  if (count < 3) return "Add at least 3 photos — profiles with 4+ get 2x more vibes";
  if (count < 6) return `You have ${6 - count} empty slots — a full set gets more attention`;
  return "Looking great! Your photos tell a complete story.";
}

// ─── Sortable tile with hover overlay ───────────────────────────

interface SortableTileProps {
  id: string;
  url: string | null;
  index: number;
  isMain: boolean;
  uploading: boolean;
  onMakeMain: (i: number) => void;
  onExpand: (i: number) => void;
  onDelete: (i: number) => void;
  onReplace: (i: number) => void;
  onEmptyClick: () => void;
  isOverlay?: boolean;
}

function SortableTile({
  id,
  url,
  index,
  isMain,
  uploading,
  onMakeMain,
  onExpand,
  onDelete,
  onReplace,
  onEmptyClick,
  isOverlay,
}: SortableTileProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !url });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  if (!url) {
    return (
      <button
        ref={setNodeRef}
        style={style}
        onClick={onEmptyClick}
        className={cn(
          "relative rounded-xl overflow-hidden flex flex-col items-center justify-center gap-1",
          "border-2 border-dashed border-violet-500/20 bg-white/[0.03]",
          "hover:border-violet-500/40 hover:bg-white/[0.02] transition-colors",
          "cursor-pointer w-full h-full"
        )}
      >
        {uploading ? (
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
        ) : (
          <>
            <Plus className="w-7 h-7 text-white/20" />
            <span className="text-xs text-white/15">Add photo</span>
          </>
        )}
      </button>
    );
  }

  if (isOverlay) {
    return (
      <div className="relative rounded-xl overflow-hidden shadow-2xl ring-2 ring-violet-500/50 w-full h-full">
        <img src={thumbnailUrl(url)} alt="" className="w-full h-full object-cover" draggable={false} />
        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-violet-500/80 text-white text-xs font-bold flex items-center justify-center">
          {index + 1}
        </div>
      </div>
    );
  }

  /** Second grid row: slots 3–5 — narrow tiles need split columns so all 4 actions stay visible */
  const isBottomRowTile = index >= 3;

  const actionIconClass =
    "w-7 h-7 shrink-0 rounded-full bg-black/70 flex items-center justify-center hover:bg-white/20 transition-colors";
  const makeMainIconClass =
    "w-7 h-7 shrink-0 rounded-full bg-black/70 flex items-center justify-center hover:bg-violet-500/80 transition-colors";
  const deleteIconClass =
    "w-7 h-7 shrink-0 rounded-full bg-black/70 flex items-center justify-center hover:bg-red-500/80 transition-colors";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-xl overflow-hidden w-full h-full cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <img src={thumbnailUrl(url)} alt="" className="w-full h-full object-cover" draggable={false} />

      {/* Hover overlay */}
      <div
        className={cn(
          "absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-200 p-2 opacity-0 group-hover:opacity-100",
          isBottomRowTile ? "flex flex-col gap-1" : "flex flex-col justify-between",
        )}
      >
        {isBottomRowTile ? (
          <>
            <div className="flex shrink-0 justify-start">
              <span className="w-6 h-6 rounded-full bg-black/70 text-white text-xs font-bold flex items-center justify-center">
                {index + 1}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-row items-center justify-between gap-2 px-0.5">
              <div
                className="flex flex-col items-center gap-1.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {!isMain && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMakeMain(index);
                    }}
                    title="Make Main"
                    className={makeMainIconClass}
                  >
                    <Crown size={14} className="text-white" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(index);
                  }}
                  title="View full size"
                  className={actionIconClass}
                >
                  <Maximize2 size={14} className="text-white" />
                </button>
              </div>
              <div
                className="flex flex-col items-center gap-1.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReplace(index);
                  }}
                  title="Replace"
                  className={actionIconClass}
                >
                  <RefreshCw size={14} className="text-white" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(index);
                  }}
                  title="Delete"
                  className={deleteIconClass}
                >
                  <Trash2 size={14} className="text-white" />
                </button>
              </div>
            </div>
            {isMain ? (
              <span className="shrink-0 self-start px-2 py-0.5 rounded bg-black/70 text-[10px] font-medium text-white flex items-center gap-1">
                👑 Main
              </span>
            ) : null}
          </>
        ) : (
          <>
            {/* Top row: position badge + action icons (upper grid row — horizontal) */}
            <div className="flex justify-between items-start">
              <span className="w-6 h-6 rounded-full bg-black/70 text-white text-xs font-bold flex items-center justify-center">
                {index + 1}
              </span>
              <div className="flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
                {!isMain && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMakeMain(index);
                    }}
                    title="Make Main"
                    className={makeMainIconClass}
                  >
                    <Crown size={14} className="text-white" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(index);
                  }}
                  title="View full size"
                  className={actionIconClass}
                >
                  <Maximize2 size={14} className="text-white" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReplace(index);
                  }}
                  title="Replace"
                  className={actionIconClass}
                >
                  <RefreshCw size={14} className="text-white" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(index);
                  }}
                  title="Delete"
                  className={deleteIconClass}
                >
                  <Trash2 size={14} className="text-white" />
                </button>
              </div>
            </div>

            {isMain && (
              <span className="self-start px-2 py-0.5 rounded bg-black/70 text-[10px] text-white font-medium flex items-center gap-1">
                👑 Main
              </span>
            )}
          </>
        )}
      </div>

      {/* Always-visible position badge (subtle, shown when NOT hovering) */}
      <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/60 text-white text-xs font-bold flex items-center justify-center group-hover:opacity-0 transition-opacity">
        {index + 1}
      </div>

      {/* Always-visible main badge */}
      {isMain && (
        <div className="absolute top-2 left-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-[10px] font-semibold text-white/90 group-hover:opacity-0 transition-opacity">
          <span>👑</span> Main
        </div>
      )}
    </div>
  );
}

// ─── Confirm dialog ─────────────────────────────────────────────

function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  confirmDestructive,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <motion.div
        className="relative z-10 w-full max-w-xs mx-4 rounded-2xl bg-[#1C1A2E] border border-white/10 p-6 text-center"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-400 mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-gray-300 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-sm text-white font-semibold transition-colors",
              confirmDestructive
                ? "bg-red-500/90 hover:bg-red-600"
                : "bg-violet-500 hover:bg-violet-600"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Fullscreen viewer ──────────────────────────────────────────

function FullscreenViewer({
  photos,
  currentIndex,
  onClose,
  onNavigate,
}: {
  photos: string[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex, photos.length, onClose, onNavigate]);

  useEffect(() => {
    setZoomed(false);
  }, [currentIndex]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Counter */}
      <div className="absolute top-4 left-4 text-white/60 text-sm select-none">
        Photo {currentIndex + 1} of {photos.length}
        {currentIndex === 0 && " · Main"}
      </div>

      {/* Close */}
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X size={22} className="text-white" />
      </button>

      {/* Prev */}
      {currentIndex > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
        >
          <ChevronLeft size={28} className="text-white" />
        </button>
      )}

      {/* Next */}
      {currentIndex < photos.length - 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
        >
          <ChevronRight size={28} className="text-white" />
        </button>
      )}

      {/* Image */}
      <img
        src={fullScreenUrl(photos[currentIndex])}
        alt=""
        className={cn(
          "max-w-[90vw] max-h-[85vh] object-contain transition-transform duration-300 select-none",
          zoomed ? "scale-[2] cursor-zoom-out" : "cursor-zoom-in"
        )}
        draggable={false}
        onClick={(e) => { e.stopPropagation(); setZoomed(!zoomed); }}
      />
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────

export default function PhotoManageDrawer({
  isOpen,
  onClose,
  photos,
  onPhotosChanged,
}: PhotoManageDrawerProps) {
  const [localPhotos, setLocalPhotos] = useState<string[]>(photos);
  const [saving, setSaving] = useState(false);
  const [uploadingSlots, setUploadingSlots] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState<number | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);

  const initialPhotosRef = useRef<string[]>(photos);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLocalPhotos(photos);
      initialPhotosRef.current = photos;
      setSelectedIndex(0);
      setConfirmRemoveIndex(null);
      setShowDiscardConfirm(false);
      setFullscreenIndex(null);
    }
  }, [isOpen, photos]);

  const filledCount = localPhotos.length;
  const coaching = useMemo(() => getCoachingMessage(filledCount), [filledCount]);

  const slotIds = useMemo(
    () => Array.from({ length: MAX_PHOTOS }, (_, i) => `slot-${i}`),
    [],
  );

  const hasChanges = useMemo(() => {
    if (localPhotos.length !== initialPhotosRef.current.length) return true;
    return localPhotos.some((p, i) => p !== initialPhotosRef.current[i]);
  }, [localPhotos]);

  // ── Responsive ───────────────────────────────────────────────

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Sensors ──────────────────────────────────────────────────

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  // ── Drag handlers ────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slotIds.indexOf(String(active.id));
    const newIndex = slotIds.indexOf(String(over.id));
    if (oldIndex < localPhotos.length && newIndex < localPhotos.length) {
      setLocalPhotos((prev) => arrayMove(prev, oldIndex, newIndex));
    }
  }, [slotIds, localPhotos.length]);

  // ── Upload ───────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files: File[], replaceIndex?: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast.error("Not authenticated"); return; }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) { toast.error(`${file.name} exceeds 10MB limit`); continue; }
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} is not an image`); continue; }

      const slotIndex = replaceIndex ?? localPhotos.length;
      if (replaceIndex === undefined && localPhotos.length >= MAX_PHOTOS) { toast.error("Maximum 6 photos"); break; }

      setUploadingSlots((prev) => new Set(prev).add(slotIndex));
      try {
        const oldPath = replaceIndex !== undefined ? localPhotos[replaceIndex] : undefined;
        const path = await uploadImageToBunny(file, session.access_token, oldPath);
        setLocalPhotos((prev) => {
          if (replaceIndex !== undefined) {
            const next = [...prev];
            next[replaceIndex] = path;
            return next;
          }
          return [...prev, path];
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploadingSlots((prev) => { const next = new Set(prev); next.delete(slotIndex); return next; });
      }
    }
  }, [localPhotos]);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) void uploadFiles(files);
    e.target.value = "";
  }, [uploadFiles]);

  const handleReplaceFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && replaceIndexRef.current !== null) void uploadFiles([file], replaceIndexRef.current);
    e.target.value = "";
    replaceIndexRef.current = null;
  }, [uploadFiles]);

  // ── Tile actions ─────────────────────────────────────────────

  const handleMakeMain = useCallback((index: number) => {
    setLocalPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.unshift(item);
      return next;
    });
    toast.success("Photo set as main");
  }, []);

  const handleReplace = useCallback((index: number) => {
    replaceIndexRef.current = index;
    setTimeout(() => replaceInputRef.current?.click(), 100);
  }, []);

  const handleDelete = useCallback((index: number) => {
    setConfirmRemoveIndex(index);
  }, []);

  const confirmRemove = useCallback(() => {
    if (confirmRemoveIndex !== null) {
      setLocalPhotos((prev) => prev.filter((_, i) => i !== confirmRemoveIndex));
      toast.success("Photo removed");
    }
    setConfirmRemoveIndex(null);
  }, [confirmRemoveIndex]);

  // ── Save / Cancel / Close ────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!hasChanges) { onClose(); return; }
    setSaving(true);
    try {
      await updateMyProfile({ photos: localPhotos, avatarUrl: localPhotos[0] ?? null });
      onPhotosChanged();
      toast.success("Photos updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save photos");
    } finally {
      setSaving(false);
    }
  }, [hasChanges, localPhotos, onClose, onPhotosChanged]);

  const handleCloseAttempt = useCallback(() => {
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  // ── Active drag data ─────────────────────────────────────────

  const activeIndex = activeId ? slotIds.indexOf(activeId) : -1;
  const activeUrl = activeIndex >= 0 ? localPhotos[activeIndex] ?? null : null;

  // ── Render ───────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={handleCloseAttempt}
          />

          {/* Modal */}
          <motion.div
            className={cn(
              "relative z-10 flex flex-col bg-[#0D0B1A] border border-white/10 overflow-hidden",
              isMobile
                ? "w-full h-[92vh] rounded-t-2xl"
                : "w-full max-w-[560px] max-h-[88vh] rounded-2xl"
            )}
            initial={isMobile ? { y: "100%" } : { scale: 0.95, opacity: 0 }}
            animate={isMobile ? { y: 0 } : { scale: 1, opacity: 1 }}
            exit={isMobile ? { y: "100%" } : { scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Handle (mobile) */}
            {isMobile && (
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>
            )}

            {/* Header */}
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <button
                onClick={handleCloseAttempt}
                className="absolute right-4 top-4 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors z-10"
              >
                <X size={18} className="text-gray-400" />
              </button>
              <h2 className="text-xl font-bold text-white">Manage Your Gallery</h2>
              <p className="text-sm text-gray-500 mt-1">
                First impressions matter. Make them count.
              </p>
            </div>

            {/* Filmstrip */}
            <div className="flex gap-2 px-5 pb-3 overflow-x-auto flex-shrink-0 scrollbar-hide">
              {localPhotos.map((photo, i) => (
                <div
                  key={`fs-${i}-${photo}`}
                  onClick={() => setSelectedIndex(i)}
                  className={cn(
                    "relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer transition-all",
                    selectedIndex === i
                      ? "ring-2 ring-violet-500 opacity-100"
                      : "opacity-50 hover:opacity-80"
                  )}
                >
                  <img src={thumbnailUrl(photo)} alt="" className="w-full h-full object-cover" draggable={false} />
                  {i === 0 && (
                    <span className="absolute top-0.5 left-0.5 text-[8px] bg-black/60 rounded px-1 leading-tight">👑</span>
                  )}
                </div>
              ))}
              {Array.from({ length: Math.max(0, MAX_PHOTOS - filledCount) }).map((_, i) => (
                <button
                  key={`fs-e-${i}`}
                  onClick={openFilePicker}
                  className="w-14 h-14 rounded-lg border-2 border-dashed border-violet-500/20 flex items-center justify-center flex-shrink-0 hover:border-violet-500/40 transition-colors"
                >
                  <Plus size={16} className="text-white/20" />
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={slotIds} strategy={rectSortingStrategy}>
                  {/* Row 1: Main (3fr) + stacked pair (2fr) */}
                  <div className="flex gap-2" style={{ height: 280 }}>
                    <div className="flex" style={{ flex: 3 }}>
                      <SortableTile
                        id={slotIds[0]}
                        url={localPhotos[0] ?? null}
                        index={0}
                        isMain={!!localPhotos[0]}
                        uploading={uploadingSlots.has(0)}
                        onMakeMain={handleMakeMain}
                        onExpand={setFullscreenIndex}
                        onDelete={handleDelete}
                        onReplace={handleReplace}
                        onEmptyClick={openFilePicker}
                      />
                    </div>
                    <div className="flex flex-col gap-2" style={{ flex: 2 }}>
                      <SortableTile
                        id={slotIds[1]}
                        url={localPhotos[1] ?? null}
                        index={1}
                        isMain={false}
                        uploading={uploadingSlots.has(1)}
                        onMakeMain={handleMakeMain}
                        onExpand={setFullscreenIndex}
                        onDelete={handleDelete}
                        onReplace={handleReplace}
                        onEmptyClick={openFilePicker}
                      />
                      <SortableTile
                        id={slotIds[2]}
                        url={localPhotos[2] ?? null}
                        index={2}
                        isMain={false}
                        uploading={uploadingSlots.has(2)}
                        onMakeMain={handleMakeMain}
                        onExpand={setFullscreenIndex}
                        onDelete={handleDelete}
                        onReplace={handleReplace}
                        onEmptyClick={openFilePicker}
                      />
                    </div>
                  </div>

                  {/* Row 2: three equal */}
                  <div className="flex gap-2 mt-2" style={{ height: 140 }}>
                    {[3, 4, 5].map((i) => (
                      <SortableTile
                        key={slotIds[i]}
                        id={slotIds[i]}
                        url={localPhotos[i] ?? null}
                        index={i}
                        isMain={false}
                        uploading={uploadingSlots.has(i)}
                        onMakeMain={handleMakeMain}
                        onExpand={setFullscreenIndex}
                        onDelete={handleDelete}
                        onReplace={handleReplace}
                        onEmptyClick={openFilePicker}
                      />
                    ))}
                  </div>
                </SortableContext>

                <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
                  {activeId && activeUrl ? (
                    <div style={{ width: 160, height: 200 }}>
                      <SortableTile
                        id={activeId}
                        url={activeUrl}
                        index={activeIndex}
                        isMain={activeIndex === 0}
                        uploading={false}
                        onMakeMain={() => {}}
                        onExpand={() => {}}
                        onDelete={() => {}}
                        onReplace={() => {}}
                        onEmptyClick={() => {}}
                        isOverlay
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>

              {/* Coaching strip */}
              <p className="text-center text-sm text-gray-500 mt-4 px-5">
                ✦ {coaching}
              </p>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 p-5 border-t border-white/[0.06]">
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className={cn(
                  "w-full py-4 rounded-xl font-bold text-base transition-all",
                  hasChanges
                    ? "bg-gradient-to-r from-violet-500 to-pink-500 text-white hover:shadow-lg hover:shadow-violet-500/25"
                    : "bg-violet-500/30 text-white/50 cursor-default"
                )}
              >
                {saving ? "Saving…" : hasChanges ? "Save Changes" : "Done"}
              </button>
              <button
                onClick={handleCloseAttempt}
                className="w-full pt-3 pb-1 text-center text-gray-500 text-sm hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleReplaceFileChange}
            />
          </motion.div>

          {/* Confirm remove dialog */}
          <ConfirmDialog
            isOpen={confirmRemoveIndex !== null}
            title="Remove this photo?"
            message="This photo will be removed from your profile."
            confirmLabel="Remove"
            confirmDestructive
            onConfirm={confirmRemove}
            onCancel={() => setConfirmRemoveIndex(null)}
          />

          {/* Discard changes dialog */}
          <ConfirmDialog
            isOpen={showDiscardConfirm}
            title="Discard changes?"
            message="Your photo changes will be lost."
            confirmLabel="Discard"
            confirmDestructive
            onConfirm={() => { setShowDiscardConfirm(false); onClose(); }}
            onCancel={() => setShowDiscardConfirm(false)}
          />

          {/* Fullscreen viewer */}
          {fullscreenIndex !== null && localPhotos[fullscreenIndex] && (
            <FullscreenViewer
              photos={localPhotos}
              currentIndex={fullscreenIndex}
              onClose={() => setFullscreenIndex(null)}
              onNavigate={setFullscreenIndex}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
