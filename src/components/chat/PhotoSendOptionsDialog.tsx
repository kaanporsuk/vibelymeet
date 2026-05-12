import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Camera, Image as ImageIcon, Info } from "lucide-react";

import { cn } from "@/lib/utils";

type PhotoSendOptionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTakePhoto: () => void;
  onChooseLibrary: () => void;
  disabled?: boolean;
};

export function PhotoSendOptionsDialog({
  open,
  onOpenChange,
  onTakePhoto,
  onChooseLibrary,
  disabled,
}: PhotoSendOptionsDialogProps) {
  const handleTakePhoto = () => {
    if (disabled) return;
    onOpenChange(false);
    onTakePhoto();
  };

  const handleChooseLibrary = () => {
    if (disabled) return;
    onOpenChange(false);
    onChooseLibrary();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/82 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[90] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
            "rounded-[1.75rem] border border-white/10 bg-[#111116]/95 px-6 py-7 text-center shadow-2xl shadow-black/45 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "max-h-[min(88vh,32rem)] overflow-y-auto",
          )}
          aria-describedby="photo-send-options-description"
        >
          <div
            className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-violet-400/45 bg-violet-500/18 text-violet-300"
            aria-hidden
          >
            <Info className="h-7 w-7" />
          </div>

          <DialogPrimitive.Title className="text-2xl font-bold leading-tight text-white">
            Send a photo
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="photo-send-options-description"
            className="mt-3 text-base leading-relaxed text-white/62"
          >
            Choose how you'd like to add your picture.
          </DialogPrimitive.Description>

          <div className="mt-9 space-y-4">
            <button
              type="button"
              onClick={handleTakePhoto}
              disabled={disabled}
              className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-violet-500 to-pink-500 px-5 text-lg font-bold text-white shadow-lg shadow-pink-950/25 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-55"
            >
              <Camera className="h-5 w-5" aria-hidden />
              Take photo
            </button>

            <button
              type="button"
              onClick={handleChooseLibrary}
              disabled={disabled}
              className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full px-5 text-lg font-bold text-white/62 transition hover:bg-white/[0.04] hover:text-white/78 disabled:pointer-events-none disabled:opacity-55"
            >
              <ImageIcon className="h-5 w-5" aria-hidden />
              Choose from library
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default PhotoSendOptionsDialog;
