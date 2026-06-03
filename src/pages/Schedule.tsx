import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeSchedule } from "@/components/schedule/VibeSchedule";
import { MyDatesSection } from "@/components/schedule/MyDatesSection";
import { DateReminderCard } from "@/components/schedule/DateReminderCard";
import { ChooseSharedBlockSheet, type OfferedBlock } from "@/components/chat/ChooseSharedBlockSheet";
import { ExactTimePinSheet } from "@/components/chat/ExactTimePinSheet";
import { PushSetupButton, PushSetupFlow } from "@/components/notifications/PushSetupFlow";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useSchedule } from "@/hooks/useSchedule";
import { useDateReminders } from "@/hooks/useDateReminders";
import { useScheduleHub } from "@/hooks/useScheduleHub";
import { useSharedPartnerSchedule } from "@/hooks/useSharedPartnerSchedule";
import { DateSuggestionDomainError, dateSuggestionApply } from "@/hooks/useDateSuggestionActions";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { usePushDeliveryHealth } from "@/hooks/usePushDeliveryHealth";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/AuthContext";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";
import { supabase } from "@/integrations/supabase/client";
import type { ScheduleHubItem } from "../../shared/schedule/planningHub";
import { decideCanonicalVideoDateRoute } from "@clientShared/matching/videoDateRouteDecision";

function isScheduleShareHubItem(item: ScheduleHubItem): boolean {
  return item.timeChoiceKey === "share_schedule" || item.scheduleShareEnabled;
}

function scheduleShareAcceptErrorMessage(error: unknown): string {
  if (error instanceof DateSuggestionDomainError) {
    if (error.code === "slot_already_locked") {
      return "That time was just taken by another date.";
    }
    if (error.code === "slot_user_busy") {
      return "One of you marked that block busy. Pick another.";
    }
    if (error.code === "slot_not_in_share_grant") {
      return "That time is no longer available. Pick another.";
    }
    if (
      error.code === "exact_time_outside_block" ||
      error.code === "exact_time_required" ||
      error.code === "invalid_slot_key" ||
      error.code === "local_date_mismatch" ||
      error.code === "local_start_hour_mismatch"
    ) {
      return "Pick a time inside the chosen block.";
    }
    if (error.code === "local_timezone_required" || error.code === "invalid_local_timezone") {
      return "Could not verify your timezone. Check browser settings and try again.";
    }
    return error.message || "Could not accept this plan.";
  }
  return "Could not accept this plan.";
}

