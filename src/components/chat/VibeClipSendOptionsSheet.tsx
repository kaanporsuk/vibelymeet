import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, Film, Image as ImageIcon, Loader2, Video } from "lucide-react";
import { toast } from "sonner";

import {
  VIBE_CLIP_LIBRARY,
  VIBE_CLIP_LIBRARY_HINT,
  VIBE_CLIP_RECORD_PRIMARY,
  VIBE_CLIP_RECORD_SECONDARY,
  VIBE_CLIP_SHEET_SUBTITLE,
  VIBE_CLIP_SHEET_TITLE,
} from "../../../shared/chat/vibeClipCaptureCopy";
import { durationBucketFromSeconds } from "../../../shared/chat/vibeClipAnalytics";
import { capturePromptForSeed } from "../../../shared/chat/vibeClipPrompts";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import {
  prepareWebVibeClipLibraryFile,
  type WebVibeClipCompleteMeta,
} from "@/lib/webVibeClipLibraryUpload";
import { cn } from "@/lib/utils";

type VibeClipSendOptionsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecord: () => void;
  onLibraryClipReady: (videoBlob: Blob, duration: number, meta?: WebVibeClipCompleteMeta) => void | Promise<void>;
  disabled?: boolean;
  promptSeed?: string;
};

export function VibeClipSendOptionsSheet({
  open,
  onOpenChange,
  onRecord,
  onLibraryClipReady,
  disabled,
  promptSeed,
}: VibeClipSendOptionsSheetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [captureSpark, setCaptureSpark] = useState("");

  useEffect(() => {
    if (!open) {
      setIsProcessingUpload(false);
      return;
    }
    setCaptureSpark(capturePromptForSeed(`${promptSeed ?? "web-vibe"}|${Date.now()}`));
  }, [open, promptSeed]);

  const blockClose = isProcessingUpload;
  const actionDisabled = disabled || isProcessingUpload;

  const handleRecord = () => {
    if (actionDisabled) return;
    onOpenChange(false);
    onRecord();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || actionDisabled) return;

    setIsProcessingUpload(true);
    let completed = false;
    try {
      const prepared = await prepareWebVibeClipLibraryFile(file);
      trackVibeClipEvent("clip_record_started", {
        capture_source: "library",
        is_sender: true,
      });
      trackVibeClipEvent("clip_record_completed", {
        capture_source: "library",
        duration_bucket: durationBucketFromSeconds(prepared.durationSeconds),
        is_sender: true,
      });
      await onLibraryClipReady(prepared.file, prepared.durationSeconds, prepared.meta);
      completed = true;
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read this video. Choose another clip.");
    } finally {
      if (!completed) setIsProcessingUpload(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (blockClose && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-[90] max-h-[min(82vh,34rem)] overflow-y-auto rounded-t-[2rem]",
            "border border-white/10 bg-[#111116] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4",
            "shadow-2xl shadow-black/45 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "sm:left-1/2 sm:right-auto sm:bottom-6 sm:w-[min(34rem,calc(100svw-2rem))] sm:-translate-x-1/2 sm:rounded-[2rem]",
          )}
          aria-describedby="vibe-clip-send-options-description"
          data-testid="vibe-clip-send-options"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={handleFileUpload}
            data-testid="vibe-clip-library-input"
          />

          <div className="mx-auto mb-7 h-1.5 w-24 rounded-full bg-white/15" aria-hidden />

          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/35 bg-violet-500/15 px-3 py-1.5 text-xs font-bold uppercase text-violet-300">
            <Film className="h-4 w-4" aria-hidden />
            Vibe Clip
          </div>

          <DialogPrimitive.Title className="text-[1.7rem] font-bold leading-tight text-white">
            {VIBE_CLIP_SHEET_TITLE}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="vibe-clip-send-options-description"
            className="mt-4 text-base leading-relaxed text-white/62"
          >
            {VIBE_CLIP_SHEET_SUBTITLE}
          </DialogPrimitive.Description>

          {captureSpark ? (
            <p className="mt-4 text-sm leading-relaxed text-white/58">{captureSpark}</p>
          ) : null}

          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={handleRecord}
              disabled={actionDisabled}
              className="flex min-h-[5.5rem] w-full items-center gap-4 rounded-[1.5rem] bg-violet-500 px-5 text-left text-white shadow-lg shadow-violet-950/35 transition hover:bg-violet-400 disabled:pointer-events-none disabled:opacity-55"
              aria-label={`${VIBE_CLIP_RECORD_PRIMARY}. ${VIBE_CLIP_RECORD_SECONDARY}`}
              data-testid="vibe-clip-record-option"
            >
              <Video className="h-7 w-7 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xl font-bold leading-tight">{VIBE_CLIP_RECORD_PRIMARY}</span>
                <span className="mt-1 block text-sm leading-snug text-white/82">{VIBE_CLIP_RECORD_SECONDARY}</span>
              </span>
              <ChevronRight className="h-6 w-6 shrink-0 text-white/80" aria-hidden />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={actionDisabled}
              className="flex min-h-[5rem] w-full items-center gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.015] px-5 text-left transition hover:bg-white/[0.04] disabled:pointer-events-none disabled:opacity-55"
              aria-label={`${VIBE_CLIP_LIBRARY}. ${VIBE_CLIP_LIBRARY_HINT}`}
              data-testid="vibe-clip-library-option"
            >
              {isProcessingUpload ? (
                <Loader2 className="h-7 w-7 shrink-0 animate-spin text-violet-300" aria-hidden />
              ) : (
                <ImageIcon className="h-7 w-7 shrink-0 text-white/60" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold leading-tight text-white">{VIBE_CLIP_LIBRARY}</span>
                <span className="mt-1 block text-sm leading-snug text-white/52">{VIBE_CLIP_LIBRARY_HINT}</span>
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={blockClose}
            className="mx-auto mt-6 block rounded-full px-6 py-3 text-base font-semibold text-white/55 transition hover:text-white/75 disabled:pointer-events-none disabled:opacity-45"
          >
            Not now
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default VibeClipSendOptionsSheet;
