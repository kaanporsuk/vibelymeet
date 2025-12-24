import { motion, AnimatePresence } from "framer-motion";
import { format, isAfter, isBefore, startOfDay } from "date-fns";
import { Calendar, Clock, Video, MapPin, Check, X, Loader2 } from "lucide-react";
import { DateProposal, getTimeBlockInfo } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MyDatesSectionProps {
  proposals: DateProposal[];
  onAccept?: (proposalId: string) => void;
  onDecline?: (proposalId: string) => void;
}

export const MyDatesSection = ({ proposals, onAccept, onDecline }: MyDatesSectionProps) => {
  const today = startOfDay(new Date());

  const pendingProposals = proposals.filter(p => p.status === "pending");
  const acceptedProposals = proposals.filter(p => p.status === "accepted" && isAfter(p.date, today));
  const pastProposals = proposals.filter(p => 
    p.status === "accepted" && isBefore(p.date, today) || 
    p.status === "declined"
  );

  const renderProposalCard = (proposal: DateProposal, showActions: boolean = false) => {
    const blockInfo = getTimeBlockInfo(proposal.block);
    const isPast = isBefore(proposal.date, today);

    return (
      <motion.div
        key={proposal.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "p-4 rounded-xl border",
          proposal.status === "accepted" && !isPast && "bg-emerald-500/10 border-emerald-500/30",
          proposal.status === "pending" && "bg-primary/10 border-primary/30",
          proposal.status === "declined" && "bg-destructive/10 border-destructive/30",
          isPast && "opacity-60"
        )}
      >
        <div className="flex items-start gap-3">
          {/* Mode Icon */}
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
            proposal.mode === "video" ? "bg-neon-cyan/20" : "bg-accent/20"
          )}>
            {proposal.mode === "video" ? (
              <Video className="w-5 h-5 text-neon-cyan" />
            ) : (
              <MapPin className="w-5 h-5 text-accent" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              {format(proposal.date, "EEEE, MMM d")}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Clock className="w-3 h-3" />
              {blockInfo.label} • {blockInfo.hours}
            </div>
            
            {proposal.message && (
              <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2">
                "{proposal.message}"
              </p>
            )}

            {proposal.senderName && (
              <p className="text-xs text-muted-foreground mt-1">
                {proposal.isIncoming ? `From ${proposal.senderName}` : `To ${proposal.senderName}`}
              </p>
            )}
          </div>

          {/* Status / Actions */}
          <div className="shrink-0">
            {showActions && proposal.isIncoming && proposal.status === "pending" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => onAccept?.(proposal.id)}
                  className="p-2 rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDecline?.(proposal.id)}
                  className="p-2 rounded-full bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className={cn(
                "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1",
                proposal.status === "pending" && "bg-muted text-muted-foreground",
                proposal.status === "accepted" && "bg-emerald-500/20 text-emerald-400",
                proposal.status === "declined" && "bg-destructive/20 text-destructive"
              )}>
                {proposal.status === "pending" && <Loader2 className="w-3 h-3 animate-spin" />}
                {proposal.status === "accepted" && <Check className="w-3 h-3" />}
                {proposal.status === "declined" && <X className="w-3 h-3" />}
                {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  const EmptyState = ({ message }: { message: string }) => (
    <div className="py-8 text-center text-muted-foreground text-sm">
      <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
      {message}
    </div>
  );

  return (
    <div className="border-t border-border/50 bg-background/50">
      <div className="p-4">
        <h3 className="text-lg font-display font-semibold text-foreground flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-primary" />
          My Dates
        </h3>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="pending" className="text-xs">
              Pending ({pendingProposals.length})
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs">
              Upcoming ({acceptedProposals.length})
            </TabsTrigger>
            <TabsTrigger value="past" className="text-xs">
              Past ({pastProposals.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-3">
            {pendingProposals.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {pendingProposals.map(p => renderProposalCard(p, true))}
              </AnimatePresence>
            ) : (
              <EmptyState message="No pending date proposals" />
            )}
          </TabsContent>

          <TabsContent value="upcoming" className="space-y-3">
            {acceptedProposals.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {acceptedProposals.map(p => renderProposalCard(p))}
              </AnimatePresence>
            ) : (
              <EmptyState message="No upcoming dates" />
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-3">
            {pastProposals.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {pastProposals.map(p => renderProposalCard(p))}
              </AnimatePresence>
            ) : (
              <EmptyState message="No past dates" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
