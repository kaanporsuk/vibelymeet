import { motion } from "framer-motion";
import { Video, MapPin, Check, X, Calendar } from "lucide-react";
import { DateProposalNotification } from "@/contexts/NotificationContext";
import { cn } from "@/lib/utils";

interface DateProposalNotificationCardProps {
  notification: DateProposalNotification;
  onDismiss: (id: string) => void;
}

export const DateProposalNotificationCard = ({
  notification,
  onDismiss,
}: DateProposalNotificationCardProps) => {
  const actionConfig = {
    accepted: {
      icon: Check,
      label: "accepted your date!",
      bgClass: "from-emerald-500/20 to-emerald-600/10",
      iconColor: "text-emerald-400",
    },
    declined: {
      icon: X,
      label: "declined your date",
      bgClass: "from-destructive/20 to-destructive/10",
      iconColor: "text-destructive",
    },
    received: {
      icon: Calendar,
      label: "sent you a date proposal!",
      bgClass: "from-primary/20 to-neon-cyan/10",
      iconColor: "text-neon-cyan",
    },
  };

  const config = actionConfig[notification.action];
  const ActionIcon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 100, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      className={cn(
        "relative w-80 rounded-2xl overflow-hidden border border-border/50",
        "bg-gradient-to-r",
        config.bgClass
      )}
    >
      <div className="absolute inset-0 glass-card" />
      
      <div className="relative p-4">
        <div className="flex items-start gap-3">
          {/* Avatar with action icon */}
          <div className="relative">
            <img
              src={notification.matchAvatar}
              alt={notification.matchName}
              className="w-12 h-12 rounded-full object-cover border-2 border-background"
            />
            <div className={cn(
              "absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center",
              "bg-background border border-border",
              config.iconColor
            )}>
              <ActionIcon className="w-3 h-3" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">
              <span className="font-semibold">{notification.matchName}</span>{" "}
              <span className="text-muted-foreground">{config.label}</span>
            </p>
            
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              {notification.mode === "video" ? (
                <Video className="w-3 h-3 text-neon-cyan" />
              ) : (
                <MapPin className="w-3 h-3 text-accent" />
              )}
              <span>{notification.dateInfo}</span>
            </div>
          </div>

          {/* Dismiss */}
          <button
            onClick={() => onDismiss(notification.id)}
            className="shrink-0 p-1 rounded-full hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};
