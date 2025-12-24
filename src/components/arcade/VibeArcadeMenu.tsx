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
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-hidden"
          >
            <div className="glass-card border-t border-border/50 rounded-t-3xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-violet to-neon-pink flex items-center justify-center">
                    <Gamepad2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-lg text-foreground">Vibe Arcade</h2>
                    <p className="text-xs text-muted-foreground">Spark chemistry with games</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Game Grid */}
              <div className="p-4 grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pb-safe">
                {ARCADE_GAMES.map((game, index) => (
                  <motion.button
                    key={game.type}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => {
                      onSelectGame(game.type);
                      onClose();
                    }}
                    className={cn(
                      "relative p-4 rounded-2xl text-left transition-all duration-300",
                      "bg-secondary/50 border border-border/30",
                      "hover:border-neon-violet/50 hover:shadow-[0_0_20px_rgba(139,92,246,0.2)]",
                      "group overflow-hidden"
                    )}
                  >
                    {/* Glow effect on hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-neon-violet/10 to-neon-pink/10 opacity-0 group-hover:opacity-100 transition-opacity" />

                    {/* Icon */}
                    <div className="text-3xl mb-2">{game.icon}</div>

                    {/* Title */}
                    <h3 className="font-semibold text-sm text-foreground mb-1 relative z-10">
                      {game.name}
                    </h3>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground relative z-10">
                      {game.description}
                    </p>

                    {/* Corner accent */}
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-neon-violet/20 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity" />
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
