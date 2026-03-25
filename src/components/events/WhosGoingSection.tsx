import { motion } from "framer-motion";
import { Users, Lock } from "lucide-react";
import AttendeeCard from "./AttendeeCard";

interface Attendee {
  id: string;
  name: string;
  age: number;
  avatar: string;
  about_me: string;
  vibeTag: string;
  photos: string[];
  photoVerified?: boolean;
}

interface WhosGoingSectionProps {
  attendees: Attendee[];
  totalCount: number;
  onAttendeeClick: (attendee: Attendee) => void;
}

const WhosGoingSection = ({ attendees, totalCount, onAttendeeClick }: WhosGoingSectionProps) => {
  const visibleAttendees = attendees.slice(0, 6);
  const hiddenCount = totalCount - visibleAttendees.length;

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
        <span className="text-sm text-muted-foreground">
          {totalCount} registered
        </span>
      </div>

      {/* Attendees Grid */}
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-4 pb-2">
          {visibleAttendees.map((attendee, index) => (
            <motion.div
              key={attendee.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
            >
              <AttendeeCard
                id={attendee.id}
                name={attendee.name}
                avatar={attendee.avatar}
                vibeTag={attendee.vibeTag}
                photoVerified={attendee.photoVerified}
                onClick={() => onAttendeeClick(attendee)}
              />
            </motion.div>
          ))}

          {/* Hidden Attendees Teaser */}
          {hiddenCount > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: visibleAttendees.length * 0.1 }}
              className="flex flex-col items-center gap-2 min-w-[80px]"
            >
              <div className="relative w-16 h-16">
                {/* Stacked blurred avatars */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 to-accent/30 backdrop-blur-sm border-2 border-dashed border-border flex items-center justify-center">
                  <Lock className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                +{hiddenCount} more
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Register Prompt */}
      <div className="glass-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {hiddenCount} others are hiding 👀
          </p>
          <p className="text-xs text-muted-foreground">
            Register to see everyone & unlock matching
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default WhosGoingSection;
