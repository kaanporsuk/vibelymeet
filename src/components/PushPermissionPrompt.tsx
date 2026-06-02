import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { initOneSignal, isSubscribed, waitForOneSignalInitResult } from "@/lib/onesignal";
import { isOneSignalWebOriginAllowed } from "@/lib/oneSignalWebOrigin";
import { sendNotification } from "@/lib/notifications";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { vibelyOneSignalDebugEnabled, vibelyOsLog } from "@/lib/onesignalWebDiagnostics";
import { recordUserAction } from "@/lib/browserDiagnostics";

const PROMPTED_KEY_PREFIX = "vibely_push_prompted:";
const RE_PROMPT_DAYS = 7;

function promptedKeyForUser(userId: string): string {
  return `${PROMPTED_KEY_PREFIX}${userId}`;
}

type PushPermissionRecovery = {
  title: string;
  message: string;
  primaryLabel: string;
};

export function PushPermissionPrompt() {
  const { user } = useUserProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<PushPermissionRecovery | null>(null);
  const lastEligibilityCountsRef = useRef<{ matchCount: number | null; regCount: number | null }>({
    matchCount: null,
    regCount: null,
  });
  const activeUserIdRef = useRef<string | null>(null);
  activeUserIdRef.current = user?.id ?? null;

  const resetPromptState = () => {
    setBusy(false);
    setRecovery(null);
  };

  useEffect(() => {
    setOpen(false);
    setBusy(false);
    setRecovery(null);
    lastEligibilityCountsRef.current = { matchCount: null, regCount: null };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (!("Notification" in window)) return;

    let cancelled = false;
    let promptTimer: number | null = null;

    const checkEligibility = async () => {
      if (!isOneSignalWebOriginAllowed()) {
        vibelyOsLog("PushPermissionPrompt:skip ineligible host", { origin: window.location.origin });
        return;
      }

      initOneSignal();
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

      const promptKey = promptedKeyForUser(user.id);
      const prompted = localStorage.getItem(promptKey);
      if (prompted) {
        const ts = parseInt(prompted, 10);
        if (Date.now() - ts < RE_PROMPT_DAYS * 86400000) return;
      }

      const [
        { count: matchCount, error: matchCountError },
        { count: regCount, error: regCountError },
      ] = await Promise.all([
        supabase
          .from("matches")
          .select("id", { count: "exact" })
          .or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`)
          .limit(1),
        supabase
          .from("event_registrations")
          .select("id", { count: "exact" })
          .eq("profile_id", user.id)
          .limit(1),
      ]);

      if ((matchCountError || regCountError) && (import.meta.env.DEV || vibelyOneSignalDebugEnabled())) {
        console.warn("[PushPermissionPrompt] eligibility count query failed:", {
          matchCountError: matchCountError?.message,
          regCountError: regCountError?.message,
        });
      }

      if (!matchCountError) {
        lastEligibilityCountsRef.current.matchCount = matchCount ?? 0;
      }
      if (!regCountError) {
        lastEligibilityCountsRef.current.regCount = regCount ?? 0;
      }

      const effectiveMatchCount =
        matchCountError ? lastEligibilityCountsRef.current.matchCount : matchCount ?? 0;
      const effectiveRegCount =
        regCountError ? lastEligibilityCountsRef.current.regCount : regCount ?? 0;
      if ((effectiveMatchCount ?? 0) === 0 && (effectiveRegCount ?? 0) === 0) return;

      if (cancelled) return;
      promptTimer = window.setTimeout(() => {
        if (!cancelled) setOpen(true);
      }, 5000);
    };

    void checkEligibility();

    return () => {
      cancelled = true;
      if (promptTimer != null) window.clearTimeout(promptTimer);
    };
  }, [user?.id]);

  const handleEnable = async () => {
    if (!user?.id || busy) return;
    const promptUserId = user.id;
    const stillActiveUser = () => activeUserIdRef.current === promptUserId;
    setBusy(true);
    setRecovery(null);
    let shouldClose = false;
    try {
      localStorage.setItem(promptedKeyForUser(promptUserId), Date.now().toString());
      vibelyOsLog("PushPermissionPrompt:handleEnable", { origin: window.location.origin });
      recordUserAction("push_prompt_enable_clicked", { surface: "push_permission_prompt" });

      const { sdkUsable } = await waitForOneSignalInitResult();
      if (!stillActiveUser()) return;
      if (!sdkUsable) {
        recordUserAction("push_prompt_enable_failed", {
          surface: "push_permission_prompt",
          reason: "sdk_not_usable",
        });
        setRecovery({
          title: "Notifications are not available here",
          message: "Push needs a supported browser on the main HTTPS site. You can still use in-app alerts while you are here.",
          primaryLabel: "Try again",
        });
        return;
      }

      const result = await requestWebPushPermissionAndSync(promptUserId);
      if (!stillActiveUser()) return;
      vibelyOsLog("PushPermissionPrompt:requestWebPushPermissionAndSync", { code: result.code, synced: result.synced });

      if (result.synced) {
        window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
        recordUserAction("push_prompt_enable_succeeded", { surface: "push_permission_prompt" });
        trackEvent("push_permission_granted");
        toast.success("Notifications enabled! 🔔");
        sendNotification({
          user_id: promptUserId,
          category: "safety_alerts",
          title: "Notifications are on! 🔔",
          body: "You can customize what you receive anytime in Settings → Notifications",
          data: { url: "/settings" },
          bypass_preferences: true,
        });
        shouldClose = true;
      } else if (result.code === "stale_identity") {
        localStorage.removeItem(promptedKeyForUser(promptUserId));
        recordUserAction("push_prompt_enable_stale_identity", { surface: "push_permission_prompt" });
        return;
      } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        recordUserAction("push_prompt_enable_failed", {
          surface: "push_permission_prompt",
          reason: "permission_denied",
        });
        setRecovery({
          title: "Notifications are blocked in your browser",
          message: "Use your browser site settings to allow notifications for Vibely, then come back and try again.",
          primaryLabel: "I updated settings",
        });
      } else if (result.code === "unsupported_browser") {
        recordUserAction("push_prompt_enable_failed", {
          surface: "push_permission_prompt",
          reason: result.code,
        });
        setRecovery({
          title: "Notifications are not available here",
          message: "This browser or in-app webview does not support web push. You can still use in-app alerts.",
          primaryLabel: "Try again",
        });
      } else if (result.code === "prompt_unavailable") {
        recordUserAction("push_prompt_enable_failed", {
          surface: "push_permission_prompt",
          reason: result.code,
        });
        setRecovery({
          title: "Notification prompt did not open",
          message: "Check your browser site settings for Vibely, then try again.",
          primaryLabel: "I updated settings",
        });
      } else if (result.code === "no_player_id_after_retry") {
        recordUserAction("push_prompt_enable_failed", {
          surface: "push_permission_prompt",
          reason: result.code,
        });
        setRecovery({
          title: "Notifications are still finishing setup",
          message: "Permission is allowed, but this browser has not finished creating the push subscription. Try again in a moment.",
          primaryLabel: "Try again",
        });
      } else {
        recordUserAction("push_prompt_enable_failed", {
          surface: "push_permission_prompt",
          reason: result.code,
        });
        setRecovery({
          title: "Notification setup failed",
          message: "We could not finish notification setup. Try again, or continue without push alerts.",
          primaryLabel: "Try again",
        });
      }
    } catch (err) {
      if (!stillActiveUser()) return;
      recordUserAction("push_prompt_enable_failed", {
        surface: "push_permission_prompt",
        reason: "exception",
      });
      console.error("[Push] Permission error:", err);
      setRecovery({
        title: "Notification setup failed",
        message: "Something went wrong enabling notifications. Check your connection and try again.",
        primaryLabel: "Try again",
      });
    } finally {
      if (stillActiveUser()) {
        setBusy(false);
        if (shouldClose) {
          resetPromptState();
          setOpen(false);
        }
      }
    }
  };

  const handleDismiss = () => {
    if (user?.id) {
      localStorage.setItem(promptedKeyForUser(user.id), Date.now().toString());
    }
    recordUserAction("push_prompt_dismissed", { surface: "push_permission_prompt" });
    trackEvent("push_permission_deferred");
    resetPromptState();
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetPromptState();
    }
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
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
          {recovery ? (
            <div
              role="status"
              data-testid="push-permission-recovery"
              className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-left"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-foreground">{recovery.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{recovery.message}</p>
                </div>
              </div>
            </div>
          ) : null}
          <Button variant="gradient" onClick={handleEnable} disabled={busy} className="w-full">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Checking...
              </span>
            ) : recovery ? (
              recovery.primaryLabel
            ) : (
              "Enable Notifications"
            )}
          </Button>
          <Button variant="ghost" onClick={handleDismiss} className="w-full text-muted-foreground">
            {recovery ? "Continue without notifications" : "Maybe Later"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
