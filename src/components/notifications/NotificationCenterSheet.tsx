import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { BellOff, CheckCheck, Cog, Search, ShieldAlert, Zap } from "lucide-react";
import type { UserNotificationRow } from "@clientShared/notifications";
import type { PushDeliveryHealth } from "@clientShared/pushDeliveryHealth";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { trackEvent } from "@/lib/analytics";
import { resolveNotificationActionRoute } from "@/lib/notificationActions";
import type { NotificationInboxController } from "@/hooks/useNotificationInbox";
import { NotificationRow } from "./NotificationRow";

type NotificationCenterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inbox: NotificationInboxController;
  pushHealth: PushDeliveryHealth;
  onRequestPushSetup: () => void;
};

function notificationAgeSeconds(row: UserNotificationRow): number {
  return Math.max(0, Math.round((Date.now() - new Date(row.created_at).getTime()) / 1000));
}

function PushSetupBanner({
  health,
  onRequestPushSetup,
  onOpenSettings,
}: {
  health: PushDeliveryHealth;
  onRequestPushSetup: () => void;
  onOpenSettings: () => void;
}) {
  if (health.backendDeliverable) return null;

  const denied = health.permission === "denied";
  const unsupported = health.status === "unsupported";
  const preferencesDisabled = health.status === "preferences_disabled";
  const paused = health.status === "paused";
  const title = denied
    ? "Notifications are blocked in this browser"
    : unsupported
      ? "Push is not available here"
      : preferencesDisabled
        ? "Push notifications are off"
        : paused
          ? "Notifications are paused"
          : "Never miss a live vibe";
  const body = denied
    ? "Open browser settings to allow Vibely notifications."
    : unsupported
      ? "You can still use this inbox. Try push setup on the main HTTPS site or native app."
      : preferencesDisabled
        ? "Turn them back on in notification settings when you want alerts again."
        : paused
          ? "Resume push alerts from notification settings."
          : "Turn on push for matches, event reminders, and Ready Gate alerts.";

  return (
    <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.08] p-3">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-amber-300">
          {denied ? <ShieldAlert className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
          {!unsupported ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 h-8 border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15"
              onClick={preferencesDisabled || paused ? onOpenSettings : onRequestPushSetup}
            >
              {denied ? "How to fix" : preferencesDisabled || paused ? "Open settings" : "Enable notifications"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  onOpen,
  onDismiss,
}: {
  title: string;
  rows: UserNotificationRow[];
  onOpen: (row: UserNotificationRow) => void;
  onDismiss: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <NotificationRow key={row.id} notification={row} onOpen={onOpen} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}

function NotificationCenterContent({
  isOpen,
  inbox,
  pushHealth,
  onRequestPushSetup,
  onClose,
}: Omit<NotificationCenterSheetProps, "open" | "onOpenChange"> & { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const visibleIds = useMemo(
    () => inbox.rows.filter((row) => !row.seen_at).map((row) => row.id),
    [inbox.rows],
  );

  useEffect(() => {
    if (!isOpen || visibleIds.length === 0) return;
    void inbox.markSeen(visibleIds);
    for (const id of visibleIds) {
      const row = inbox.rows.find((item) => item.id === id);
      trackEvent("notification_seen", row ? {
        category: row.category,
        priority: row.priority,
        action_kind: row.action.kind,
        source_screen: "notification_center",
        push_state: pushHealth.status,
        notification_age_seconds: notificationAgeSeconds(row),
      } : undefined);
    }
  // Intentionally only run for the visible id signature while the center content is mounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, visibleIds.join("|")]);

  useEffect(() => {
    if (!isOpen || pushHealth.backendDeliverable) return;
    trackEvent("notification_push_setup_banner_shown", {
      source_screen: "notification_center",
      push_state: pushHealth.status,
    });
  }, [isOpen, pushHealth.backendDeliverable, pushHealth.status]);

  const handleOpen = async (row: UserNotificationRow) => {
    await inbox.markOpened(row.id);
    trackEvent("notification_read", {
      category: row.category,
      priority: row.priority,
      action_kind: row.action.kind,
      source_screen: "notification_center",
      push_state: pushHealth.status,
      notification_age_seconds: notificationAgeSeconds(row),
    });
    trackEvent("notification_opened", {
      category: row.category,
      priority: row.priority,
      action_kind: row.action.kind,
      source_screen: "notification_center",
      push_state: pushHealth.status,
      notification_age_seconds: notificationAgeSeconds(row),
    });
    const route = resolveNotificationActionRoute(row.action);
    if (!route) {
      trackEvent("notification_action_failed", {
        category: row.category,
        priority: row.priority,
        action_kind: row.action.kind,
        source_screen: "notification_center",
        push_state: pushHealth.status,
        notification_age_seconds: notificationAgeSeconds(row),
      });
      return;
    }
    onClose();
    navigate(route);
  };

  const handleDismiss = async (id: string) => {
    const row = inbox.rows.find((item) => item.id === id);
    await inbox.dismiss(id);
    if (row) {
      trackEvent("notification_dismissed", {
        category: row.category,
        priority: row.priority,
        action_kind: row.action.kind,
        source_screen: "notification_center",
        push_state: pushHealth.status,
        notification_age_seconds: notificationAgeSeconds(row),
      });
    }
  };

  const handleMarkAllRead = async () => {
    await inbox.markAllRead();
    trackEvent("notification_mark_all_read", {
      source_screen: "notification_center",
      push_state: pushHealth.status,
    });
  };

  const empty = !inbox.isLoading && inbox.rows.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-lg font-display font-bold text-foreground">Notifications</h2>
          <p className="text-sm text-muted-foreground">
            {inbox.unseenCount > 0 ? `${inbox.unseenCount} new` : "All caught up"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="icon" onClick={handleMarkAllRead} disabled={inbox.rows.length === 0}>
            <CheckCheck className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => { onClose(); navigate("/settings?drawer=notifications"); }}>
            <Cog className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <PushSetupBanner
            health={pushHealth}
            onOpenSettings={() => {
              trackEvent("notification_push_setup_clicked", {
                source_screen: "notification_center",
                push_state: pushHealth.status,
              });
              onClose();
              navigate("/settings?drawer=notifications");
            }}
            onRequestPushSetup={() => {
              trackEvent("notification_push_setup_clicked", {
                source_screen: "notification_center",
                push_state: pushHealth.status,
              });
              onClose();
              onRequestPushSetup();
            }}
          />

          {inbox.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-lg bg-white/[0.06]" />
              ))}
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground">
                <BellOff className="h-6 w-6" />
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground">No new vibes yet</h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                Matches, messages, drops, and event reminders will appear here.
              </p>
              <Button type="button" variant="gradient" className="mt-5" onClick={() => { onClose(); navigate("/events"); }}>
                <Search className="mr-2 h-4 w-4" />
                Browse Events
              </Button>
            </div>
          ) : (
            <>
              <Section title="Needs action" rows={inbox.grouped.needsAction} onOpen={handleOpen} onDismiss={handleDismiss} />
              <Section title="Today" rows={inbox.grouped.today} onOpen={handleOpen} onDismiss={handleDismiss} />
              <Section title="Earlier" rows={inbox.grouped.earlier} onOpen={handleOpen} onDismiss={handleDismiss} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotificationCenterSheet(props: NotificationCenterSheetProps) {
  const isMobile = useIsMobile();
  const content = (
    <NotificationCenterContent
      isOpen={props.open}
      inbox={props.inbox}
      pushHealth={props.pushHealth}
      onRequestPushSetup={props.onRequestPushSetup}
      onClose={() => props.onOpenChange(false)}
    />
  );

  useEffect(() => {
    if (!props.open) return;
    trackEvent("notification_center_opened", {
      source_screen: "dashboard",
      push_state: props.pushHealth.status,
      unseen_count: props.inbox.unseenCount,
    });
  }, [props.inbox.unseenCount, props.open, props.pushHealth.status]);

  if (isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={props.onOpenChange}>
        <DrawerContent className="max-h-[88vh] border-white/10 bg-background">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Notifications</DrawerTitle>
            <DrawerDescription>Live Attention Center</DrawerDescription>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-[400px] max-w-[calc(100vw-2rem)] border-white/10 p-0 sm:max-w-[420px]">
        <SheetHeader className="sr-only">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>Live Attention Center</SheetDescription>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}
