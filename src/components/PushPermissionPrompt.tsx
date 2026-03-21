import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { isSubscribed } from "@/lib/onesignal";
import { sendNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

const PROMPTED_KEY = "vibely_push_prompted";
const RE_PROMPT_DAYS = 7;

/** Page SDK attaches `window.OneSignal` after load; avoid clicking before it exists. */
async function waitForOneSignalOnWindow(timeoutMs = 12000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.OneSignal?.Notifications) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function resolvePlayerIdWithRetries(): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    const id = window.OneSignal?.User?.PushSubscription?.id;
    if (id) return id;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

export function PushPermissionPrompt() {
  const { user } = useUserProfile();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    if (!("Notification" in window)) return;

    const checkEligibility = async () => {
      // Fully set up for server push (OneSignal + browser)
      const subscribed = await isSubscribed();
      if (Notification.permission === "granted" && subscribed) return;

      if (Notification.permission === "denied") return;

      // Check localStorage prompt timing
      const prompted = localStorage.getItem(PROMPTED_KEY);
      if (prompted) {
        const ts = parseInt(prompted, 10);
        if (Date.now() - ts < RE_PROMPT_DAYS * 86400000) return;
      }

      // Check if user has a match or event registration (engagement signal)
      const [{ count: matchCount }, { count: regCount }] = await Promise.all([
        supabase
          .from("matches")
          .select("id", { count: "exact", head: true })
          .or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`),
        supabase
          .from("event_registrations")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", user.id),
      ]);

      if ((matchCount || 0) === 0 && (regCount || 0) === 0) return;

      // Show after 5 second delay
      setTimeout(() => setOpen(true), 5000);
    };

    checkEligibility();
  }, [user?.id]);

  const handleEnable = async () => {
    try {
      localStorage.setItem(PROMPTED_KEY, Date.now().toString());

      const ready = await waitForOneSignalOnWindow();
      if (!ready || !window.OneSignal) {
        console.warn("[Push] OneSignal not loaded");
        return;
      }

      await window.OneSignal.Notifications.requestPermission();

      const osPerm = window.OneSignal.Notifications.permission;
      const isGranted =
        osPerm === true ||
        osPerm === "granted" ||
        (typeof Notification !== "undefined" && Notification.permission === "granted");

      if (isGranted && user?.id) {
        const playerId = await resolvePlayerIdWithRetries();
        if (playerId) {
          const { error } = await supabase.from("notification_preferences").upsert(
            {
              user_id: user.id,
              onesignal_player_id: playerId,
              onesignal_subscribed: true,
              push_enabled: true,
            },
            { onConflict: "user_id" }
          );
          if (error) {
            console.error("[Push] notification_preferences upsert failed:", error);
          } else {
            window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
            trackEvent("push_permission_granted");
            toast.success("Notifications enabled! 🔔");
            sendNotification({
              user_id: user.id,
              category: "safety_alerts",
              title: "Notifications are on! 🔔",
              body: "You can customize what you receive anytime in Settings → Notifications",
              data: { url: "/settings" },
              bypass_preferences: true,
            });
          }
        } else {
          console.warn("[Push] Permission granted but no player id yet");
        }
      }
    } catch (err) {
      console.error("[Push] Permission error:", err);
    } finally {
      setOpen(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(PROMPTED_KEY, Date.now().toString());
    trackEvent("push_permission_deferred");
    setOpen(false);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent>
        <DrawerHeader className="text-center">
          <motion.div
            className="mx-auto w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mb-2"
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          >
            <Bell className="w-7 h-7 text-primary" />
          </motion.div>
          <DrawerTitle className="font-display text-xl">Stay in the loop</DrawerTitle>
          <DrawerDescription className="text-sm">
            Get notified instantly when someone matches with you, messages you, or when your event
            goes live. You control exactly what you receive in Settings.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className="gap-2">
          <Button variant="gradient" onClick={handleEnable} className="w-full">
            Enable Notifications
          </Button>
          <Button variant="ghost" onClick={handleDismiss} className="w-full text-muted-foreground">
            Maybe Later
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
