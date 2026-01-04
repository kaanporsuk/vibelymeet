import { useState } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { MessageCircle, User, X, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProfileDetailDrawer } from "./ProfileDetailDrawer";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { LazyImage } from "@/components/LazyImage";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { toast } from "sonner";

interface SwipeableMatchCardProps {
  id: string;
  name: string;
  age: number;
  image: string;
  lastMessage: string | null;
  time: string;
  unread: boolean;
  vibes: string[];
  photoVerified?: boolean;
  compatibility?: number;
  onClick: () => void;
  onViewProfile: () => void;
  onUnmatch: () => void;
}

export const SwipeableMatchCard = ({
  id,
  name,
  age,
  image,
  lastMessage,
  time,
  unread,
  vibes,
  photoVerified,
  compatibility = Math.floor(Math.random() * 20) + 80,
  onClick,
  onViewProfile,
  onUnmatch,
}: SwipeableMatchCardProps) => {
  const [isRevealed, setIsRevealed] = useState(false);
  const { hapticSwipe, hapticTap, playFeedback } = useSoundEffects();
  const x = useMotionValue(0);
  const background = useTransform(
    x,
    [-150, -50, 0, 50, 150],
    [
      "hsl(var(--destructive))",
      "hsl(var(--destructive) / 0.5)",
      "transparent",
      "hsl(var(--primary) / 0.5)",
      "hsl(var(--primary))",
    ]
  );

  const handleDragEnd = (_: any, info: PanInfo) => {
    const threshold = 100;
    if (info.offset.x < -threshold) {
      playFeedback('wrong', { volume: 0.3 });
      onUnmatch();
    } else if (info.offset.x > threshold) {
      playFeedback('click', { volume: 0.3 });
      onViewProfile();
    }
    setIsRevealed(false);
  };

  const handleDrag = (_: any, info: PanInfo) => {
    const wasRevealed = isRevealed;
    const nowRevealed = Math.abs(info.offset.x) > 30;
    if (nowRevealed && !wasRevealed) {
      hapticSwipe();
    }
    setIsRevealed(nowRevealed);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Background actions */}
      <motion.div
        style={{ background }}
        className="absolute inset-0 flex items-center justify-between px-6"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isRevealed ? 1 : 0 }}
          className="flex items-center gap-2 text-primary-foreground"
        >
          <User className="w-5 h-5" />
          <span className="text-sm font-medium">Profile</span>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isRevealed ? 1 : 0 }}
          className="flex items-center gap-2 text-destructive-foreground"
        >
          <span className="text-sm font-medium">Unmatch</span>
          <X className="w-5 h-5" />
        </motion.div>
      </motion.div>

      {/* Main card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.3}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="relative w-full flex items-center gap-4 p-4 bg-background border-b border-border hover:bg-secondary/30 transition-colors text-left group"
      >
        {/* Avatar with ProfileDetailDrawer */}
        <ProfileDetailDrawer
          match={{ id, name, age, image, vibes, compatibility }}
          trigger={
            <div className="relative shrink-0 cursor-pointer">
              <div
                className={cn(
                  "p-[2px] rounded-full transition-transform hover:scale-105",
                  unread ? "bg-gradient-primary" : "bg-border"
                )}
              >
                <img
                  src={image}
                  alt={name}
                  className="w-14 h-14 rounded-full object-cover bg-background"
                  loading="lazy"
                />
              </div>
              <div className="absolute -bottom-1 -right-1">
                <PhotoVerifiedMark verified={!!photoVerified} />
              </div>
              {unread && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accent border-2 border-background neon-glow-pink"
                />
              )}
            </div>
          }
          onMessage={onClick}
          onVideoCall={() => toast.info("Video call feature coming soon!")}
        />

        {/* Content - clickable area for chat */}
        <button
          onClick={onClick}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">
                {name}, {age}
              </h3>
              {/* Compatibility badge */}
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan text-xs font-medium">
                <Sparkles className="w-3 h-3" />
                {compatibility}%
              </div>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{time}</span>
          </div>

          {/* Last message */}
          <p
            className={cn(
              "text-sm truncate mb-1.5",
              unread ? "text-foreground font-medium" : "text-muted-foreground"
            )}
          >
            {lastMessage}
          </p>

          {/* Vibe tags */}
          <div className="flex gap-1.5">
            {vibes.slice(0, 2).map((vibe) => (
              <span
                key={vibe}
                className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20"
              >
                {vibe}
              </span>
            ))}
          </div>
        </button>

        {/* Chat icon */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-primary" />
          </div>
        </div>
      </motion.div>
    </div>
  );
};
