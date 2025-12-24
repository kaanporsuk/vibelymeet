import { useState, useEffect } from 'react';
import { X, Video, Clock, CircleDot, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DailyDrop } from '@/types/dailyDrop';
import { VibeTag } from '@/components/VibeTag';
import { calculateVibeScore, getVibeScoreLabel, getSharedTags } from '@/utils/vibeScoreUtils';

interface DropRevealScreenProps {
  drop: DailyDrop;
  onSendReply: () => void;
  onPass: () => void;
  onOpenVibeStudio: () => void;
  userVibeTags?: string[];
}

export function DropRevealScreen({
  drop,
  onSendReply,
  onPass,
  onOpenVibeStudio,
  userVibeTags = ['Creative Soul', 'Night Owl', 'Adventure Seeker'] // Mock user tags for demo
}: DropRevealScreenProps) {
  const [showPassConfirm, setShowPassConfirm] = useState(false);
  const [expiryTime, setExpiryTime] = useState({ hours: 23, minutes: 59 });
  const [isRevealed, setIsRevealed] = useState(false);

  const { candidate } = drop;

  // Calculate vibe score
  const vibeScore = calculateVibeScore({
    userTags: userVibeTags,
    candidateTags: candidate.vibeTags,
    candidateLastActiveAt: candidate.lastActiveAt,
    candidateHasVideo: !!candidate.vibeVideoUrl,
    candidateBioLength: candidate.bio?.length || 0
  });

  const sharedTags = getSharedTags(userVibeTags, candidate.vibeTags);
  const scoreLabel = getVibeScoreLabel(vibeScore);

  // Trigger reveal animation
  useEffect(() => {
    const timer = setTimeout(() => setIsRevealed(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Calculate expiry countdown
  useEffect(() => {
    const updateExpiry = () => {
      const now = new Date();
      const expires = new Date(drop.expiresAt);
      const diff = expires.getTime() - now.getTime();
      
      if (diff <= 0) {
        setExpiryTime({ hours: 0, minutes: 0 });
        return;
      }
      
      setExpiryTime({
        hours: Math.floor(diff / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      });
    };

    updateExpiry();
    const interval = setInterval(updateExpiry, 60000);
    return () => clearInterval(interval);
  }, [drop.expiresAt]);

  const handlePassClick = () => {
    setShowPassConfirm(true);
  };

  const confirmPass = () => {
    setShowPassConfirm(false);
    onPass();
  };

  const handleSendReply = () => {
    onOpenVibeStudio();
    onSendReply();
  };

  return (
    <>
      <AnimatePresence>
        {/* Shattering glass / vault opening transition */}
        {!isRevealed && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ 
              opacity: 0,
              scale: 1.5,
              filter: 'blur(20px)'
            }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="fixed inset-0 z-50 bg-background flex items-center justify-center"
          >
            <motion.div
              animate={{ 
                scale: [1, 1.1, 1],
                rotate: [0, 5, -5, 0]
              }}
              transition={{ duration: 0.4 }}
              className="text-6xl"
            >
              🔓
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: isRevealed ? 1 : 0, scale: isRevealed ? 1 : 0.9 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="space-y-4"
      >
        {/* Profile Card */}
        <div className="glass-card overflow-hidden">
          {/* Header with Vibe Score and scarcity indicators */}
          <div className="flex items-center justify-between px-4 py-3 bg-secondary/50">
            {/* Vibe Score Badge */}
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.5, type: 'spring' }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/30 to-accent/30 border border-primary/30"
            >
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-primary">{vibeScore}%</span>
              <span className="text-xs text-muted-foreground">{scoreLabel}</span>
            </motion.div>
            
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <CircleDot className="w-3 h-3 text-green-500 fill-green-500" />
              </motion.div>
              <span className="text-xs text-green-500">Active</span>
            </div>
          </div>

          {/* Shared tags indicator */}
          {sharedTags.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="px-4 py-2 bg-primary/10 border-b border-primary/20"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">You both love:</span>
                <div className="flex gap-1">
                  {sharedTags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Expiry timer */}
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20">
            <Clock className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs font-medium text-destructive">
              Expires in {expiryTime.hours}h {expiryTime.minutes}m
            </span>
          </div>

          {/* Video/Photo area */}
          <div className="relative aspect-[3/4] bg-secondary">
            <img
              src={candidate.avatarUrl}
              alt={candidate.name}
              className="w-full h-full object-cover"
            />
            
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
            
            {/* Profile info overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-4 space-y-3">
              <div>
                <h2 className="text-2xl font-display font-bold text-foreground">
                  {candidate.name}, {candidate.age}
                </h2>
                {candidate.location && (
                  <p className="text-sm text-muted-foreground">{candidate.location}</p>
                )}
              </div>
              
              {/* Vibe Tags */}
              <div className="flex flex-wrap gap-2">
                {candidate.vibeTags.slice(0, 3).map((tag, i) => (
                  <VibeTag key={i} label={tag} />
                ))}
              </div>
            </div>
          </div>

          {/* Bio */}
          <div className="p-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {candidate.bio}
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex gap-3">
          {/* Pass button */}
          <Button
            variant="outline"
            size="lg"
            className="flex-1 border-muted-foreground/30 text-muted-foreground hover:border-destructive hover:text-destructive"
            onClick={handlePassClick}
          >
            <X className="w-5 h-5 mr-2" />
            Pass
          </Button>

          {/* Send Vibe Reply - Primary */}
          <Button
            variant="gradient"
            size="lg"
            className="flex-[2]"
            onClick={handleSendReply}
          >
            <Video className="w-5 h-5 mr-2" />
            Send Vibe Reply
          </Button>
        </div>
      </motion.div>

      {/* Pass Confirmation Modal */}
      <AlertDialog open={showPassConfirm} onOpenChange={setShowPassConfirm}>
        <AlertDialogContent className="glass-card border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't see {candidate.name} again. Your Drop Zone will be locked until tomorrow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">
              Keep Looking
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPass}
              className="bg-destructive hover:bg-destructive/90"
            >
              Yes, Pass
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
