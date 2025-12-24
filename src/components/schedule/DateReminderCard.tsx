import { motion, AnimatePresence } from 'framer-motion';
import { Video, MapPin, Clock, Bell, BellRing } from 'lucide-react';
import { DateReminder } from '@/hooks/useDateReminders';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface DateReminderCardProps {
  reminder: DateReminder;
  onJoinDate?: () => void;
  onEnableNotifications?: () => void;
  notificationsEnabled?: boolean;
}

export function DateReminderCard({ 
  reminder, 
  onJoinDate, 
  onEnableNotifications,
  notificationsEnabled = false 
}: DateReminderCardProps) {
  const isUrgent = reminder.urgency === 'imminent' || reminder.urgency === 'now';
  const isSoon = reminder.urgency === 'soon';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-2xl p-4",
        "border backdrop-blur-sm",
        isUrgent && "bg-gradient-to-br from-destructive/20 to-orange-500/20 border-destructive/50",
        isSoon && "bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border-amber-500/50",
        !isUrgent && !isSoon && "bg-gradient-to-br from-primary/10 to-neon-cyan/10 border-primary/30"
      )}
    >
      {/* Urgent Pulse Effect */}
      {isUrgent && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-destructive/10 to-transparent"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      <div className="relative z-10 flex items-start gap-3">
        {/* Mode Icon */}
        <motion.div 
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
            reminder.mode === 'video' ? "bg-neon-cyan/20" : "bg-accent/20",
            isUrgent && "animate-pulse"
          )}
          animate={isUrgent ? { scale: [1, 1.1, 1] } : undefined}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {reminder.mode === 'video' ? (
            <Video className={cn("w-6 h-6", isUrgent ? "text-destructive" : "text-neon-cyan")} />
          ) : (
            <MapPin className="w-6 h-6 text-accent" />
          )}
        </motion.div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">
            {reminder.matchName}
          </p>
          <p className="text-sm text-muted-foreground">
            {format(reminder.date, "EEEE, MMM d 'at' h:mm a")}
          </p>

          {/* Countdown */}
          <div className="mt-2 flex items-center gap-2">
            <Clock className={cn(
              "w-4 h-4",
              isUrgent && "text-destructive",
              isSoon && "text-amber-400",
              !isUrgent && !isSoon && "text-primary"
            )} />
            <span className={cn(
              "text-lg font-mono font-bold",
              isUrgent && "text-destructive",
              isSoon && "text-amber-400",
              !isUrgent && !isSoon && "text-primary"
            )}>
              {reminder.formattedCountdown}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex flex-col gap-2">
          {reminder.urgency === 'now' && reminder.mode === 'video' && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onJoinDate}
              className={cn(
                "px-4 py-2 rounded-xl font-medium text-sm",
                "bg-gradient-to-r from-primary to-neon-cyan text-background",
                "hover:opacity-90 transition-opacity"
              )}
            >
              Join Now
            </motion.button>
          )}
          
          {!notificationsEnabled && (
            <button
              onClick={onEnableNotifications}
              className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Bell className="w-4 h-4" />
            </button>
          )}

          {notificationsEnabled && (
            <div className="p-2 text-primary">
              <BellRing className="w-4 h-4" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Mini countdown widget for header
export function MiniDateCountdown({ reminder, onClick }: { reminder: DateReminder; onClick?: () => void }) {
  const isUrgent = reminder.urgency === 'imminent' || reminder.urgency === 'now';

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
        "border backdrop-blur-sm transition-colors",
        isUrgent 
          ? "bg-destructive/20 border-destructive/50 text-destructive" 
          : "bg-primary/10 border-primary/30 text-primary"
      )}
    >
      <Clock className={cn("w-3.5 h-3.5", isUrgent && "animate-pulse")} />
      <span className="font-mono font-medium">{reminder.formattedCountdown}</span>
      <span className="text-xs opacity-70">{reminder.matchName}</span>
    </motion.button>
  );
}
