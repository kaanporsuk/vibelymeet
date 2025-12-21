import { motion, AnimatePresence } from "framer-motion";
import { Heart, X } from "lucide-react";
import { useState } from "react";
import { ParticleBurst } from "@/components/chat/ParticleBurst";

interface PostDateModalProps {
  isOpen: boolean;
  partnerName: string;
  partnerImage: string;
  onPass: () => void;
  onVibe: () => void;
}

export const PostDateModal = ({
  isOpen,
  partnerName,
  partnerImage,
  onPass,
  onVibe,
}: PostDateModalProps) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const [isDeciding, setIsDeciding] = useState(false);

  const handleVibe = () => {
    setShowConfetti(true);
    setIsDeciding(true);
    
    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate([50, 100, 50, 100, 100]);
    }

    setTimeout(() => {
      onVibe();
    }, 1500);
  };

  const handlePass = () => {
    setIsDeciding(true);
    
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }

    setTimeout(() => {
      onPass();
    }, 300);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop with blur */}
          <motion.div
            initial={{ backdropFilter: "blur(0px)" }}
            animate={{ backdropFilter: "blur(20px)" }}
            exit={{ backdropFilter: "blur(0px)" }}
            className="absolute inset-0 bg-background/80"
          />

          {/* Confetti */}
          {showConfetti && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <ParticleBurst emoji="❤️" onComplete={() => {}} />
              <div className="absolute" style={{ left: '30%', top: '40%' }}>
                <ParticleBurst emoji="🔥" onComplete={() => {}} />
              </div>
              <div className="absolute" style={{ right: '30%', top: '50%' }}>
                <ParticleBurst emoji="❤️" onComplete={() => {}} />
              </div>
            </div>
          )}

          {/* Modal Content */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 50 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="relative z-10 glass-card p-8 max-w-sm w-full mx-4 text-center"
          >
            {/* Partner Avatar */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="relative w-24 h-24 mx-auto mb-6"
            >
              <img
                src={partnerImage}
                alt={partnerName}
                className="w-full h-full rounded-full object-cover border-4 border-primary"
              />
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{
                  boxShadow: [
                    "0 0 20px hsl(var(--primary) / 0.4)",
                    "0 0 40px hsl(var(--primary) / 0.6)",
                    "0 0 20px hsl(var(--primary) / 0.4)",
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-display font-bold mb-2"
            >
              Time's Up! ⏱️
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-lg text-muted-foreground mb-8"
            >
              Did you vibe with <span className="text-foreground font-medium">{partnerName}</span>?
            </motion.p>

            {/* Decision Buttons */}
            {!isDeciding ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="flex items-center justify-center gap-8"
              >
                {/* Pass Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handlePass}
                  className="relative group"
                >
                  <div className="w-20 h-20 rounded-full bg-secondary border-2 border-muted flex items-center justify-center transition-all group-hover:border-muted-foreground">
                    <X className="w-8 h-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-muted-foreground whitespace-nowrap">
                    Not for me
                  </span>
                </motion.button>

                {/* Vibe Button */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleVibe}
                  className="relative group"
                >
                  <motion.div
                    className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center"
                    animate={{
                      boxShadow: [
                        "0 0 20px hsl(var(--primary) / 0.4), 0 0 40px hsl(var(--accent) / 0.2)",
                        "0 0 30px hsl(var(--primary) / 0.6), 0 0 60px hsl(var(--accent) / 0.4)",
                        "0 0 20px hsl(var(--primary) / 0.4), 0 0 40px hsl(var(--accent) / 0.2)",
                      ],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Heart className="w-10 h-10 text-white fill-white" />
                  </motion.div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-primary font-medium whitespace-nowrap">
                    Let's Connect 💜
                  </span>
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-4"
              >
                {showConfetti ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="w-12 h-12 rounded-full border-4 border-transparent border-t-primary border-r-accent"
                    />
                    <p className="text-lg font-medium gradient-text">
                      Fingers Crossed... 🤞
                    </p>
                    <p className="text-sm text-muted-foreground">
                      We'll let you know if it's mutual!
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Moving on...
                  </p>
                )}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
