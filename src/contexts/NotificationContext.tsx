import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type NotificationType = 'match' | 'message' | 'event' | 'date_proposal';

export interface BaseNotification {
  id: string;
  type: NotificationType;
  timestamp: Date;
  dismissed?: boolean;
}

export interface MatchNotification extends BaseNotification {
  type: 'match';
  matchId: string;
  matchName: string;
  matchAvatar: string;
}

export interface MessageNotification extends BaseNotification {
  type: 'message';
  senderId: string;
  senderName: string;
  senderAvatar: string;
  messagePreview: string;
  onQuickReply?: (message: string) => void;
}

export interface EventNotification extends BaseNotification {
  type: 'event';
  eventId: string;
  eventTitle: string;
  eventImage: string;
  startsAt: Date;
  isSticky?: boolean;
}

export interface DateProposalNotification extends BaseNotification {
  type: 'date_proposal';
  proposalId: string;
  matchName: string;
  matchAvatar: string;
  action: 'accepted' | 'declined' | 'received';
  dateInfo: string;
  mode: 'video' | 'in-person';
}

export type Notification = MatchNotification | MessageNotification | EventNotification | DateProposalNotification;

// Input types without id and timestamp
export type MatchNotificationInput = Omit<MatchNotification, 'id' | 'timestamp'>;
export type MessageNotificationInput = Omit<MessageNotification, 'id' | 'timestamp'>;
export type EventNotificationInput = Omit<EventNotification, 'id' | 'timestamp'>;
export type DateProposalNotificationInput = Omit<DateProposalNotification, 'id' | 'timestamp'>;
export type NotificationInput = MatchNotificationInput | MessageNotificationInput | EventNotificationInput | DateProposalNotificationInput;

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: NotificationInput) => string;
  dismissNotification: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

let notificationId = 0;
const generateId = () => `notification-${++notificationId}-${Date.now()}`;

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  const unreadCount = notifications.filter(n => !n.dismissed && !readIds.has(n.id)).length;

  const addNotification = useCallback((notification: NotificationInput) => {
    const id = generateId();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
    } as Notification;

    setNotifications((prev) => [newNotification, ...prev]);

    // Auto-dismiss non-sticky notifications after 5 seconds
    if (notification.type !== 'event' || !(notification as EventNotificationInput).isSticky) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 5000);
    }

    return id;
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach(n => next.add(n.id));
      return next;
    });
  }, [notifications]);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setReadIds(new Set());
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, dismissNotification, markAllAsRead, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
