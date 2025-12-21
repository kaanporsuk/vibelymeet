import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send } from 'lucide-react';
import { MessageNotification } from '@/contexts/NotificationContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface MessageNotificationCardProps {
  notification: MessageNotification;
  onDismiss: () => void;
  onTap: () => void;
  index: number;
}

const MessageNotificationCard = ({ notification, onDismiss, onTap, index }: MessageNotificationCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [replyText, setReplyText] = useState('');

  const handleQuickReply = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (replyText.trim() && notification.onQuickReply) {
      notification.onQuickReply(replyText);
      setReplyText('');
      onDismiss();
    }
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
      dragElastic={{ top: 0.5, bottom: 0.3 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -50) {
          onDismiss();
        } else if (info.offset.y > 30) {
          setIsExpanded(true);
        }
      }}
      className="relative cursor-pointer group"
      style={{ zIndex: 100 - index }}
    >
      {/* Glow effect */}
      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 opacity-60 blur-sm group-hover:opacity-80 transition-opacity" />
      
      {/* Card content */}
      <div className="relative rounded-2xl bg-card/90 backdrop-blur-xl border border-violet-500/30 shadow-2xl overflow-hidden">
        {/* Dismiss button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute top-2 right-2 p-1 rounded-full bg-muted/50 hover:bg-muted transition-colors z-10"
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-3 p-4" onClick={onTap}>
          {/* Avatar with message indicator */}
          <div className="relative">
            <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-violet-500 ring-offset-2 ring-offset-card">
              <img
                src={notification.senderAvatar}
                alt={notification.senderName}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 flex items-center justify-center">
              <MessageCircle className="w-3 h-3 text-white" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 pr-6">
            <p className="font-display font-semibold text-foreground">
              {notification.senderName}
            </p>
            <p className="text-sm text-muted-foreground truncate">
              {notification.messagePreview}
            </p>
          </div>

          {/* Quick reply button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 text-xs"
          >
            Reply
          </Button>
        </div>

        {/* Expandable quick reply */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-border/50"
            >
              <form onSubmit={handleQuickReply} className="p-3 flex gap-2">
                <Input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a quick reply..."
                  className="flex-1 bg-muted/50 border-violet-500/30 focus:border-violet-500 text-sm"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!replyText.trim()}
                  className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default MessageNotificationCard;
