import { useState, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeSchedule } from "@/components/schedule/VibeSchedule";
import { MyDatesSection } from "@/components/schedule/MyDatesSection";
import { DateReminderCard } from "@/components/schedule/DateReminderCard";
import { NotificationPermissionFlow, NotificationPermissionButton } from "@/components/notifications/NotificationPermissionFlow";
import { BottomNav } from "@/components/BottomNav";
import { useSchedule } from "@/hooks/useSchedule";
import { useDateReminders } from "@/hooks/useDateReminders";
import { useScheduleHub } from "@/hooks/useScheduleHub";
import { dateSuggestionApply } from "@/hooks/useDateSuggestionActions";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/AuthContext";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { supabase } from "@/integrations/supabase/client";
import type { ScheduleHubItem } from "../../shared/schedule/planningHub";

const SchedulePage = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { mySchedule } = useSchedule();
  const {
    pendingItems,
    upcomingItems,
    historyItems,
    reminderSources,
    isLoading: plansLoading,
    refetch: refetchScheduleHub,
  } = useScheduleHub();
  const { imminentReminders, soonReminders } = useDateReminders(reminderSources);
  const { isGranted, refreshSubscriptionState } = usePushNotifications();
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);
  const [activeDateSessionId, setActiveDateSessionId] = useState<string | null>(null);

  useEffect(() => {
    const checkActiveDateSession = async () => {
      if (!user?.id) {
        setActiveDateSessionId(null);
        return;
      }

      const { data: reg } = await supabase
        .from("event_registrations")
        .select("current_room_id, queue_status")
        .eq("profile_id", user.id)
        .in("queue_status", ["in_handshake", "in_date"])
        .not("current_room_id", "is", null)
        .maybeSingle();

      if (!reg?.current_room_id) {
        setActiveDateSessionId(null);
        return;
      }

      const { data: session } = await supabase
        .from("video_sessions")
        .select("id, ended_at")
        .eq("id", reg.current_room_id)
        .is("ended_at", null)
        .maybeSingle();

      setActiveDateSessionId(session?.id ?? null);
    };

    void checkActiveDateSession();
  }, [user?.id]);

  const handleRequestOneSignalPermission = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    const ok = await requestWebPushPermissionAndSync(user.id);
    await refreshSubscriptionState();
    if (ok) {
      window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
    }
    return ok;
  }, [user?.id, refreshSubscriptionState]);

  const handleAcceptProposal = useCallback(async (item: ScheduleHubItem) => {
    try {
      await dateSuggestionApply("accept", { suggestion_id: item.suggestionId });
      toast.success("Plan confirmed.");
      await refetchScheduleHub();
    } catch {
      toast.error("Could not accept this plan.");
    }
  }, [refetchScheduleHub]);

  const handleDeclineProposal = useCallback(async (item: ScheduleHubItem) => {
    try {
      await dateSuggestionApply("decline", { suggestion_id: item.suggestionId });
      toast.info("Plan declined.");
      await refetchScheduleHub();
    } catch {
      toast.error("Could not decline this plan.");
    }
  }, [refetchScheduleHub]);

  const handleCancelProposal = useCallback(async (item: ScheduleHubItem) => {
    try {
      await dateSuggestionApply("cancel", { suggestion_id: item.suggestionId });
      toast.success("Proposal cancelled.");
      await refetchScheduleHub();
    } catch {
      toast.error("Could not cancel this proposal.");
    }
  }, [refetchScheduleHub]);

  const upcomingReminders = [...imminentReminders, ...soonReminders];
  const availabilityCount = useMemo(
    () => Object.values(mySchedule).filter((slot) => slot.status === "open").length,
    [mySchedule],
  );

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col pb-[100px]">
      {/* Notification Permission Flow */}
      <NotificationPermissionFlow
        open={showNotificationFlow}
        onOpenChange={setShowNotificationFlow}
        onRequestPermission={handleRequestOneSignalPermission}
      />

      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-display font-semibold text-foreground">
            My Schedule
          </h1>
        </div>
        <NotificationPermissionButton
          isGranted={isGranted}
          onClick={() => setShowNotificationFlow(true)}
        />
      </header>

      {/* Schedule Content - Scrollable */}
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-y-auto"
      >
        <div className="p-4 pb-0">
          <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Calendar className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Availability</p>
                {availabilityCount > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    You have {availabilityCount} open {availabilityCount === 1 ? "slot" : "slots"} ready for date planning.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No availability set yet. Mark a few open blocks below so matches can build real plans from your schedule.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming Date Reminders */}
        {upcomingReminders.length > 0 && (
          <div className="p-4 space-y-3 bg-gradient-to-b from-primary/5 to-transparent">
            <h3 className="text-sm font-medium text-muted-foreground">
              Upcoming Dates
            </h3>
            {upcomingReminders.map(reminder => (
              <DateReminderCard
                key={reminder.id}
                reminder={reminder}
                onJoinDate={() => {
                  if (activeDateSessionId) {
                    navigate(`/date/${activeDateSessionId}`);
                    return;
                  }
                  if (reminder.partnerUserId) {
                    navigate(`/chat/${reminder.partnerUserId}`);
                    return;
                  }
                  navigate("/schedule");
                }}
                onEnableNotifications={() => setShowNotificationFlow(true)}
                notificationsEnabled={isGranted}
              />
            ))}
          </div>
        )}

        <VibeSchedule />
        
        {/* My Dates Section */}
        <div className="pb-4">
          <MyDatesSection
            pendingItems={pendingItems}
            upcomingItems={upcomingItems}
            historyItems={historyItems}
            isLoading={plansLoading}
            onAccept={(item) => void handleAcceptProposal(item)}
            onDecline={(item) => void handleDeclineProposal(item)}
            onCancel={(item) => void handleCancelProposal(item)}
            onOpenChat={(item) => navigate(`/chat/${item.partnerUserId}`)}
          />
        </div>
      </motion.main>

      <BottomNav />
    </div>
  );
};

export default SchedulePage;
