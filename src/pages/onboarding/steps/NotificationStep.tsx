import { useState } from "react";
import { AlertCircle, Bell, Check, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";

interface NotificationStepProps {
  userId: string;
  onNext: () => void;
}

export const NotificationStep = ({ userId, onNext }: NotificationStepProps) => {
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{ title: string; message: string; blocked: boolean } | null>(null);

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    setRecovery(null);
    try {
      const result = await requestWebPushPermissionAndSync(userId);
      if (result.synced) {
        setGranted(true);
        setTimeout(onNext, 1000);
        return;
      }

      const unsupported = typeof Notification === "undefined";
      const blocked = !unsupported && Notification.permission === "denied";
      setRecovery({
        title: unsupported
          ? "Notifications are not available here"
          : blocked
            ? "Notifications are blocked"
            : "Notifications are still off",
        message: unsupported
          ? "You can still use Vibely normally. In-app alerts will appear while you are here."
          : blocked
            ? "Use your browser site settings to allow notifications for Vibely, then come back and try again."
            : "We could not finish notification setup. Try again, or continue without push alerts.",
        blocked,
      });
    } catch {
      setRecovery({
        title: "Notification setup failed",
        message: "Check your connection and try again, or continue without push alerts.",
        blocked: false,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pt-12 items-center text-center">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Don't miss a vibe
        </h1>
        <p className="text-muted-foreground mt-2">
          Matches, events, and date reminders.
        </p>
      </div>

      {/* Mock notification */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full glass-card p-4 rounded-2xl flex items-start gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Bell className="w-5 h-5 text-primary" />
        </div>
        <div className="text-left">
          <p className="text-sm font-medium text-foreground">Vibely</p>
          <p className="text-sm text-muted-foreground">
            🎉 You matched with Alex at Friday Night Social!
          </p>
        </div>
      </motion.div>

      {granted ? (
        <div className="flex items-center gap-2 text-green-400">
          <Check className="w-5 h-5" />
          <span className="font-medium">Notifications enabled!</span>
        </div>
      ) : (
        <>
          {recovery ? (
            <div className="w-full rounded-lg border border-amber-400/25 bg-amber-400/10 p-4 text-left">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{recovery.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{recovery.message}</p>
                </div>
              </div>
            </div>
          ) : null}
          <Button
            onClick={handleEnable}
            disabled={busy}
            className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking...
              </span>
            ) : recovery?.blocked ? (
              "I updated settings"
            ) : recovery ? (
              "Try again"
            ) : (
              "Turn on notifications"
            )}
          </Button>
          <button
            onClick={onNext}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {recovery ? "Continue without notifications" : "Maybe later"}
          </button>
        </>
      )}
    </div>
  );
};
