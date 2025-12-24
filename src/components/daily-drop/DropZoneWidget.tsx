import { Lock, Sparkles, Moon } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { DropZoneState } from '@/types/dailyDrop';

interface DropZoneWidgetProps {
  state: DropZoneState;
  countdown: { hours: number; minutes: number; seconds: number };
  pendingName?: string;
  pendingAvatar?: string;
  onUnlock: () => void;
  onViewEvents: () => void;
}

export function DropZoneWidget({
  state,
  countdown,
  pendingName,
  pendingAvatar,
  onUnlock,
  onViewEvents
}: DropZoneWidgetProps) {
  // State A: Locked (Countdown)
  if (state === 'locked') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6 relative overflow-hidden"
      >
        {/* Frosted overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-secondary/80 to-background/60 backdrop-blur-sm" />
        
        <div className="relative z-10 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
            <Lock className="w-8 h-8 text-muted-foreground" />
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground mb-2">Next Drop In...</p>
            <div className="flex justify-center gap-2">
              {[
                { value: countdown.hours, label: 'HRS' },
                { value: countdown.minutes, label: 'MIN' },
                { value: countdown.seconds, label: 'SEC' }
              ].map((item, i) => (
                <div key={i} className="text-center">
                  <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
                    <span className="text-xl font-display font-bold font-mono text-foreground">
                      {String(item.value).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground">Curating active users...</p>
        </div>
      </motion.div>
    );
  }

  // State B: Ready (Notification)
  if (state === 'ready') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative"
      >
        {/* Pulsing glow border */}
        <div className="absolute -inset-[2px] rounded-2xl bg-gradient-primary animate-glow-pulse opacity-75" />
        
        <div className="relative glass-card p-6 text-center space-y-4">
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            <Sparkles className="w-10 h-10 mx-auto text-primary" />
          </motion.div>
          
          <div>
            {/* Glitch text effect */}
            <h2 className="text-lg font-display font-bold gradient-text relative">
              <span className="relative inline-block animate-pulse">
                YOUR DAILY DROP IS HERE
              </span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Active recently & matches your Vibe.
            </p>
          </div>
          
          <Button 
            variant="gradient" 
            className="w-full"
            onClick={onUnlock}
          >
            Unlock Drop
          </Button>
        </div>
      </motion.div>
    );
  }

  // Pending state (waiting for reply)
  if (state === 'pending') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-full overflow-hidden blur-sm">
              <img 
                src={pendingAvatar} 
                alt="" 
                className="w-full h-full object-cover"
              />
            </div>
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neon-cyan"
            />
          </div>
          
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Pending</p>
            <p className="text-sm text-muted-foreground">
              Waiting for {pendingName} to vibe back...
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Empty state (High Standards)
  if (state === 'empty') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-8 text-center space-y-6"
      >
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          className="relative"
        >
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-neon-cyan/20 flex items-center justify-center">
            <Moon className="w-10 h-10 text-neon-cyan" />
          </div>
          {/* Subtle glow */}
          <div className="absolute inset-0 w-20 h-20 mx-auto rounded-full bg-neon-cyan/20 blur-xl" />
        </motion.div>
        
        <div>
          <h3 className="text-lg font-display font-semibold text-foreground">
            The Vault is Refilling
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            We're curating quality matches who are actively engaging.
            <br />
            Check back soon!
          </p>
        </div>
        
        <Button 
          variant="outline" 
          onClick={onViewEvents}
          className="border-primary/50 text-primary hover:bg-primary/10"
        >
          Check the Date Calendar
        </Button>
      </motion.div>
    );
  }

  return null;
}
