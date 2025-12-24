import { motion } from "framer-motion";
import { Users, Sparkles, Crown, Ticket } from "lucide-react";

interface Attendee {
  id: string;
  name: string;
  age: number;
  avatar: string;
  vibeTag: string;
  matchPercent: number;
  bio: string;
  photos: string[];
}

interface GuestListRosterProps {
  attendees: Attendee[];
  totalCount: number;
  onAttendeeClick: (attendee: Attendee) => void;
  onTicketClick: () => void;
}

const GuestListRoster = ({
  attendees,
  totalCount,
  onAttendeeClick,
  onTicketClick,
}: GuestListRosterProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header with Ticket Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Guest List</h3>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="px-2 py-0.5 rounded-full bg-primary/20 border border-primary/30"
          >
            <span className="text-xs font-medium text-primary">VIP Access</span>
          </motion.div>
        </div>
        
        {/* My Spot Badge */}
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

      {/* Roster Grid */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-4 pb-2">
          {attendees.map((attendee, index) => (
            <motion.button
              key={attendee.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.08 }}
              whileHover={{ scale: 1.05, y: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onAttendeeClick(attendee)}
              className="flex-shrink-0"
            >
              <div className="relative glass-card rounded-2xl p-3 w-[110px] border border-border/50 hover:border-primary/50 transition-colors">
                {/* Match Badge */}
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

                {/* Avatar */}
                <div className="relative w-16 h-16 mx-auto mb-2">
                  <img
                    src={attendee.avatar}
                    alt={attendee.name}
                    className="w-full h-full object-cover rounded-full ring-2 ring-border"
                  />
                  {attendee.matchPercent >= 90 && (
                    <motion.div
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -bottom-1 -right-1"
                    >
                      <Crown className="w-5 h-5 text-yellow-400 drop-shadow-lg" />
                    </motion.div>
                  )}
                </div>

                {/* Name & Age */}
                <div className="text-center mb-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {attendee.name.split(" ")[0]}
                  </p>
                  <p className="text-xs text-muted-foreground">{attendee.age}</p>
                </div>

                {/* Vibe Tag */}
                <div className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-center truncate">
                  {attendee.vibeTag}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {totalCount} confirmed guests
              </p>
              <p className="text-xs text-muted-foreground">
                {attendees.filter((a) => a.matchPercent >= 70).length} high matches for you
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {Math.round(attendees.reduce((sum, a) => sum + a.matchPercent, 0) / attendees.length)}%
            </p>
            <p className="text-[10px] text-muted-foreground">Avg Match</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default GuestListRoster;
