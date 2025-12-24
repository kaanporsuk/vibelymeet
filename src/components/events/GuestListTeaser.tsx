import { motion } from "framer-motion";
import { Lock, Users, Sparkles } from "lucide-react";

interface Attendee {
  id: string;
  name: string;
  avatar: string;
  vibeTags: string[];
}

interface GuestListTeaserProps {
  attendees: Attendee[];
  totalCount: number;
}

const GuestListTeaser = ({ attendees, totalCount }: GuestListTeaserProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Who's Going</h3>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {totalCount} attending
          </span>
        </div>
      </div>

      {/* Mystery Cards Grid */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-4 pb-2">
          {attendees.slice(0, 6).map((attendee, index) => (
            <motion.div
              key={attendee.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="flex-shrink-0"
            >
              <div className="relative glass-card rounded-2xl p-3 w-[100px] backdrop-blur-md border border-border/50">
                {/* Blurred Avatar */}
                <div className="relative w-16 h-16 mx-auto mb-2">
                  <img
                    src={attendee.avatar}
                    alt="Mystery attendee"
                    className="w-full h-full object-cover rounded-full blur-lg scale-110"
                  />
                  <div className="absolute inset-0 bg-background/40 rounded-full flex items-center justify-center">
                    <motion.div
                      animate={{ 
                        boxShadow: [
                          "0 0 10px hsl(var(--primary))",
                          "0 0 20px hsl(var(--primary))",
                          "0 0 10px hsl(var(--primary))"
                        ]
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/80 to-accent/80 flex items-center justify-center"
                    >
                      <Lock className="w-4 h-4 text-primary-foreground" />
                    </motion.div>
                  </div>
                </div>

                {/* Vibe Tags */}
                <div className="space-y-1">
                  {attendee.vibeTags.slice(0, 2).map((tag, tagIndex) => (
                    <div
                      key={tagIndex}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary text-center truncate"
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}

          {/* More Hidden */}
          {totalCount > 6 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6 }}
              className="flex-shrink-0"
            >
              <div className="relative glass-card rounded-2xl p-3 w-[100px] backdrop-blur-md border border-border/50 h-full flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-2">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  +{totalCount - 6} more
                </span>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Unlock Prompt */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="glass-card p-4 rounded-2xl border border-primary/20"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {totalCount} guests waiting to meet you
            </p>
            <p className="text-xs text-muted-foreground">
              Purchase a ticket to reveal the full guest list
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GuestListTeaser;
