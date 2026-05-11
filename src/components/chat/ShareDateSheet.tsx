import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type ShareDateSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  defaultText: string;
};

export function ShareDateSheet({
  isOpen,
  onClose,
  title,
  defaultText,
}: ShareDateSheetProps) {
  const [text, setText] = useState(defaultText);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (isOpen) setText(defaultText);
  }, [defaultText, isOpen]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
      onClose();
    } catch {
      toast.error("Could not copy this date");
    }
  };

  const shareText = async () => {
    try {
      if (canNativeShare) {
        await navigator.share({ title, text });
        onClose();
        return;
      }
      await copyText();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyText();
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md rounded-t-3xl border border-border/60 bg-background p-5 shadow-2xl sm:rounded-3xl"
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Share the date</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Edit what your trusted contact will receive.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close share sheet">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-[190px] resize-none text-sm leading-relaxed"
            />

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                className="flex-1"
                onClick={() => void shareText()}
                disabled={text.trim().length === 0}
              >
                <Send className="h-4 w-4" />
                Share
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => void copyText()}
                disabled={text.trim().length === 0}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
