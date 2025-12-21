import { useNotifications } from '@/contexts/NotificationContext';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, Calendar } from 'lucide-react';

// Demo component to trigger test notifications
const NotificationDemo = () => {
  const { addNotification } = useNotifications();

  const triggerMatchNotification = () => {
    addNotification({
      type: 'match',
      matchId: 'demo-match-1',
      matchName: 'Sarah',
      matchAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop',
    });
  };

  const triggerMessageNotification = () => {
    addNotification({
      type: 'message',
      senderId: 'demo-sender-1',
      senderName: 'Emily',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop',
      messagePreview: 'Hey! I loved your vibe at the last event 💜',
      onQuickReply: (message) => {
        console.log('Quick reply sent:', message);
      },
    });
  };

  const triggerEventNotification = () => {
    const eventStart = new Date();
    eventStart.setMinutes(eventStart.getMinutes() + 5);
    
    addNotification({
      type: 'event',
      eventId: 'demo-event-1',
      eventTitle: 'Friday Night Vibes',
      eventImage: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=150&h=150&fit=crop',
      startsAt: eventStart,
      isSticky: true,
    });
  };

  return (
    <div className="fixed bottom-20 left-4 z-[9998] flex flex-col gap-2">
      <Button
        onClick={triggerMatchNotification}
        size="sm"
        className="bg-gradient-to-r from-pink-500 to-pink-400 hover:from-pink-600 hover:to-pink-500 shadow-lg"
      >
        <Heart className="w-4 h-4 mr-2" />
        Test Match
      </Button>
      <Button
        onClick={triggerMessageNotification}
        size="sm"
        className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 shadow-lg"
      >
        <MessageCircle className="w-4 h-4 mr-2" />
        Test Message
      </Button>
      <Button
        onClick={triggerEventNotification}
        size="sm"
        className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 shadow-lg"
      >
        <Calendar className="w-4 h-4 mr-2" />
        Test Event
      </Button>
    </div>
  );
};

export default NotificationDemo;
