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
import { isSubscribed, waitForOneSignalInitResult } from "@/lib/onesignal";
import { isOneSignalWebOriginAllowed } from "@/lib/oneSignalWebOrigin";
import { sendNotification } from "@/lib/notifications";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { vibelyOneSignalDebugEnabled, vibelyOsLog } from "@/lib/onesignalWebDiagnostics";

const PROMPTED_KEY = "vibely_push_prompted";
const RE_PROMPT_DAYS = 7;

export function PushPermissionPrompt() {
  const { user } = useUserProfile();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    if (!("Notification" in window)) return;

    const checkEligibility = async () => {
      if (!isOneSignalWebOriginAllowed()) {
        vibelyOsLog("PushPermissionPrompt:skip ineligible host", { origin: window.location.origin });
        return;
      }

      const { sdkUsable } = await waitForOneSignalInitResult();
      if (!sdkUsable) {
        if (import.meta.env.DEV || vibelyOneSignalDebugEnabled()) {
          console.warn(
            "[PushPermissionPrompt] OneSignal did not initialize on this page (wrong host, HTTPS, or dashboard site URL). Soft prompt suppressed."
          );
        }
        vibelyOsLog("PushPermissionPrompt:skip init not usable", { origin: window.location.origin });
        return;
      }

      const subscribed = await isSubscribed();
      if (Notification.permission === "granted" && subscribed) return;

      if (Notification.permission === "denied") return;

      const prompted = localStorage.getItem(PROMPTED_KEY);
      if (prompted) {
        const ts = parseInt(prompted, 10);
        if (Date.now() - ts < RE_PROMPT_DAYS * 86400000) return;
      }

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

      setTimeout(() => setOpen(true), 5000);
    };

    void checkEligibility();
  }, [user?.id]);

  const handleEnable = async () => {
    if (!user?.id) return;
    try {
      localStorage.setItem(PROMPTED_KEY, Date.now().toString());
      vibelyOsLog("PushPermissionPrompt:handleEnable", { origin: window.location.origin });

      const { sdkUsable } = await waitForOneSignalInitResult();
      if (!sdkUsable) {
        toast.error("Push isn’t available on this page. Try the main site over HTTPS.");
        return;
      }

      const ok = await requestWebPushPermissionAndSync(user.id);
      vibelyOsLog("PushPermissionPrompt:requestWebPushPermissionAndSync", { ok });

      if (ok) {
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
      } else if (Notification.permission === "denied") {
        toast.message("Notifications are blocked in your browser. You can enable them in site settings.");
      } else {
        toast.error("Couldn’t finish enabling notifications. Try again from Settings → Notifications.");
      }
    } catch (err) {
      console.error("[Push] Permission error:", err);
      toast.error("Something went wrong enabling notifications.");
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
