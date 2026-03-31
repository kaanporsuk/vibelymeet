import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";

interface NotificationStepProps {
  userId: string;
  onNext: () => void;
}

export const NotificationStep = ({ userId, onNext }: NotificationStepProps) => {
  const [granted, setGranted] = useState(false);

  const handleEnable = async () => {
    const ok = await requestWebPushPermissionAndSync(userId);
    if (ok) {
      setGranted(true);
      setTimeout(onNext, 1000);
    } else {
      onNext();
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
          <Button
            onClick={handleEnable}
            className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
          >
            Turn on notifications
          </Button>
          <button
            onClick={onNext}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Maybe later
          </button>
        </>
      )}
    </div>
  );
};
