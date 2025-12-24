import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellRing, X, Check, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface NotificationPermissionFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestPermission: () => Promise<boolean>;
}

export function NotificationPermissionFlow({
  open,
  onOpenChange,
  onRequestPermission,
}: NotificationPermissionFlowProps) {
  const [step, setStep] = useState<'intro' | 'requesting' | 'success' | 'denied'>('intro');

  const handleEnable = async () => {
    setStep('requesting');
    const granted = await onRequestPermission();
    setStep(granted ? 'success' : 'denied');
    
    if (granted) {
      setTimeout(() => onOpenChange(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center space-y-6"
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-neon-cyan/20 flex items-center justify-center">
                <Bell className="w-10 h-10 text-primary" />
              </div>

              <div>
                <h2 className="text-xl font-display font-bold text-foreground mb-2">
                  Never Miss a Vibe
                </h2>
                <p className="text-muted-foreground text-sm">
                  Get notified when your daily drop arrives at 6 PM and when your dates are about to start.
                </p>
              </div>

              <div className="space-y-3 text-left">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-lg">💧</span>
                  </div>
                  <p className="text-sm text-foreground">Daily drop ready at 6 PM</p>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-neon-cyan/10">
                  <div className="w-8 h-8 rounded-full bg-neon-cyan/20 flex items-center justify-center">
                    <span className="text-lg">📅</span>
                  </div>
                  <p className="text-sm text-foreground">Date reminders before start</p>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-accent/10">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                    <span className="text-lg">💬</span>
                  </div>
                  <p className="text-sm text-foreground">New matches & messages</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  Not Now
                </Button>
                <Button
                  variant="gradient"
                  className="flex-1"
                  onClick={handleEnable}
                >
                  Enable Notifications
                </Button>
              </div>
            </motion.div>
          )}

          {step === 'requesting' && (
            <motion.div
              key="requesting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center py-8"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="w-20 h-20 mx-auto rounded-full bg-primary/20 flex items-center justify-center mb-4"
              >
                <Smartphone className="w-10 h-10 text-primary" />
              </motion.div>
              <p className="text-foreground font-medium">
                Please allow notifications in your browser...
              </p>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', bounce: 0.5 }}
                className="w-20 h-20 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center mb-4"
              >
                <Check className="w-10 h-10 text-emerald-500" />
              </motion.div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                You're All Set!
              </h3>
              <p className="text-muted-foreground text-sm">
                We'll notify you about important vibes.
              </p>
            </motion.div>
          )}

          {step === 'denied' && (
            <motion.div
              key="denied"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-destructive/20 flex items-center justify-center mb-4">
                <X className="w-10 h-10 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Notifications Blocked
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                You can enable them later in your browser settings.
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Got it
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// Mini trigger button for Dashboard
export function NotificationPermissionButton({
  isGranted,
  onClick,
}: {
  isGranted: boolean;
  onClick: () => void;
}) {
  if (isGranted) {
    return (
      <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-400">
        <BellRing className="w-5 h-5" />
      </div>
    );
  }

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="relative p-2 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
    >
      <Bell className="w-5 h-5" />
      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive animate-pulse" />
    </motion.button>
  );
}
