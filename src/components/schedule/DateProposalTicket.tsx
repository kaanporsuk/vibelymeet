import { motion } from "framer-motion";
import { format } from "date-fns";
import { Video, MapPin, Clock, Sparkles, Check, X, Loader2 } from "lucide-react";
import { DateProposal, getTimeBlockInfo } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";

interface DateProposalTicketProps {
  proposal: DateProposal;
  isOwn: boolean;
  matchName?: string;
}

export const DateProposalTicket = ({
  proposal,
  isOwn,
  matchName = "them",
}: DateProposalTicketProps) => {
  const blockInfo = getTimeBlockInfo(proposal.block);
  
  const statusConfig = {
    pending: {
      icon: Loader2,
      label: "Awaiting Confirmation",
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

  return (
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
            <div className={cn(
              "flex items-center gap-2 p-2 rounded-lg",
              status.bgClass
            )}>
              <StatusIcon className={cn("w-4 h-4", status.className)} />
              <span className="text-xs font-medium text-muted-foreground">
                {status.label}
              </span>
            </div>
          </div>
        </div>

        {/* Perforated circles on the sides */}
        <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background" />
        <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background" />
      </div>
    </motion.div>
  );
};
