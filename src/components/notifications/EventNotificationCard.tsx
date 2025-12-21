import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, X, Clock } from 'lucide-react';
import { EventNotification } from '@/contexts/NotificationContext';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface EventNotificationCardProps {
  notification: EventNotification;
  onDismiss: () => void;
  index: number;
}

const EventNotificationCard = ({ notification, onDismiss, index }: EventNotificationCardProps) => {
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const diff = notification.startsAt.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Starting now!');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [notification.startsAt]);

  const handleJoin = () => {
    navigate('/events');
    onDismiss();
  };

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
        if (info.offset.y < -50 && !notification.isSticky) {
          onDismiss();
        }
      }}
      className="relative group"
      style={{ zIndex: 100 - index }}
    >
      {/* Glow effect */}
      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-teal-500 opacity-60 blur-sm group-hover:opacity-80 transition-opacity" />
      
      {/* Card content */}
      <div className="relative rounded-2xl bg-card/90 backdrop-blur-xl border border-cyan-500/30 shadow-2xl overflow-hidden">
        {/* Dismiss button - only if not sticky */}
        {!notification.isSticky && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="absolute top-2 right-2 p-1 rounded-full bg-muted/50 hover:bg-muted transition-colors z-10"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        )}

        <div className="flex items-center gap-3 p-4">
          {/* Event image */}
          <div className="relative">
            <div className="w-14 h-14 rounded-xl overflow-hidden ring-2 ring-cyan-500 ring-offset-2 ring-offset-card">
              <img
                src={notification.eventImage}
                alt={notification.eventTitle}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 flex items-center justify-center">
              <Calendar className="w-3 h-3 text-white" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="font-display font-semibold text-foreground text-sm">
              {notification.eventTitle}
            </p>
            
            {/* Countdown timer */}
            <div className="flex items-center gap-2 mt-1">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <motion.span
                key={timeLeft}
                initial={{ opacity: 0.5, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-sm font-mono text-cyan-400 font-semibold"
              >
                Starts in {timeLeft}
              </motion.span>
            </div>
          </div>

          {/* Join button */}
          <Button
            onClick={handleJoin}
            size="sm"
            className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white font-semibold shadow-lg"
          >
            Join
          </Button>
        </div>

        {/* Sticky indicator */}
        {notification.isSticky && (
          <div className="px-4 pb-3 pt-0">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
              This notification will stay until the event starts
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default EventNotificationCard;
