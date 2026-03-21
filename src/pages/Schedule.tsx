import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeSchedule } from "@/components/schedule/VibeSchedule";
import { MyDatesSection } from "@/components/schedule/MyDatesSection";
import { DateReminderCard } from "@/components/schedule/DateReminderCard";
import { NotificationPermissionFlow, NotificationPermissionButton } from "@/components/notifications/NotificationPermissionFlow";
import { BottomNav } from "@/components/BottomNav";
import { useSchedule } from "@/hooks/useSchedule";
import { useDateReminders } from "@/hooks/useDateReminders";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useNotifications } from "@/contexts/NotificationContext";
import { format } from "date-fns";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/AuthContext";
import { requestWebPushPermissionAndSync } from "@/lib/requestWebPushPermission";

const SchedulePage = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { proposals, respondToProposal, getTimeBlockInfo, mySchedule, toggleSlot } = useSchedule();
  const { addNotification } = useNotifications();
  const { reminders, imminentReminders, soonReminders } = useDateReminders(proposals);
  const { isGranted, refreshSubscriptionState } = usePushNotifications();
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);
  const [, forceUpdate] = useState({});

  const handleRequestOneSignalPermission = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    const ok = await requestWebPushPermissionAndSync(user.id);
    await refreshSubscriptionState();
    if (ok) {
      window.dispatchEvent(new Event("vibely-onesignal-subscription-changed"));
    }
    return ok;
  }, [user?.id, refreshSubscriptionState]);

  const handleAcceptProposal = (proposalId: string) => {
    const proposal = proposals.find(p => p.id === proposalId);
    respondToProposal(proposalId, true);
    
    // Add the accepted date to the schedule
    if (proposal) {
      toggleSlot(proposal.date, proposal.block);
    }
    
    // Force re-render to update VibeSchedule
    forceUpdate({});
    
    toast.success("Date accepted and added to your schedule!");
    
    // Send notification to proposer (mock)
    if (proposal?.senderName) {
      addNotification({
        type: "date_proposal",
        proposalId,
        matchName: proposal.senderName,
        matchAvatar: proposal.senderAvatar || "",
        action: "accepted",
        dateInfo: `${format(proposal.date, "MMM d")} • ${getTimeBlockInfo(proposal.block).label}`,
        mode: proposal.mode,
      });
    }
  };

  const handleDeclineProposal = (proposalId: string) => {
    const proposal = proposals.find(p => p.id === proposalId);
    respondToProposal(proposalId, false);
    toast.info("Date declined");
    
    if (proposal?.senderName) {
      addNotification({
        type: "date_proposal",
        proposalId,
        matchName: proposal.senderName,
        matchAvatar: proposal.senderAvatar || "",
        action: "declined",
        dateInfo: `${format(proposal.date, "MMM d")} • ${getTimeBlockInfo(proposal.block).label}`,
        mode: proposal.mode,
      });
    }
  };

  const upcomingReminders = [...imminentReminders, ...soonReminders];

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
                onJoinDate={() => navigate('/video-date')}
                onEnableNotifications={() => setShowNotificationFlow(true)}
                notificationsEnabled={isGranted}
              />
            ))}
          </div>
        )}

        <VibeSchedule key={Object.keys(mySchedule).length} />
        
        {/* My Dates Section */}
        <div className="pb-4">
          <MyDatesSection
            proposals={proposals}
            onAccept={handleAcceptProposal}
            onDecline={handleDeclineProposal}
          />
        </div>
      </motion.main>

      <BottomNav />
    </div>
  );
};

export default SchedulePage;
