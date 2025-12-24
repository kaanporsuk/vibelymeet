import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Check, X, Clock, MessageCircle, Video, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import confetti from 'canvas-confetti';

export interface ReceivedDrop {
  id: string;
  senderName: string;
  senderAge: number;
  senderAvatar: string;
  vibeVideoUrl?: string;
  vibeTags: string[];
  receivedAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'declined';
}

interface ReceivedDropsSectionProps {
  drops: ReceivedDrop[];
  onAccept: (dropId: string) => void;
  onDecline: (dropId: string) => void;
  onViewProfile: (dropId: string) => void;
}

export function ReceivedDropsSection({ drops, onAccept, onDecline, onViewProfile }: ReceivedDropsSectionProps) {
  const [expandedDrop, setExpandedDrop] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  const pendingDrops = drops.filter(d => d.status === 'pending');
  const acceptedDrops = drops.filter(d => d.status === 'accepted');

  const handleAccept = (dropId: string) => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8B5CF6', '#06B6D4', '#D946EF'],
    });
    onAccept(dropId);
  };

  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return 'Expired';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  };

  if (drops.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-neon-cyan" />
          Vibe Replies
        </h3>
        {pendingDrops.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
            {pendingDrops.length} new
          </span>
        )}
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {pendingDrops.map((drop) => (
            <motion.div
              key={drop.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className={cn(
                "relative overflow-hidden rounded-2xl",
                "bg-gradient-to-br from-primary/10 to-neon-cyan/10",
                "border border-primary/30"
              )}
            >
              {/* Pulse effect for pending */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />

              <div className="relative z-10 p-4">
                <div className="flex items-start gap-3">
                  {/* Avatar with play button */}
                  <div className="relative">
                    <img
                      src={drop.senderAvatar}
                      alt={drop.senderName}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-primary/50"
                    />
                    {drop.vibeVideoUrl && (
                      <button
                        onClick={() => setPlayingVideo(playingVideo === drop.id ? null : drop.id)}
                        className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-xl opacity-0 hover:opacity-100 transition-opacity"
                      >
                        <Play className="w-8 h-8 text-foreground" />
                      </button>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-foreground">{drop.senderName}, {drop.senderAge}</h4>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan">
                        New Vibe
                      </span>
                    </div>

                    {/* Vibe tags */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {drop.vibeTags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Expiry */}
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-400">
                      <Clock className="w-3 h-3" />
                      <span>Expires in {getTimeRemaining(drop.expiresAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Video Player */}
                <AnimatePresence>
                  {playingVideo === drop.id && drop.vibeVideoUrl && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4"
                    >
                      <video
                        src={drop.vibeVideoUrl}
                        className="w-full rounded-xl"
                        controls
                        autoPlay
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleAccept(drop.id)}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-primary to-neon-cyan text-background font-medium"
                  >
                    <Check className="w-5 h-5" />
                    <span>Accept & Chat</span>
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onDecline(drop.id)}
                    className="py-3 px-4 rounded-xl bg-muted text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Accepted Drops (Compact) */}
        {acceptedDrops.length > 0 && (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground mb-3">Recently Matched</p>
            <div className="flex -space-x-2">
              {acceptedDrops.slice(0, 5).map((drop) => (
                <motion.button
                  key={drop.id}
                  whileHover={{ scale: 1.1, zIndex: 10 }}
                  onClick={() => onViewProfile(drop.id)}
                  className="relative"
                >
                  <img
                    src={drop.senderAvatar}
                    alt={drop.senderName}
                    className="w-12 h-12 rounded-full object-cover border-2 border-background"
                  />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-background" />
                  </div>
                </motion.button>
              ))}
              {acceptedDrops.length > 5 && (
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center border-2 border-background text-xs font-medium text-muted-foreground">
                  +{acceptedDrops.length - 5}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
