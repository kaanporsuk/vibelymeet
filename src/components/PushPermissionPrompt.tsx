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
import { promptForPush, getPlayerId, isSubscribed } from "@/lib/onesignal";
import { sendNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

const PROMPTED_KEY = "vibely_push_prompted";
const RE_PROMPT_DAYS = 7;

export function PushPermissionPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    if (!("Notification" in window)) return;

    const checkEligibility = async () => {
      // Already subscribed?
      const subscribed = await isSubscribed();
      if (subscribed) return;

      // Already granted at browser level?
      if (Notification.permission === "granted") return;
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
    const granted = await promptForPush();
    if (granted) {
      const playerId = await getPlayerId();
      if (playerId && user?.id) {
        await supabase.from("notification_preferences").upsert(
          {
            user_id: user.id,
            onesignal_player_id: playerId,
            onesignal_subscribed: true,
          },
          { onConflict: "user_id" }
        );
      }
      localStorage.setItem(PROMPTED_KEY, String(Date.now()));
      setOpen(false);
      trackEvent('push_permission_granted');
      toast.success("Notifications enabled! 🔔");

      // Send welcome notification
      if (user?.id) {
        sendNotification({
          user_id: user.id,
          category: "safety_alerts",
          title: "Notifications are on! 🔔",
          body: "You can customize what you receive anytime in Settings → Notifications",
          data: { url: "/settings" },
          bypass_preferences: true,
        });
      }
    }
  };

  const handleLater = () => {
    localStorage.setItem(PROMPTED_KEY, String(Date.now()));
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
          <Button variant="ghost" onClick={handleLater} className="w-full text-muted-foreground">
            Maybe Later
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
