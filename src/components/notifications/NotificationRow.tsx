import { formatDistanceToNow } from "date-fns";
import { X } from "lucide-react";
import type { UserNotificationRow } from "@clientShared/notifications";
import { cn } from "@/lib/utils";
import { iconForNotificationCategory } from "./notificationIcons";

type NotificationRowProps = {
  notification: UserNotificationRow;
  onOpen: (notification: UserNotificationRow) => void;
  onDismiss: (id: string) => void;
};

export function NotificationRow({ notification, onOpen, onDismiss }: NotificationRowProps) {
  const Icon = iconForNotificationCategory(notification.category);
  const unread = !notification.read_at;
  const urgent = notification.priority === "urgent";

  return (
    <div
      className={cn(
        "group relative rounded-lg border p-3 transition-colors",
        unread ? "border-primary/25 bg-primary/[0.08]" : "border-white/10 bg-white/[0.03]",
        urgent && "shadow-[0_0_24px_hsl(var(--primary)/0.12)]",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="flex w-full items-start gap-3 text-left"
      >
        <div className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          urgent ? "bg-pink-500/15 text-pink-300" : "bg-primary/12 text-primary",
        )}>
          {notification.image_url ? (
            <img src={notification.image_url} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <p className={cn("min-w-0 flex-1 text-sm leading-snug", unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
              {notification.group_count > 1 && notification.category === "message"
                ? `${notification.group_count} new messages`
                : notification.title}
            </p>
            {!notification.seen_at ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pink-400" /> : null}
          </div>
          {notification.body ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{notification.body}</p>
          ) : null}
          <p className="text-[11px] font-medium text-muted-foreground/80">
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground opacity-0 transition hover:bg-white/10 hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
