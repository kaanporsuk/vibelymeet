import { motion } from "framer-motion";
import { Heart, MessageCircle } from "lucide-react";
import { ParticleBurst } from "@/components/chat/ParticleBurst";

interface MutualMatchCelebrationProps {
  partnerName: string;
  partnerImage: string;
  onContinue: () => void;
}

export const MutualMatchCelebration = ({
  partnerName,
  partnerImage,
  onContinue,
}: MutualMatchCelebrationProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-8 space-y-6"
    >
      {/* Confetti */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <ParticleBurst emoji="🎉" onComplete={() => {}} />
        <div className="absolute" style={{ left: "25%", top: "35%" }}>
          <ParticleBurst emoji="💚" onComplete={() => {}} />
        </div>
        <div className="absolute" style={{ right: "25%", top: "45%" }}>
          <ParticleBurst emoji="✨" onComplete={() => {}} />
        </div>
      </div>

      {/* Partner avatar */}
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="relative"
      >
        <img
          src={partnerImage}
          alt={partnerName}
          className="w-28 h-28 rounded-full object-cover border-4 border-primary"
        />
        <motion.div
          className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-primary flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: "spring" }}
        >
          <Heart className="w-5 h-5 text-primary-foreground fill-current" />
        </motion.div>
      </motion.div>

      <div className="text-center space-y-2">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-display font-bold text-foreground"
        >
          It's a Vibe! 🎉
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-muted-foreground"
        >
          You and {partnerName} are now connected. Say hi in your matches!
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex items-center justify-center gap-2 text-sm text-primary"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Chat is now unlocked</span>
        </motion.div>
      </div>

      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        whileTap={{ scale: 0.95 }}
        onClick={onContinue}
        className="px-8 py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold"
      >
        Continue
      </motion.button>
    </motion.div>
  );
};
