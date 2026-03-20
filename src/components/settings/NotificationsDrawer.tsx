import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Heart,
  MessageSquare,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface NotificationsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationsDrawer({ open, onOpenChange }: NotificationsDrawerProps) {
  const { user } = useUserProfile();
  const { refreshSubscriptionState } = usePushNotifications();
  const { prefs, isLoading, isSaving, isPushSubscribed, isPaused, toggle, savePrefs, setPauseUntil } =
    useNotificationPreferences();

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
      case "1h": until = new Date(now.getTime() + 3600000); break;
      case "8h": until = new Date(now.getTime() + 28800000); break;
      case "24h": until = new Date(now.getTime() + 86400000); break;
      case "7d": until = new Date(now.getTime() + 604800000); break;
      default: return;
    }
    setPauseUntil(until.toISOString());
    toast.success(`Notifications paused for ${duration.replace("h", " hours").replace("d", " days")}`);
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

  const formatQuietTime = (time: string) => {
    const [h] = time.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${h12}:00 ${ampm}`;
  };

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

          {/* Pause All */}
          <div className="p-3 rounded-xl bg-secondary/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PauseCircle className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Pause All Notifications</p>
                  {isPaused && prefs.paused_until && (
                    <p className="text-xs text-amber-500">
                      Paused for {formatDistanceToNow(new Date(prefs.paused_until))}
                    </p>
                  )}
                </div>
              </div>
              {isPaused ? (
                <Button size="sm" variant="outline" onClick={handleUnpause}>Unpause</Button>
              ) : (
                <Select onValueChange={handlePause}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue placeholder="Pause" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">1 hour</SelectItem>
                    <SelectItem value="8h">8 hours</SelectItem>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
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

          {/* Category Groups */}
          <SectionHeader label="Connections" />
          <div className="space-y-2">
            <ToggleRow icon={Heart} label="New Match" description="When you and someone both vibe" prefKey="notify_new_match" iconColor="text-pink-500" />
            <ToggleRow icon={MessageSquare} label="Messages" description="New messages from matches" prefKey="notify_messages" iconColor="text-blue-500" />
            <ToggleRow icon={Sparkles} label="Someone Vibed You" description="When someone swipes vibe on you" prefKey="notify_someone_vibed_you" iconColor="text-purple-500" />
            <ToggleRow icon={Video} label="Ready Gate" description="Video date invitations" prefKey="notify_ready_gate" iconColor="text-green-500" />
          </div>

          <SectionHeader label="Events & Dates" />
          <div className="space-y-2">
            <ToggleRow icon={Calendar} label="Event Going Live" description="When an event you joined starts" prefKey="notify_event_live" iconColor="text-orange-500" />
            <ToggleRow icon={Clock} label="Event Reminders" description="Reminders before your events" prefKey="notify_event_reminder" iconColor="text-amber-500" />
            <ToggleRow icon={Clock} label="Date Reminders" description="Upcoming video date alerts" prefKey="notify_date_reminder" iconColor="text-cyan-500" />
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
                    <p className="text-xs text-muted-foreground">
                      Silent from {formatQuietTime(prefs.quiet_hours_start)} to {formatQuietTime(prefs.quiet_hours_end)}
                    </p>
                  )}
                </div>
              </div>
              <Switch checked={prefs.quiet_hours_enabled} onCheckedChange={() => toggle("quiet_hours_enabled")} />
            </div>
            {prefs.quiet_hours_enabled && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="p-3 rounded-xl bg-secondary/20 text-xs text-muted-foreground">
                <p>Times are in {prefs.quiet_hours_timezone}</p>
                <p className="mt-1">Urgent notifications like video date invitations and safety alerts will still come through</p>
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
