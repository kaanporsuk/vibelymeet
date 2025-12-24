import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeSchedule } from "@/components/schedule/VibeSchedule";
import { MyDatesSection } from "@/components/schedule/MyDatesSection";
import { BottomNav } from "@/components/BottomNav";
import { useSchedule } from "@/hooks/useSchedule";
import { useNotifications } from "@/contexts/NotificationContext";
import { format } from "date-fns";
import { toast } from "sonner";

const SchedulePage = () => {
  const navigate = useNavigate();
  const { proposals, respondToProposal, getTimeBlockInfo } = useSchedule();
  const { addNotification } = useNotifications();

  const handleAcceptProposal = (proposalId: string) => {
    const proposal = proposals.find(p => p.id === proposalId);
    respondToProposal(proposalId, true);
    toast.success("Date accepted!");
    
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

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-4 px-4 py-3 border-b border-border/50">
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
      </header>

      {/* Schedule Content */}
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-y-auto"
      >
        <VibeSchedule />
        
        {/* My Dates Section */}
        <MyDatesSection
          proposals={proposals}
          onAccept={handleAcceptProposal}
          onDecline={handleDeclineProposal}
        />
      </motion.main>

      <BottomNav />
    </div>
  );
};

export default SchedulePage;
