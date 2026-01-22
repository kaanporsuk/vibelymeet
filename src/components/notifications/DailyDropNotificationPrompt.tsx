import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDailyDropNotifications } from '@/hooks/useDailyDropNotifications';

interface DailyDropNotificationPromptProps {
  onDismiss?: () => void;
}

export function DailyDropNotificationPrompt({ onDismiss }: DailyDropNotificationPromptProps) {
  const { isSupported, isEnabled, requestPermission } = useDailyDropNotifications();
  const [isLoading, setIsLoading] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check if we should show the prompt
  const shouldShow = isSupported && !isEnabled && !isDismissed;

  const handleEnable = async () => {
    setIsLoading(true);
    try {
      const granted = await requestPermission();
      if (granted) {
        setIsDismissed(true);
        onDismiss?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  if (!shouldShow) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="fixed bottom-24 left-4 right-4 z-40 md:left-auto md:right-4 md:w-96"
      >
        <div className="glass-card p-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-card to-primary/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Never Miss Your Daily Drop!
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Get notified at 6 PM when your curated match is ready.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleEnable}
                  disabled={isLoading}
                  className="bg-gradient-to-r from-primary to-accent text-xs"
                >
                  {isLoading ? 'Enabling...' : 'Enable Notifications'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  className="text-xs text-muted-foreground"
                >
                  Not Now
                </Button>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
