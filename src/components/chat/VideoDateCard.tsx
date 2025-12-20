import { motion } from "framer-motion";
import { Video, Calendar, ChevronRight } from "lucide-react";

interface VideoDateCardProps {
  senderName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export const VideoDateCard = ({ senderName, onAccept, onDecline }: VideoDateCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="max-w-[85%] w-full"
    >
      <div className="glass-card rounded-2xl overflow-hidden border border-primary/30">
        {/* Header */}
        <div className="bg-gradient-primary p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center">
              <Video className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h4 className="font-display font-semibold text-primary-foreground">
                Video Date Invite
              </h4>
              <p className="text-sm text-primary-foreground/80">
                {senderName} wants to video chat
              </p>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            <span>Suggested: Today, whenever you're free</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onDecline}
              className="flex-1 py-2.5 rounded-xl bg-secondary text-foreground font-medium text-sm hover:bg-secondary/80 transition-colors"
            >
              Maybe later
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onAccept}
              className="flex-1 py-2.5 rounded-xl bg-gradient-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-1"
            >
              Accept
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
