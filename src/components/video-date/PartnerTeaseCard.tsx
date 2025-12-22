import { motion } from "framer-motion";
import { HelpCircle } from "lucide-react";

interface PartnerTeaseCardProps {
  isBlindDate: boolean;
  partnerName?: string;
  partnerPhoto?: string;
  vibeTags: string[];
  countdown: number;
}

export const PartnerTeaseCard = ({
  isBlindDate,
  partnerName,
  partnerPhoto,
  vibeTags,
  countdown,
}: PartnerTeaseCardProps) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="glass-card p-6 rounded-3xl w-full max-w-sm"
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Up Next</p>

      <div className="flex items-center gap-4 mb-6">
        {/* Avatar */}
        <div className="relative">
          {isBlindDate ? (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(var(--neon-violet)/0.3)] to-[hsl(var(--neon-pink)/0.3)] flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 backdrop-blur-xl" />
              <HelpCircle className="w-8 h-8 text-primary relative z-10" />
            </div>
          ) : (
            <img
              src={partnerPhoto}
              alt={partnerName}
              className="w-20 h-20 rounded-2xl object-cover"
            />
          )}
          
          {/* Online indicator */}
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[hsl(var(--neon-green))] border-2 border-background flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-background animate-pulse" />
          </div>
        </div>

        {/* Name & Status */}
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground">
            {isBlindDate ? "Mystery Match" : partnerName}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isBlindDate ? "Ready to vibe with you" : "Waiting in lobby..."}
          </p>
        </div>
      </div>

      {/* Vibe Tags */}
      <div className="flex flex-wrap gap-2 mb-6">
        {vibeTags.map((tag, i) => (
          <motion.span
            key={tag}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 + i * 0.1 }}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-secondary/80 text-foreground border border-border/50"
          >
            {tag}
          </motion.span>
        ))}
      </div>

      {/* Countdown */}
      <div className="text-center p-4 rounded-2xl bg-background/50 border border-border/30">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Connecting in
        </p>
        <motion.p
          key={countdown}
          initial={{ scale: 1.1, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-4xl font-bold gradient-text"
        >
          {formatTime(countdown)}
        </motion.p>
      </div>
    </motion.div>
  );
};
