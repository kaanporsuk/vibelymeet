import { motion } from "framer-motion";

interface AttendeeCardProps {
  id: string;
  name: string;
  avatar: string;
  vibeTag: string;
  isBlurred?: boolean;
  onClick?: () => void;
}

const AttendeeCard = ({ name, avatar, vibeTag, isBlurred, onClick }: AttendeeCardProps) => {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="flex flex-col items-center gap-2 min-w-[80px]"
    >
      <div className="relative">
        <div 
          className={`w-16 h-16 rounded-full overflow-hidden ring-2 ring-border transition-all duration-300
            ${!isBlurred ? 'hover:ring-primary' : ''}`}
        >
          <img 
            src={avatar} 
            alt={name}
            className={`w-full h-full object-cover ${isBlurred ? 'blur-md scale-110' : ''}`}
          />
          {isBlurred && (
            <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
              <span className="text-lg">🔒</span>
            </div>
          )}
        </div>
        {!isBlurred && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-secondary rounded-full border border-border">
            <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
              {vibeTag}
            </span>
          </div>
        )}
      </div>
      <span className={`text-xs font-medium ${isBlurred ? 'text-muted-foreground' : 'text-foreground'}`}>
        {isBlurred ? '???' : name.split(' ')[0]}
      </span>
    </motion.button>
  );
};

export default AttendeeCard;
