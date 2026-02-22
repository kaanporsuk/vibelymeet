import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export type MessageStatusType = "sending" | "sent" | "delivered" | "read";

interface MessageStatusProps {
  status: MessageStatusType;
  time: string;
  isMyMessage?: boolean;
}

const Checkmark = ({ 
  filled = false, 
  delay = 0,
  className 
}: { 
  filled?: boolean; 
  delay?: number;
  className?: string;
}) => (
  <motion.svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    initial={{ opacity: 0, scale: 0.5 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.2 }}
  >
    <motion.path
      d="M5 12l5 5L20 7"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ delay: delay + 0.1, duration: 0.3 }}
    />
    {filled && (
      <motion.path
        d="M5 12l5 5L20 7"
        stroke="url(#vibeGradient)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay + 0.2, duration: 0.3 }}
      />
    )}
    <defs>
      <linearGradient id="vibeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8B5CF6" />
        <stop offset="100%" stopColor="#06B6D4" />
      </linearGradient>
    </defs>
  </motion.svg>
);

export const MessageStatus = ({ status, time, isMyMessage = true }: MessageStatusProps) => {
  if (!isMyMessage) {
    return (
      <span className="text-[10px] text-muted-foreground">
        {time}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-primary-foreground/70">
        {time}
      </span>
      
      <div className="flex items-center">
        {status === "sending" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            className="text-primary-foreground/70"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
          </motion.div>
        )}
        
        {status === "sent" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-primary-foreground/70"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12l5 5L20 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
        )}
        
        {status === "delivered" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-primary-foreground/70"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12l5 5L20 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
        )}
        
        {status === "read" && (
          <motion.div 
            className="flex -space-x-1"
            initial={{ filter: "brightness(0.7)" }}
            animate={{ filter: "brightness(1)" }}
            transition={{ duration: 0.3 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="readGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#8B5CF6" />
                  <stop offset="100%" stopColor="#06B6D4" />
                </linearGradient>
              </defs>
              <path d="M5 12l5 5L20 7" stroke="url(#readGradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <motion.svg 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none"
              initial={{ x: -5, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              <defs>
                <linearGradient id="readGradient2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#8B5CF6" />
                  <stop offset="100%" stopColor="#06B6D4" />
                </linearGradient>
              </defs>
              <path d="M5 12l5 5L20 7" stroke="url(#readGradient2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
          </motion.div>
        )}
      </div>
    </div>
  );
};
