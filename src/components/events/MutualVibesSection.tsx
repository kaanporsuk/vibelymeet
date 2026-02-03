import { motion } from "framer-motion";
import { Heart, Sparkles, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface MutualVibe {
  id: string;
  name: string;
  avatar: string | null;
  age: number;
}

interface MutualVibesSectionProps {
  mutualVibes: MutualVibe[];
  onProfileClick: (profileId: string) => void;
}

export function MutualVibesSection({ mutualVibes, onProfileClick }: MutualVibesSectionProps) {
  if (mutualVibes.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Heart className="w-5 h-5 text-pink-500" />
          <motion.div
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0"
          >
            <Heart className="w-5 h-5 text-pink-500 opacity-50" />
          </motion.div>
        </div>
        <h3 className="text-lg font-semibold text-foreground">Mutual Vibes</h3>
        <Badge 
          variant="secondary" 
          className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-pink-500/30 text-pink-400"
        >
          {mutualVibes.length} match{mutualVibes.length !== 1 ? 'es' : ''}
        </Badge>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">
        You both sent vibes to each other! Make sure to connect during the event 💜
      </p>

      {/* Mutual Vibes Grid */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
        {mutualVibes.map((vibe, index) => (
          <motion.button
            key={vibe.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onProfileClick(vibe.id)}
            className="flex-shrink-0"
          >
            <div className="relative glass-card rounded-2xl p-3 w-[100px] border-2 border-pink-500/50 bg-gradient-to-br from-pink-500/10 to-purple-500/10 hover:border-pink-400 transition-all">
              {/* Sparkle indicator */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute -top-2 -right-2"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 flex items-center justify-center shadow-lg">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
              </motion.div>

              {/* Avatar */}
              <div className="mx-auto mb-2">
                <Avatar className="w-14 h-14 ring-2 ring-pink-500/50">
                  <AvatarImage src={vibe.avatar || undefined} alt={vibe.name} />
                  <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-purple-500/20">
                    <User className="w-6 h-6 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
              </div>

              {/* Name & Age */}
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground truncate">
                  {vibe.name.split(" ")[0]}
                </p>
                <p className="text-xs text-muted-foreground">{vibe.age}</p>
              </div>

              {/* Mutual badge */}
              <div className="mt-2 text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-400 text-center font-medium">
                💜 Mutual
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Tip */}
      <div className="glass-card p-3 rounded-xl border border-pink-500/20 bg-gradient-to-r from-pink-500/5 to-purple-500/5">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-pink-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Pro tip:</span> Mutual vibes have 3x higher match rates during the event! 
            Look out for each other in the video dates.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
