import { AnimatePresence, motion } from 'framer-motion';
import { useNotifications, Notification } from '@/contexts/NotificationContext';
import MatchNotificationCard from './MatchNotificationCard';
import MessageNotificationCard from './MessageNotificationCard';
import EventNotificationCard from './EventNotificationCard';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';

const NotificationContainer = () => {
  const { notifications, dismissNotification } = useNotifications();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const handleMatchTap = (matchId: string) => {
    // In a real app, this would open the profile drawer
    navigate(`/chat/${matchId}`);
  };

  const handleMessageTap = (senderId: string) => {
    navigate(`/chat/${senderId}`);
  };

  const renderNotification = (notification: Notification, index: number) => {
    switch (notification.type) {
      case 'match':
        return (
          <MatchNotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={() => dismissNotification(notification.id)}
            onTap={() => handleMatchTap(notification.matchId)}
            index={index}
          />
        );
      case 'message':
        return (
          <MessageNotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={() => dismissNotification(notification.id)}
            onTap={() => handleMessageTap(notification.senderId)}
            index={index}
          />
        );
      case 'event':
        return (
          <EventNotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={() => dismissNotification(notification.id)}
            index={index}
          />
        );
      default:
        return null;
    }
  };

  // Stack offset for card deck effect
  const getStackStyles = (index: number) => ({
    y: index * 8,
    scale: 1 - index * 0.02,
    opacity: 1 - index * 0.15,
  });

  return (
    <motion.div
      className={`fixed z-[9999] pointer-events-none ${
        isMobile 
          ? 'top-4 left-4 right-4' 
          : 'top-4 right-4 w-[380px]'
      }`}
    >
      <div className="relative">
        <AnimatePresence mode="popLayout">
          {notifications.slice(0, 5).map((notification, index) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: -100, scale: 0.8 }}
              animate={getStackStyles(index)}
              exit={{ opacity: 0, y: -50, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="pointer-events-auto mb-3"
              style={{ 
                position: index > 0 ? 'absolute' : 'relative',
                top: 0,
                left: 0,
                right: 0,
              }}
            >
              {renderNotification(notification, index)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Overflow indicator */}
      <AnimatePresence>
        {notifications.length > 5 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="pointer-events-auto mt-2 text-center"
          >
            <span className="text-xs text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-1 rounded-full border border-border/50">
              +{notifications.length - 5} more notifications
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default NotificationContainer;
