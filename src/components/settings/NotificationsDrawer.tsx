import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Heart,
  MessageSquare,
  Phone,
  Sparkles,
  Video,
  Calendar,
  Clock,
  Zap,
  Compass,
  Gift,
  CreditCard,
  Shield,
  Volume2,
  Lock,
  PauseCircle,
  Moon,
  Layers,
  AlertTriangle,
  AlarmClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NotificationsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPauseRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Off";
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function dbTimeToInputValue(db: string): string {
  const parts = (db || "22:00:00").split(":");
  const h = String(parts[0] ?? "22").padStart(2, "0").slice(0, 2);
  const m = String(parts[1] ?? "00").padStart(2, "0").slice(0, 2);
  return `${h}:${m}`;
}

function inputValueToDbTime(html: string): string {
  const [hRaw, mRaw] = (html || "22:00").split(":");
  const h = Math.min(23, Math.max(0, parseInt(hRaw || "0", 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(mRaw || "0", 10) || 0));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function formatQuietWindowHuman(startDb: string, endDb: string): string {
  const base = new Date();
  const toDate = (t: string) => {
    const [a, b] = (t || "00:00:00").split(":").map((x) => parseInt(x, 10) || 0);
    const d = new Date(base);
    d.setHours(a, b, 0, 0);
    return d;
  };
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return `Silent from ${toDate(startDb).toLocaleTimeString(undefined, opts)} to ${toDate(endDb).toLocaleTimeString(undefined, opts)}`;
  } catch {
    return "Quiet hours updated";
  }
}

export function NotificationsDrawer({ open, onOpenChange }: NotificationsDrawerProps) {
  const { user } = useUserProfile();
  const { refreshSubscriptionState } = usePushNotifications();
  const { prefs, isLoading, isSaving, isPushSubscribed, isPaused, toggle, savePrefs, setPauseUntil } =
    useNotificationPreferences();
  const [pauseOptionsOpen, setPauseOptionsOpen] = useState(false);

  const pauseChip = useMemo(() => {
    if (!isPaused || !prefs.paused_until) return "Off";
    return formatPauseRemaining(prefs.paused_until);
  }, [isPaused, prefs.paused_until]);

  const quietWindowLabel = useMemo(
    () => formatQuietWindowHuman(prefs.quiet_hours_start, prefs.quiet_hours_end),
    [prefs.quiet_hours_start, prefs.quiet_hours_end]
  );

  const handleEnablePush = async () => {
    if (!user?.id) return;
    const ok = await requestWebPushPermissionAndSync(user.id);
    await refreshSubscriptionState();
    if (ok) {
      window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
      toast.success("Push notifications enabled! 🔔");
    }
  };

  const handlePause = (duration: string) => {
    const now = new Date();
    let until: Date;
    switch (duration) {
      case "1h":
        until = new Date(now.getTime() + 3600000);
        break;
      case "8h":
        until = new Date(now.getTime() + 28800000);
        break;
      case "24h":
        until = new Date(now.getTime() + 86400000);
        break;
      case "7d":
        until = new Date(now.getTime() + 604800000);
        break;
      case "tomorrow": {
        until = new Date(now);
        until.setDate(until.getDate() + 1);
        until.setHours(8, 0, 0, 0);
        if (until.getTime() <= now.getTime()) until.setDate(until.getDate() + 1);
        break;
      }
      default:
        return;
    }
    setPauseUntil(until.toISOString());
    setPauseOptionsOpen(false);
    toast.success("Notifications paused");
  };

  const handleUnpause = () => {
    setPauseUntil(null);
    toast.success("Notifications resumed");
  };

  const browserDenied = typeof Notification !== "undefined" && Notification.permission === "denied";
  const disabled = !prefs.push_enabled || isPaused;

  const ToggleRow = ({
    icon: Icon,
    label,
    description,
    prefKey,
    iconColor = "text-muted-foreground",
  }: {
    icon: any;
    label: string;
    description: string;
    prefKey: keyof typeof prefs;
    iconColor?: string;
  }) => (
    <div className={cn("flex items-center justify-between p-3 rounded-xl bg-secondary/40", disabled && "opacity-40 pointer-events-none")}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Icon className={cn("w-4 h-4 shrink-0", iconColor)} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch
        checked={prefs[prefKey] as boolean}
        onCheckedChange={() => toggle(prefKey)}
        disabled={disabled}
      />
    </div>
  );

  const SectionHeader = ({ label }: { label: string }) => (
    <div className="pt-4 pb-1 border-t border-border/50 first:border-t-0 first:pt-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
    </div>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle className="font-display flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Notifications
          </DrawerTitle>
          <DrawerDescription>Control what you hear about</DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-3 overflow-y-auto max-h-[65vh]">
          {/* Push Status Card */}
          {!isPushSubscribed && !browserDenied && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <p className="text-sm font-medium text-foreground">Push notifications are off</p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">You'll miss matches, messages, and date invitations</p>
              <Button variant="gradient" size="sm" onClick={handleEnablePush}>
                Enable Push Notifications
              </Button>
            </div>
          )}

          {browserDenied && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="w-4 h-4 text-destructive" />
                <p className="text-sm font-medium text-foreground">Blocked by your browser</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Tap the lock icon in your address bar → Notifications → Allow
              </p>
            </div>
          )}

          {/* Pause notifications — timed row (no master switch here) */}
          <div className="rounded-xl bg-secondary/40 p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setPauseOptionsOpen((o) => !o)}
            >
              <div className="flex items-center gap-3">
                <PauseCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Pause Notifications</p>
                  <p className="text-xs text-muted-foreground">Silence pushes for a while</p>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
                  isPaused
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                    : "border-white/10 bg-white/5 text-white/70",
                )}
              >
                {pauseChip}
              </span>
            </button>
            {pauseOptionsOpen ? (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border/40 pt-3">
                {isPaused ? (
                  <Button size="sm" variant="outline" className="w-full" onClick={handleUnpause}>
                    Resume now
                  </Button>
                ) : null}
                {(
                  [
                    ["1h", "1 hour"],
                    ["8h", "8 hours"],
                    ["tomorrow", "Until tomorrow"],
                    ["24h", "24 hours"],
                    ["7d", "1 week"],
                  ] as const
                ).map(([key, label]) => (
                  <Button key={key} size="sm" variant="secondary" type="button" onClick={() => handlePause(key)}>
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Master Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/40">
            <div className="flex items-center gap-3">
              <Bell className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">All Notifications</p>
                {!prefs.push_enabled && (
                  <p className="text-xs text-muted-foreground">Turn on to manage individual categories</p>
                )}
              </div>
            </div>
            <Switch checked={prefs.push_enabled} onCheckedChange={() => toggle("push_enabled")} />
          </div>

          {isPaused ? (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p className="font-medium">Notifications are paused</p>
              <p className="mt-1 text-xs text-amber-200/90">
                Category toggles below are disabled until you resume or the timer ends.
              </p>
            </div>
          ) : null}

          {/* Category Groups */}
          <SectionHeader label="Connections" />
          <div className="space-y-2">
            <ToggleRow icon={Heart} label="New Match" description="When you and someone both vibe" prefKey="notify_new_match" iconColor="text-pink-500" />
            <ToggleRow icon={MessageSquare} label="Messages" description="New messages from matches" prefKey="notify_messages" iconColor="text-blue-500" />
            <ToggleRow icon={Phone} label="Match calls" description="Incoming voice and video calls from matches" prefKey="notify_match_calls" iconColor="text-emerald-500" />
            <ToggleRow icon={Sparkles} label="Someone Vibed You" description="When someone swipes vibe on you" prefKey="notify_someone_vibed_you" iconColor="text-purple-500" />
            <ToggleRow icon={Video} label="Ready Gate" description="Video date invitations" prefKey="notify_ready_gate" iconColor="text-green-500" />
          </div>

          <SectionHeader label="Events & Dates" />
          <div className="space-y-2">
            <ToggleRow icon={Calendar} label="Event Going Live" description="When an event you joined starts" prefKey="notify_event_live" iconColor="text-orange-500" />
            <ToggleRow icon={Clock} label="Event Reminders" description="Reminders before your events" prefKey="notify_event_reminder" iconColor="text-amber-500" />
            <ToggleRow icon={AlarmClock} label="Date Reminders" description="Alerts before your video dates" prefKey="notify_date_reminder" iconColor="text-cyan-500" />
          </div>

          <SectionHeader label="Discovery" />
          <div className="space-y-2">
            <ToggleRow icon={Zap} label="Daily Drop" description="Your daily curated match" prefKey="notify_daily_drop" iconColor="text-yellow-500" />
            <ToggleRow icon={Compass} label="Recommendations" description="People and events you might like" prefKey="notify_recommendations" />
            <ToggleRow icon={Gift} label="Product Updates" description="New features and improvements" prefKey="notify_product_updates" />
          </div>

          <SectionHeader label="Account" />
          <div className="space-y-2">
            <ToggleRow icon={CreditCard} label="Credits & Purchases" description="Purchase confirmations" prefKey="notify_credits_subscription" />
            {/* Safety — always on, not toggleable */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/40">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">Safety Alerts</p>
                  <p className="text-xs text-muted-foreground">Safety & account alerts · Always on</p>
                </div>
              </div>
              <Lock className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>

          {/* Sound */}
          <SectionHeader label="Sound" />
          <ToggleRow icon={Volume2} label="Notification Sound" description="Play a sound with notifications" prefKey="sound_enabled" />

          {/* Quiet Hours */}
          <SectionHeader label="Quiet Hours" />
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/40">
              <div className="flex items-center gap-3">
                <Moon className="w-4 h-4 text-indigo-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Quiet Hours</p>
                  {prefs.quiet_hours_enabled && (
                    <p className="text-xs text-muted-foreground">{quietWindowLabel}</p>
                  )}
                </div>
              </div>
              <Switch checked={prefs.quiet_hours_enabled} onCheckedChange={() => toggle("quiet_hours_enabled")} />
            </div>
            {prefs.quiet_hours_enabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="p-3 rounded-xl bg-secondary/20 space-y-3"
              >
                <p className="text-sm text-foreground">{quietWindowLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Timezone (from this device):{" "}
                  <span className="font-medium text-foreground/90">{prefs.quiet_hours_timezone}</span>
                </p>
                <div className="flex flex-wrap gap-4 items-end">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Start
                    <input
                      type="time"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                      value={dbTimeToInputValue(prefs.quiet_hours_start)}
                      onChange={(e) => {
                        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                        savePrefs({
                          quiet_hours_start: inputValueToDbTime(e.target.value),
                          quiet_hours_timezone: tz,
                        });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    End
                    <input
                      type="time"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                      value={dbTimeToInputValue(prefs.quiet_hours_end)}
                      onChange={(e) => {
                        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                        savePrefs({
                          quiet_hours_end: inputValueToDbTime(e.target.value),
                          quiet_hours_timezone: tz,
                        });
                      }}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Urgent notifications like video date invitations and safety alerts will still come through
                </p>
              </motion.div>
            )}
          </div>

          {/* Smart Delivery */}
          <SectionHeader label="Smart Delivery" />
          <ToggleRow
            icon={Layers}
            label="Bundle rapid messages"
            description="Replaces repeated alerts with one updated notification per conversation"
            prefKey="message_bundle_enabled"
          />
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="gradient">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
