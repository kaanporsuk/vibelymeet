import { useState, useEffect } from 'react';
import { X, Video, Clock, CircleDot } from 'lucide-react';
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

interface DropRevealScreenProps {
  drop: DailyDrop;
  onSendReply: () => void;
  onPass: () => void;
  onOpenVibeStudio: () => void;
}

export function DropRevealScreen({
  drop,
  onSendReply,
  onPass,
  onOpenVibeStudio
}: DropRevealScreenProps) {
  const [showPassConfirm, setShowPassConfirm] = useState(false);
  const [expiryTime, setExpiryTime] = useState({ hours: 23, minutes: 59 });
  const [isRevealed, setIsRevealed] = useState(false);

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

  const { candidate } = drop;

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
          {/* Header with scarcity indicators */}
          <div className="flex items-center justify-between px-4 py-3 bg-secondary/50">
            <div className="flex items-center gap-2 text-destructive">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-medium">
                Expires in {expiryTime.hours}h {expiryTime.minutes}m
              </span>
            </div>
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <CircleDot className="w-3 h-3 text-green-500 fill-green-500" />
              </motion.div>
              <span className="text-sm text-green-500">Active Recently</span>
            </div>
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
