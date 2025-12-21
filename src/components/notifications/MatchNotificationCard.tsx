import { motion } from 'framer-motion';
import { Heart, X } from 'lucide-react';
import { MatchNotification } from '@/contexts/NotificationContext';

interface MatchNotificationCardProps {
  notification: MatchNotification;
  onDismiss: () => void;
  onTap: () => void;
  index: number;
}

const MatchNotificationCard = ({ notification, onDismiss, onTap, index }: MatchNotificationCardProps) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -100, scale: 0.8 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        transition: { type: 'spring', stiffness: 400, damping: 25 }
      }}
      exit={{ 
        opacity: 0, 
        y: -50, 
        scale: 0.8,
        transition: { duration: 0.2 }
      }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.5, bottom: 0.1 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -50) {
          onDismiss();
        }
      }}
      onClick={onTap}
      className="relative cursor-pointer group"
      style={{ zIndex: 100 - index }}
    >
      {/* Glow effect */}
      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-400 opacity-75 blur-sm group-hover:opacity-100 transition-opacity animate-pulse" />
      
      {/* Card content */}
      <div className="relative flex items-center gap-3 p-4 rounded-2xl bg-card/90 backdrop-blur-xl border border-pink-500/30 shadow-2xl">
        {/* Dismiss button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute top-2 right-2 p-1 rounded-full bg-muted/50 hover:bg-muted transition-colors"
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </button>

        {/* Pulsing heart icon */}
        <div className="relative">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Heart className="w-6 h-6 text-pink-500 fill-pink-500 opacity-50" />
          </motion.div>
          <div className="relative w-12 h-12 rounded-full overflow-hidden ring-2 ring-pink-500 ring-offset-2 ring-offset-card">
            <img
              src={notification.matchAvatar}
              alt={notification.matchName}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">💖</span>
            <span className="font-display font-semibold text-foreground">It's a Vibe!</span>
          </div>
          <p className="text-sm text-muted-foreground truncate">
            <span className="font-medium text-foreground">{notification.matchName}</span> liked you back
          </p>
        </div>

        {/* Arrow indicator */}
        <motion.div
          animate={{ x: [0, 4, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-pink-400"
        >
          →
        </motion.div>
      </div>
    </motion.div>
  );
};

export default MatchNotificationCard;
