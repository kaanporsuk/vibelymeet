import { motion } from "framer-motion";

export const TypingIndicator = () => {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-secondary" />
      <div className="glass-card px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{
              y: [0, -6, 0],
              opacity: [0.4, 1, 0.4],
            }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
            className="w-2 h-2 rounded-full bg-gradient-to-r from-neon-violet to-neon-pink"
          />
        ))}
      </div>
    </div>
  );
};
