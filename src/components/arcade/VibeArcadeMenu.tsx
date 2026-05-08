import { useEffect, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Gamepad2 } from "lucide-react";
import { ARCADE_GAMES, GameType } from "@/types/games";
import { cn } from "@/lib/utils";

interface VibeArcadeMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGame: (gameType: GameType) => void;
}

export const VibeArcadeMenu = ({ isOpen, onClose, onSelectGame }: VibeArcadeMenuProps) => {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 grid items-end overflow-hidden pb-[env(safe-area-inset-bottom)] sm:place-items-center sm:p-4">
          <motion.button
            type="button"
            aria-label="Close Vibe Arcade"
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-background/80 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative z-10 flex max-h-[82dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border/50 glass-card shadow-2xl sm:max-h-[min(82dvh,640px)] sm:max-w-xl sm:rounded-2xl sm:border"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon-violet to-neon-pink">
                  <Gamepad2 className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 id={titleId} className="truncate font-display text-lg font-bold text-foreground">
                    Vibe Arcade
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">Spark chemistry with games</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Vibe Arcade"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
              {ARCADE_GAMES.map((game, index) => (
                <motion.button
                  key={game.type}
                  type="button"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  onClick={() => {
                    onSelectGame(game.type);
                    onClose();
                  }}
                  className={cn(
                    "group relative flex min-h-[128px] flex-col overflow-hidden rounded-2xl p-4 text-left transition-all duration-300",
                    "border border-border/30 bg-secondary/50",
                    "hover:border-neon-violet/50 hover:shadow-[0_0_20px_rgba(139,92,246,0.2)]",
                    "focus:outline-none focus:ring-2 focus:ring-neon-violet/60",
                  )}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-neon-violet/10 to-neon-pink/10 opacity-0 transition-opacity group-hover:opacity-100" />

                  <div className="relative z-10 mb-3 text-3xl leading-none">{game.icon}</div>

                  <h3 className="relative z-10 mb-1 text-sm font-semibold leading-snug text-foreground">
                    {game.name}
                  </h3>

                  <p className="relative z-10 text-xs leading-snug text-muted-foreground">
                    {game.description}
                  </p>

                  <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-full bg-gradient-to-br from-neon-violet/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                </motion.button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