const SchedulePage = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { mySchedule, refetch: refetchUserSchedule } = useSchedule();
  const {
    pendingItems,
    upcomingItems,
    historyItems,
    reminderSources,
    isLoading: plansLoading,
    refetch: refetchScheduleHub,
  } = useScheduleHub();
  const { imminentReminders, soonReminders } = useDateReminders(reminderSources);
  const { refreshSubscriptionState } = usePushNotifications();
  const { health: pushDeliveryHealth, refresh: refreshPushDeliveryHealth } = usePushDeliveryHealth();
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);
  const [activeDateSessionId, setActiveDateSessionId] = useState<string | null>(null);
  const [scheduleShareChooserItem, setScheduleShareChooserItem] = useState<ScheduleHubItem | null>(null);
  const [scheduleSharePinItem, setScheduleSharePinItem] = useState<ScheduleHubItem | null>(null);
  const [pendingScheduleShareSlotKey, setPendingScheduleShareSlotKey] = useState<string | null>(null);
  const [scheduleShareAcceptBusy, setScheduleShareAcceptBusy] = useState(false);
  const scheduleShareAcceptInFlightRef = useRef(false);
  const scheduleShareOffer = useSharedPartnerSchedule(
    scheduleShareChooserItem?.matchId,
    scheduleShareChooserItem?.partnerUserId,
    Boolean(scheduleShareChooserItem),
  );
  const scheduleShareOfferedBlocks: OfferedBlock[] = useMemo(() => {
    const slots = scheduleShareOffer.data ?? [];
    return slots.map((slot) => ({
      slot_key: slot.slot_key,
      slot_date: slot.slot_date,
      time_block: slot.time_block,
    }));
  }, [scheduleShareOffer.data]);

  useEffect(() => {
    const checkActiveDateSession = async () => {
      if (!user?.id) {
        setActiveDateSessionId(null);
        return;
      }

      const { data: reg } = await supabase
        .from("event_registrations")
        .select("current_room_id, event_id, queue_status")
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
        .select("id, event_id, participant_1_id, participant_2_id, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, ready_gate_status, ready_gate_expires_at")
        .eq("id", reg.current_room_id)
        .maybeSingle();

      const route = decideCanonicalVideoDateRoute({
        sessionId: reg.current_room_id,
        truth: session,
        registration: {
          current_room_id: reg.current_room_id,
          queue_status: reg.queue_status,
          event_id: session?.event_id ?? reg.event_id ?? null,
        },
      });
      setActiveDateSessionId(route.target === "date" ? session?.id ?? null : null);
    };

    void checkActiveDateSession();
  }, [user?.id]);

  const handleRequestOneSignalPermission = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    const result = await requestWebPushPermissionAndSync(user.id);
    await refreshSubscriptionState();
    await refreshPushDeliveryHealth();
    if (result.synced) {
      window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
    }
    return result.synced;
  }, [user?.id, refreshPushDeliveryHealth, refreshSubscriptionState]);

  const handleAcceptProposal = useCallback(async (item: ScheduleHubItem) => {
    if (isScheduleShareHubItem(item)) {
      setScheduleShareChooserItem(item);
      setScheduleSharePinItem(null);
      setPendingScheduleShareSlotKey(null);
      return;
    }
    try {
      await dateSuggestionApply("accept", { suggestion_id: item.suggestionId });
      toast.success("Plan confirmed.");
      await refetchScheduleHub();
    } catch {
      toast.error("Could not accept this plan.");
    }
  }, [refetchScheduleHub]);

  const handleScheduleShareChooserClose = useCallback(() => {
    setScheduleShareChooserItem(null);
    setPendingScheduleShareSlotKey(null);
  }, []);

  const handleScheduleShareChooserContinue = useCallback((slotKey: string) => {
    setPendingScheduleShareSlotKey(slotKey);
    setScheduleSharePinItem(scheduleShareChooserItem);
    setScheduleShareChooserItem(null);
  }, [scheduleShareChooserItem]);

  const handleScheduleSharePinClose = useCallback(() => {
    if (scheduleShareAcceptInFlightRef.current) return;
    setScheduleSharePinItem(null);
    setPendingScheduleShareSlotKey(null);
  }, []);

  const handleScheduleShareExactTimeConfirm = useCallback(async (
    startsAtIso: string,
    localStartHour: number,
  ) => {
    if (
      scheduleShareAcceptBusy ||
      scheduleShareAcceptInFlightRef.current ||
      !scheduleSharePinItem ||
      !pendingScheduleShareSlotKey
    ) {
      return;
    }
    scheduleShareAcceptInFlightRef.current = true;
    const localTimezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })();
    if (!localTimezone) {
      toast.error("Could not read your timezone. Check browser settings and try again.");
      scheduleShareAcceptInFlightRef.current = false;
      return;
    }
    setScheduleShareAcceptBusy(true);
    try {
      await dateSuggestionApply("accept", {
        suggestion_id: scheduleSharePinItem.suggestionId,
        chosen_slot_key: pendingScheduleShareSlotKey,
        starts_at: startsAtIso,
        local_timezone: localTimezone,
        local_start_hour: localStartHour,
      });
      toast.success("Plan confirmed.");
      setScheduleSharePinItem(null);
      setPendingScheduleShareSlotKey(null);
      await Promise.all([refetchScheduleHub(), refetchUserSchedule()]);
    } catch (error) {
      toast.error(scheduleShareAcceptErrorMessage(error));
    } finally {
      scheduleShareAcceptInFlightRef.current = false;
      setScheduleShareAcceptBusy(false);
    }
  }, [
    pendingScheduleShareSlotKey,
    refetchScheduleHub,
    refetchUserSchedule,
    scheduleShareAcceptBusy,
    scheduleSharePinItem,
  ]);

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
      {/* Push setup flow */}
      <PushSetupFlow
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
        <PushSetupButton
          isGranted={pushDeliveryHealth.backendDeliverable}
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
                notificationsEnabled={pushDeliveryHealth.backendDeliverable}
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

      <ChooseSharedBlockSheet
        isOpen={Boolean(scheduleShareChooserItem)}
        onClose={handleScheduleShareChooserClose}
        offeredBlocks={scheduleShareOfferedBlocks}
        isLoading={scheduleShareOffer.isLoading}
        isError={scheduleShareOffer.isError}
        partnerName={scheduleShareChooserItem?.partnerName ?? "your match"}
        onContinue={handleScheduleShareChooserContinue}
      />
      <ExactTimePinSheet
        isOpen={Boolean(scheduleSharePinItem && pendingScheduleShareSlotKey)}
        onClose={handleScheduleSharePinClose}
        chosenSlotKey={pendingScheduleShareSlotKey ?? ""}
        isSubmitting={scheduleShareAcceptBusy}
        onConfirm={handleScheduleShareExactTimeConfirm}
      />
      <BottomNav />
    </div>
  );
};

export default SchedulePage;
