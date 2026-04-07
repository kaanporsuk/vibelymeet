import { motion } from 'framer-motion';
import { Calendar, X } from 'lucide-react';
import { DateProposalNotification } from '@/contexts/NotificationContext';

interface DateProposalNotificationCardProps {
  notification: DateProposalNotification;
  onDismiss: () => void;
  onTap: () => void;
  index: number;
}

const actionLabel: Record<DateProposalNotification['action'], string> = {
  received: 'sent you a date proposal',
  accepted: 'accepted your date proposal',
  declined: 'declined your date proposal',
};

const DateProposalNotificationCard = ({
  notification,
  onDismiss,
  onTap,
  index,
}: DateProposalNotificationCardProps) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -100, scale: 0.8 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: 'spring', stiffness: 400, damping: 25 },
      }}
      exit={{
        opacity: 0,
        y: -50,
        scale: 0.8,
        transition: { duration: 0.2 },
      }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.5, bottom: 0.1 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -50) onDismiss();
      }}
      onClick={onTap}
      className="relative cursor-pointer group"
      style={{ zIndex: 100 - index }}
    >
      {/* Glow */}
      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-400 opacity-60 blur-sm group-hover:opacity-90 transition-opacity" />

      <div className="relative flex items-center gap-3 p-4 rounded-2xl bg-card/90 backdrop-blur-xl border border-violet-500/30 shadow-2xl">
        {/* Dismiss */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute top-2 right-2 p-1 rounded-full bg-muted/50 hover:bg-muted transition-colors"
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </button>

        {/* Avatar */}
        <div className="relative">
          <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-violet-500 ring-offset-2 ring-offset-card">
            <img
              src={notification.matchAvatar}
              alt={notification.matchName}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center">
            <Calendar className="w-3 h-3 text-white" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-1.5">
            <span className="text-base">📅</span>
            <span className="font-display font-semibold text-foreground text-sm">Date Proposal</span>
          </div>
          <p className="text-sm text-muted-foreground truncate">
            <span className="font-medium text-foreground">{notification.matchName}</span>{' '}
            {actionLabel[notification.action]}
          </p>
          {notification.dateInfo && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{notification.dateInfo}</p>
          )}
        </div>

        {/* Arrow */}
        <motion.div
          animate={{ x: [0, 4, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-violet-400"
        >
          →
        </motion.div>
      </div>
    </motion.div>
  );
};

export default DateProposalNotificationCard;
