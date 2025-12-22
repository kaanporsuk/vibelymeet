import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Profile {
  id: string;
  name: string;
  age: number;
  avatar: string;
  bio: string;
  vibeTag: string;
  photos: string[];
}

interface MiniProfileModalProps {
  profile: Profile | null;
  isOpen: boolean;
  onClose: () => void;
}

const MiniProfileModal = ({ profile, isOpen, onClose }: MiniProfileModalProps) => {
  if (!profile) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-sm"
          >
            <div className="glass-card overflow-hidden">
              {/* Photo */}
              <div className="relative aspect-[4/5] overflow-hidden">
                <img
                  src={profile.photos[0] || profile.avatar}
                  alt={profile.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
                
                {/* Close Button */}
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-background/60 backdrop-blur-sm flex items-center justify-center hover:bg-background/80 transition-colors"
                >
                  <X className="w-4 h-4 text-foreground" />
                </button>

                {/* Vibe Tag */}
                <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-primary/20 backdrop-blur-sm border border-primary/30">
                  <span className="text-xs font-medium text-primary">
                    {profile.vibeTag}
                  </span>
                </div>

                {/* Info Overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="text-xl font-bold text-foreground">
                    {profile.name}, {profile.age}
                  </h3>
                </div>
              </div>

              {/* Bio */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {profile.bio}
                </p>

                {/* CTA */}
                <div className="flex items-center gap-3">
                  <Button variant="outline" className="flex-1" onClick={onClose}>
                    Maybe Later
                  </Button>
                  <Button variant="gradient" className="flex-1 gap-2">
                    <Sparkles className="w-4 h-4" />
                    Register to Match
                  </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  Register for this event to unlock matching
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MiniProfileModal;
