import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { PhotoVerifiedMark } from "@/components/PhotoVerifiedMark";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";

interface MatchAvatarProps {
  name: string;
  image: string;
  isNew?: boolean;
  hasUnread?: boolean;
  photoVerified?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  showName?: boolean;
}

export const MatchAvatar = ({
  name,
  image,
  isNew = false,
  hasUnread = false,
  photoVerified = false,
  size = "md",
  onClick,
  showName = true,
}: MatchAvatarProps) => {
  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const ringClasses = {
    sm: "p-0.5",
    md: "p-[3px]",
    lg: "p-1",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="flex flex-col items-center gap-2 min-w-fit"
    >
      <div className="relative">
        {/* Animated gradient ring for new matches */}
        <div
          className={cn(
            "rounded-full",
            ringClasses[size],
            isNew || hasUnread
              ? "bg-gradient-primary animate-glow-pulse"
              : "bg-border"
          )}
        >
          <div className="rounded-full bg-background p-[2px]">
            <ProfilePhoto
              avatarUrl={image}
              name={name}
              size={size === "sm" ? "sm" : size === "lg" ? "lg" : "md"}
              rounded="full"
              loading="eager"
            />
          </div>
        </div>

        {/* New badge */}
        {isNew && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-gradient-primary text-[10px] font-semibold text-primary-foreground shadow-lg"
          >
            NEW
          </motion.div>
        )}

        {/* Unread indicator (when not new) */}
        {hasUnread && !isNew && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent neon-glow-pink"
          />
        )}

        {/* Photo verified badge */}
        {photoVerified && !isNew && !hasUnread && (
          <PhotoVerifiedMark verified className="absolute -top-0.5 -right-0.5" />
        )}
      </div>

      {showName && (
        <span className="text-xs text-foreground font-medium truncate max-w-[64px]">
          {name.split(" ")[0]}
        </span>
      )}
    </motion.button>
  );
};
