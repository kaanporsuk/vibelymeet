import { Bell, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationBellProps = {
  unseenCount: number;
  urgentUnseenCount: number;
  pushSetupNeeded: boolean;
  onClick: () => void;
};

export function NotificationBell({
  unseenCount,
  urgentUnseenCount,
  pushSetupNeeded,
  onClick,
}: NotificationBellProps) {
  const hasUnseen = unseenCount > 0;
  const hasUrgent = urgentUnseenCount > 0;
  const Icon = hasUnseen ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition active:scale-95",
        hasUnseen
          ? "border-primary/35 bg-primary/15 text-primary shadow-[0_0_22px_hsl(var(--primary)/0.18)]"
          : "border-white/10 bg-white/5 text-foreground hover:bg-white/10",
      )}
      aria-label="Open notifications"
    >
      {hasUrgent ? (
        <span className="absolute inset-0 rounded-full border border-primary/60 animate-ping" />
      ) : null}
      <Icon className="relative h-5 w-5" />
      {hasUnseen ? (
        <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-violet-500 to-pink-500 px-1.5 text-[10px] font-bold leading-5 text-white shadow-lg">
          {unseenCount > 9 ? "9+" : unseenCount}
        </span>
      ) : pushSetupNeeded ? (
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border border-background bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.85)]" />
      ) : null}
    </button>
  );
}
