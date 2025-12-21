import { motion, AnimatePresence } from "framer-motion";

interface UrgentBorderEffectProps {
  isActive: boolean;
}

export const UrgentBorderEffect = ({ isActive }: UrgentBorderEffectProps) => {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 pointer-events-none z-40"
        >
          {/* Top border */}
          <motion.div
            className="absolute top-0 left-0 right-0 h-1"
            style={{
              background: "linear-gradient(90deg, transparent, hsl(var(--accent)), hsl(var(--destructive)), hsl(var(--accent)), transparent)",
            }}
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
          
          {/* Bottom border */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-1"
            style={{
              background: "linear-gradient(90deg, transparent, hsl(var(--accent)), hsl(var(--destructive)), hsl(var(--accent)), transparent)",
            }}
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{ duration: 0.5, repeat: Infinity, delay: 0.25 }}
          />
          
          {/* Left border */}
          <motion.div
            className="absolute top-0 bottom-0 left-0 w-1"
            style={{
              background: "linear-gradient(180deg, transparent, hsl(var(--accent)), hsl(var(--destructive)), hsl(var(--accent)), transparent)",
            }}
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{ duration: 0.5, repeat: Infinity, delay: 0.125 }}
          />
          
          {/* Right border */}
          <motion.div
            className="absolute top-0 bottom-0 right-0 w-1"
            style={{
              background: "linear-gradient(180deg, transparent, hsl(var(--accent)), hsl(var(--destructive)), hsl(var(--accent)), transparent)",
            }}
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{ duration: 0.5, repeat: Infinity, delay: 0.375 }}
          />

          {/* Corner glows */}
          <motion.div
            className="absolute top-0 left-0 w-32 h-32"
            style={{
              background: "radial-gradient(circle at top left, hsl(var(--accent) / 0.3), transparent 70%)",
            }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
          <motion.div
            className="absolute top-0 right-0 w-32 h-32"
            style={{
              background: "radial-gradient(circle at top right, hsl(var(--destructive) / 0.3), transparent 70%)",
            }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: 0.25 }}
          />
          <motion.div
            className="absolute bottom-0 left-0 w-32 h-32"
            style={{
              background: "radial-gradient(circle at bottom left, hsl(var(--destructive) / 0.3), transparent 70%)",
            }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: 0.5 }}
          />
          <motion.div
            className="absolute bottom-0 right-0 w-32 h-32"
            style={{
              background: "radial-gradient(circle at bottom right, hsl(var(--accent) / 0.3), transparent 70%)",
            }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: 0.75 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
