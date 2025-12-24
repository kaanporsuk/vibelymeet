import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Video, MapPin, Clock, Sparkles, Check, X, Loader2 } from "lucide-react";
import { DateProposal, getTimeBlockInfo } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DateProposalTicketProps {
  proposal: DateProposal;
  isOwn: boolean;
  matchName?: string;
  onAccept?: (proposalId: string) => void;
  onDecline?: (proposalId: string) => void;
}

export const DateProposalTicket = ({
  proposal,
  isOwn,
  matchName = "them",
  onAccept,
  onDecline,
}: DateProposalTicketProps) => {
  const [showConfirm, setShowConfirm] = useState<'accept' | 'decline' | null>(null);
  const blockInfo = getTimeBlockInfo(proposal.block);
  
  const statusConfig = {
    pending: {
      icon: Loader2,
      label: isOwn ? "Awaiting Confirmation" : "Respond to this date",
      className: "text-muted-foreground animate-spin",
      bgClass: "bg-muted/20",
    },
    accepted: {
      icon: Check,
      label: "Date Confirmed!",
      className: "text-emerald-400",
      bgClass: "bg-emerald-500/20",
    },
    declined: {
      icon: X,
      label: "Declined",
      className: "text-destructive",
      bgClass: "bg-destructive/20",
    },
  };

  const status = statusConfig[proposal.status];
  const StatusIcon = status.icon;

  const handleAccept = () => {
    onAccept?.(proposal.id);
    setShowConfirm(null);
  };

  const handleDecline = () => {
    onDecline?.(proposal.id);
    setShowConfirm(null);
  };

  return (
    <>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "relative w-full max-w-[280px] overflow-hidden",
          isOwn ? "ml-auto" : "mr-auto"
        )}
      >
        {/* Ticket stub with perforated edge */}
        <div className="relative">
          {/* Main ticket body */}
          <div className={cn(
            "rounded-2xl border-2 overflow-hidden",
            proposal.mode === "video" 
              ? "border-neon-cyan/50 bg-gradient-to-br from-neon-cyan/10 to-primary/10"
              : "border-accent/50 bg-gradient-to-br from-accent/10 to-primary/10"
          )}>
            {/* Header */}
            <div className={cn(
              "p-4 border-b border-dashed",
              proposal.mode === "video" ? "border-neon-cyan/30" : "border-accent/30"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {proposal.mode === "video" ? (
                    <Video className="w-5 h-5 text-neon-cyan" />
                  ) : (
                    <MapPin className="w-5 h-5 text-accent" />
                  )}
                  <span className={cn(
                    "font-display font-semibold",
                    proposal.mode === "video" ? "text-neon-cyan" : "text-accent"
                  )}>
                    {proposal.mode === "video" ? "Video Date" : "In-Person Date"}
                  </span>
                </div>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              {/* Date & Time */}
              <div className="flex items-center gap-2 text-foreground">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {format(proposal.date, "EEEE, MMM d")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {blockInfo.label} • {blockInfo.hours}
                  </p>
                </div>
              </div>

              {/* Message */}
              {proposal.message && (
                <div className="p-3 rounded-lg bg-background/50 border border-border/30">
                  <p className="text-sm text-foreground italic">
                    "{proposal.message}"
                  </p>
                </div>
              )}

              {/* Status */}
              {proposal.status !== "pending" || isOwn ? (
                <div className={cn(
                  "flex items-center gap-2 p-2 rounded-lg",
                  status.bgClass
                )}>
                  <StatusIcon className={cn("w-4 h-4", status.className)} />
                  <span className="text-xs font-medium text-muted-foreground">
                    {status.label}
                  </span>
                </div>
              ) : (
                /* Accept/Decline buttons for incoming proposals */
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20"
                    onClick={() => setShowConfirm('accept')}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-destructive/50 text-destructive hover:bg-destructive/20"
                    onClick={() => setShowConfirm('decline')}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Decline
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Perforated circles on the sides */}
          <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background" />
          <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background" />
        </div>
      </motion.div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm !== null} onOpenChange={() => setShowConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {showConfirm === 'accept' ? 'Accept Date?' : 'Decline Date?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {showConfirm === 'accept' 
                ? `You're about to accept this ${proposal.mode} date on ${format(proposal.date, "EEEE, MMM d")}. ${matchName} will be notified!`
                : `Are you sure you want to decline this date? ${matchName} will be notified.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={showConfirm === 'accept' ? handleAccept : handleDecline}
              className={showConfirm === 'accept' 
                ? "bg-emerald-500 hover:bg-emerald-600" 
                : "bg-destructive hover:bg-destructive/90"
              }
            >
              {showConfirm === 'accept' ? 'Accept' : 'Decline'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
