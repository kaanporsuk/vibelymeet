import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Video, MapPin, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TimeBlock, getTimeBlockInfo, DateProposal } from "@/hooks/useSchedule";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DateProposalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  slot: {
    date: Date;
    block: TimeBlock;
    type: "golden" | "available";
  } | null;
  matchName: string;
  onSend: (proposal: DateProposal) => void;
}

export const DateProposalSheet = ({
  isOpen,
  onClose,
  slot,
  matchName,
  onSend,
}: DateProposalSheetProps) => {
  const [mode, setMode] = useState<"video" | "in-person">("video");
  const [message, setMessage] = useState("");
  const maxChars = 140;

  if (!slot) return null;

  const blockInfo = getTimeBlockInfo(slot.block);

  const handleSend = () => {
    if (message.length > maxChars) return;

    const proposal: DateProposal = {
      id: `proposal-${Date.now()}`,
      date: slot.date,
      block: slot.block,
      mode,
      message: message.trim() || "Let's vibe! 💜",
      status: "pending",
      sentAt: new Date(),
    };

    toast.success(`Date proposal sent to ${matchName}!`);
    onSend(proposal);
    setMessage("");
    setMode("video");
  };

  const formatDateDisplay = () => {
    const dayName = format(slot.date, "EEEE");
    return `${dayName} ${blockInfo.label}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-md bg-card rounded-t-3xl sm:rounded-3xl border border-border/50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-border/50">
              <div className="flex items-center gap-3 mb-4">
                {slot.type === "golden" && (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-background" />
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-display font-bold text-foreground">
                    Propose a Date
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {formatDateDisplay()} ({blockInfo.hours})
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Mode Toggle */}
              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  Date Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setMode("video")}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2",
                      mode === "video"
                        ? "border-neon-cyan bg-neon-cyan/10 neon-glow-cyan"
                        : "border-border/50 hover:border-border bg-muted/30"
                    )}
                  >
                    <Video
                      className={cn(
                        "w-6 h-6",
                        mode === "video" ? "text-neon-cyan" : "text-muted-foreground"
                      )}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        mode === "video" ? "text-neon-cyan" : "text-foreground"
                      )}
                    >
                      Video Date
                    </span>
                  </button>
                  <button
                    onClick={() => setMode("in-person")}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2",
                      mode === "in-person"
                        ? "border-accent bg-accent/10 neon-glow-pink"
                        : "border-border/50 hover:border-border bg-muted/30"
                    )}
                  >
                    <MapPin
                      className={cn(
                        "w-6 h-6",
                        mode === "in-person" ? "text-accent" : "text-muted-foreground"
                      )}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        mode === "in-person" ? "text-accent" : "text-foreground"
                      )}
                    >
                      In-Person
                    </span>
                  </button>
                </div>
              </div>

              {/* Message */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">
                    Add a Note
                  </label>
                  <span
                    className={cn(
                      "text-xs",
                      message.length > maxChars ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {message.length}/{maxChars}
                  </span>
                </div>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="I know a great spot for jazz..."
                  className="min-h-[100px] bg-muted/30 border-border/50 resize-none focus:border-primary"
                  maxLength={maxChars + 10}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-border/50">
              <Button
                onClick={handleSend}
                disabled={message.length > maxChars}
                className="w-full gap-2 bg-gradient-primary hover:opacity-90 text-primary-foreground"
              >
                <Send className="w-4 h-4" />
                Send Proposal
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
