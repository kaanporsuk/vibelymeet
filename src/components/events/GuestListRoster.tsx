import { motion } from "framer-motion";
import { Users, Sparkles, Crown, Ticket, Lock } from "lucide-react";

export interface GuestListRosterAttendee {
  id: string;
  name: string;
  age: number;
  avatar: string;
  vibeTag: string;
  matchPercent: number;
  sharedVibeCount: number;
  superVibeTowardViewer: boolean;
}

interface GuestListRosterProps {
  revealed: GuestListRosterAttendee[];
  obscuredRemaining: number;
  /** Count matching attendee visibility rules (excludes viewer) */
  visibleCohortCount: number;
  /** Visible others on event (excludes hidden and unauthorized matches_only attendees) */
  visibleOtherCount: number;
  onAttendeeClick: (attendee: GuestListRosterAttendee) => void;
  onTicketClick: () => void;
}

function ObscuredCard({ index }: { index: number }) {
  return (
    <motion.div
      key={`obscured-${index}`}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.12 + index * 0.06 }}
      className="shrink-0"
    >
      <div className="relative glass-card rounded-2xl p-3 w-[110px] border border-border/50">
        <div className="relative w-16 h-16 mx-auto mb-2 rounded-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-accent/30" />
          <div className="absolute inset-0 backdrop-blur-xl scale-110 opacity-90" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
        </div>
        <div className="h-3 w-14 mx-auto rounded-full bg-muted/70 mb-1" />
        <div className="h-2 w-10 mx-auto rounded-full bg-muted/50" />
      </div>
    </motion.div>
  );
}

const GuestListRoster = ({
  revealed,
  obscuredRemaining,
  visibleCohortCount,
  visibleOtherCount,
  onAttendeeClick,
  onTicketClick,
}: GuestListRosterProps) => {
  const obscuredSlots = Math.min(obscuredRemaining, 12);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Who's Going</h3>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="px-2 py-0.5 rounded-full bg-primary/20 border border-primary/30"
          >
            <span className="text-xs font-medium text-primary">Your top picks</span>
          </motion.div>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onTicketClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-xs font-medium"
        >
          <Ticket className="w-3 h-3" />
          My Spot
        </motion.button>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 scrollbar-hide">
        <div className="flex gap-4 pb-2" style={{ minWidth: "max-content" }}>
          {revealed.map((attendee, index) => (
            <motion.button
              key={attendee.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.08 }}
              whileHover={{ scale: 1.05, y: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onAttendeeClick(attendee)}
              className="shrink-0"
            >
              <div className="relative glass-card rounded-2xl p-3 w-[110px] border border-border/50 hover:border-primary/50 transition-colors">
                {attendee.matchPercent >= 80 && (
                  <motion.div
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: index * 0.08 + 0.2 }}
                    className="absolute -top-2 -right-2 z-10"
                  >
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-[10px] font-bold text-primary-foreground shadow-lg">
                      <Sparkles className="w-3 h-3" />
                      {attendee.matchPercent}%
                    </div>
                  </motion.div>
                )}

                <div className="relative mx-auto mb-2">
                  <div className="w-16 h-16 rounded-full overflow-hidden">
                    {attendee.avatar ? (
                      <img
                        src={attendee.avatar}
                        alt={attendee.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <div
                      className={`${attendee.avatar ? "hidden" : ""} w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center`}
                    >
                      <span className="text-xl font-bold text-foreground/50">{attendee.name.charAt(0).toUpperCase()}</span>
                    </div>
                  </div>
                  {attendee.superVibeTowardViewer && (
                    <motion.div
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -bottom-1 -right-1 z-10"
                    >
                      <Crown className="w-5 h-5 text-yellow-400 drop-shadow-lg" />
                    </motion.div>
                  )}
                </div>

                <div className="text-center mb-1">
                  <p className="text-sm font-semibold text-foreground truncate">{attendee.name.split(" ")[0]}</p>
                  <p className="text-xs text-muted-foreground">{attendee.age}</p>
                </div>

                <div className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-center truncate">
                  {attendee.sharedVibeCount > 0 ? `${attendee.sharedVibeCount} shared` : attendee.vibeTag}
                </div>
              </div>
            </motion.button>
          ))}

          {Array.from({ length: obscuredSlots }, (_, i) => (
            <ObscuredCard key={`o-${i}`} index={i} />
          ))}
        </div>
      </div>

      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-white" />
            </div>
	            <div className="min-w-0">
	              <p className="text-sm font-medium text-foreground">{visibleCohortCount} visible to you</p>
	              <p className="text-xs text-muted-foreground truncate">
	                {visibleOtherCount} in attendee lists · {obscuredRemaining > 0 ? `${obscuredRemaining} more visible after preview` : "Live lobby matching is separate"}
	              </p>
	            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {revealed.length}
            </p>
            <p className="text-[10px] text-muted-foreground">Previewed</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default GuestListRoster;
