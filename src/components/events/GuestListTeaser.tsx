import { motion } from "framer-motion";
import { Lock, Users, Sparkles } from "lucide-react";

interface GuestListTeaserProps {
  /** Waitlisted or not admitted — no identifiable faces */
  viewerAdmission: "waitlisted" | "none";
  /** Confirmed others (excluding viewer), from server */
  totalOtherConfirmed: number;
}

/**
 * Aggregate-only teaser: no real avatars or names until confirmed admission.
 */
const GuestListTeaser = ({ viewerAdmission, totalOtherConfirmed }: GuestListTeaserProps) => {
  const subtitle =
    viewerAdmission === "waitlisted"
      ? "Confirm your spot to see who you're most aligned with."
      : "Get tickets to unlock personalized previews of who's going.";

  const countLabel = totalOtherConfirmed === 1 ? "1 person is going" : `${totalOtherConfirmed} people are going`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Who's Going</h3>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{countLabel}</span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-4 pb-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.06 }}
              className="flex-shrink-0"
            >
              <div className="relative glass-card rounded-2xl p-3 w-[100px] backdrop-blur-md border border-border/50 h-[140px] flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border border-border/40 flex items-center justify-center mb-2">
                  <Lock className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="h-2 w-12 rounded-full bg-muted/80 mb-1" />
                <div className="h-2 w-16 rounded-full bg-muted/60" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="glass-card p-4 rounded-2xl border border-primary/20"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{countLabel}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GuestListTeaser;
