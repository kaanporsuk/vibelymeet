import { cn } from "@/lib/utils";

interface MatchAvatarProps {
  image: string;
  name: string;
  isNew?: boolean;
  onClick?: () => void;
}

export const MatchAvatar = ({ image, name, isNew, onClick }: MatchAvatarProps) => {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 shrink-0"
    >
      <div className="relative">
        <div
          className={cn(
            "w-16 h-16 rounded-full overflow-hidden border-2 transition-all duration-300",
            isNew ? "border-neon-pink neon-glow-pink" : "border-border"
          )}
        >
          <img
            src={image}
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
        {isNew && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-neon-pink rounded-full flex items-center justify-center">
            <span className="text-[10px] text-white font-bold">!</span>
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground truncate w-16 text-center">
        {name}
      </span>
    </button>
  );
};
