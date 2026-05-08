import { useEffect, useId, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArcadeCreatorShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon: string;
  accentClassName: string;
  children: ReactNode;
  footer: ReactNode;
  headerAction?: ReactNode;
  closeDisabled?: boolean;
  contentClassName?: string;
  panelClassName?: string;
}

export function ArcadeCreatorShell({
  isOpen,
  onClose,
  title,
  icon,
  accentClassName,
  children,
  footer,
  headerAction,
  closeDisabled = false,
  contentClassName,
  panelClassName,
}: ArcadeCreatorShellProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen || closeDisabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto px-3 py-3 sm:px-4 sm:py-4"
          style={{
            paddingTop: "max(0.75rem, env(safe-area-inset-top))",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <motion.button
            type="button"
            aria-label={`Close ${title}`}
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDisabled ? undefined : onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-background/85 backdrop-blur-sm"
            disabled={closeDisabled}
          />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{
              maxHeight:
                "calc(100dvh - max(0.75rem, env(safe-area-inset-top)) - max(0.75rem, env(safe-area-inset-bottom)))",
            }}
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative z-10 flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border glass-card shadow-2xl",
              accentClassName,
              panelClassName,
            )}
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-2xl leading-none" aria-hidden="true">
                  {icon}
                </span>
                <h3 id={titleId} className="truncate font-semibold text-foreground">
                  {title}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {headerAction}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={closeDisabled}
                  aria-label={`Close ${title}`}
                  className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-45"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", contentClassName)}>
              {children}
            </div>

            <footer className="shrink-0 border-t border-white/10 px-4 py-3.5">{footer}</footer>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
