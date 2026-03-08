import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2, User, Heart, HeartOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { swipeCardUrl } from "@/utils/imageUrl";

interface Profile {
  id: string;
  name: string;
  age: number;
  avatar: string;
  bio: string;
  vibeTag: string;
  photos: string[];
  matchPercent?: number;
}

interface MiniProfileModalProps {
  profile: Profile | null;
  isOpen: boolean;
  onClose: () => void;
  onRegister?: () => void;
  onViewFullProfile?: (profileId: string) => void;
  onSendVibe?: (profileId: string) => void;
  onRemoveVibe?: (profileId: string) => void;
  isRegistered?: boolean;
  isViewerRegistered?: boolean;
  hasSentVibe?: boolean;
  hasReceivedVibe?: boolean;
  isSendingVibe?: boolean;
  eventStatus?: "upcoming" | "live" | "ended";
}

const MiniProfileModal = ({ 
  profile, 
  isOpen, 
  onClose, 
  onRegister,
  onViewFullProfile,
  onSendVibe,
  onRemoveVibe,
  isRegistered = false,
  isViewerRegistered = false,
  hasSentVibe = false,
  hasReceivedVibe = false,
  isSendingVibe = false,
  eventStatus = "upcoming",
}: MiniProfileModalProps) => {
  const { user } = useAuth();
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);

  useEffect(() => {
    if (!profile || !isOpen) {
      setSignedPhotoUrl(null);
      return;
    }

    const photoPath = profile.photos?.[0] || profile.avatar;
    if (!photoPath) {
      setSignedPhotoUrl(null);
      return;
    }

    // Use CDN helper — handles full URLs and Bunny paths
    const { getImageUrl } = require("@/utils/imageUrl");
    setSignedPhotoUrl(getImageUrl(photoPath, { width: 720 }));
  }, [profile, isOpen]);

  if (!profile) return null;

  const handleRegisterClick = () => {
    if (onRegister) {
      onRegister();
    }
    onClose();
  };

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
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-[90%] max-w-sm"
          >
            <div className="glass-card overflow-hidden">
              {/* Photo */}
              <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-secondary via-muted to-secondary">
                {/* Fallback gradient background always visible */}
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 via-accent/20 to-primary/30">
                  <User className="w-16 h-16 text-muted-foreground/50" />
                </div>
                
                {loadingPhoto ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-secondary/80">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : signedPhotoUrl ? (
                  <img
                    src={signedPhotoUrl}
                    alt={profile.name}
                    className="absolute inset-0 w-full h-full object-cover z-10"
                    onError={(e) => {
                      // If image fails to load, hide it - fallback shows through
                      (e.target as HTMLImageElement).style.opacity = "0";
                    }}
                  />
                ) : null}
                
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

                {/* Match Percent Badge */}
                {profile.matchPercent && profile.matchPercent >= 70 && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-3 right-14 px-2 py-1 rounded-full bg-gradient-to-r from-primary to-accent"
                  >
                    <span className="text-xs font-bold text-primary-foreground">
                      {profile.matchPercent}% Match
                    </span>
                  </motion.div>
                )}

                {/* Info Overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="text-xl font-bold text-foreground">
                    {profile.name}, {profile.age}
                  </h3>
                </div>
              </div>

              {/* Bio */}
              <div className="p-4 space-y-4">
                {/* Mutual Vibe Badge */}
                {hasSentVibe && hasReceivedVibe && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center justify-center gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30"
                  >
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium gradient-text">Mutual Vibe!</span>
                  </motion.div>
                )}

                {/* Received Vibe Badge */}
                {hasReceivedVibe && !hasSentVibe && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center justify-center gap-2 p-2 rounded-lg bg-accent/10 border border-accent/30"
                  >
                    <Heart className="w-4 h-4 text-accent fill-accent" />
                    <span className="text-sm font-medium text-accent">They vibed you!</span>
                  </motion.div>
                )}

                <p className="text-sm text-muted-foreground line-clamp-3">
                  {profile.bio || "Ready to meet new people!"}
                </p>

                {/* CTA - Different based on context */}
                <div className="flex items-center gap-3">
                  <Button variant="outline" className="flex-1" onClick={onClose}>
                    Close
                  </Button>
                  
                  {/* If viewer is registered, show actions based on event status */}
                  {isViewerRegistered && profile.id !== user?.id ? (
                    eventStatus === "upcoming" ? (
                      // Before event: Send a Vibe
                      hasSentVibe ? (
                        <Button 
                          variant="outline" 
                          className="flex-1 gap-2 border-primary/50 text-primary"
                          onClick={() => onRemoveVibe?.(profile.id)}
                          disabled={isSendingVibe}
                        >
                          <Check className="w-4 h-4" />
                          Vibed!
                        </Button>
                      ) : (
                        <Button 
                          variant="gradient" 
                          className="flex-1 gap-2"
                          onClick={() => onSendVibe?.(profile.id)}
                          disabled={isSendingVibe}
                        >
                          {isSendingVibe ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Heart className="w-4 h-4" />
                          )}
                          Send a Vibe
                        </Button>
                      )
                    ) : (
                      // During/after event: View Full Profile
                      <Button 
                        variant="gradient" 
                        className="flex-1 gap-2"
                        onClick={() => {
                          if (onViewFullProfile && profile) {
                            onViewFullProfile(profile.id);
                          }
                          onClose();
                        }}
                      >
                        <User className="w-4 h-4" />
                        View Full Profile
                      </Button>
                    )
                  ) : !isViewerRegistered ? (
                    /* If viewer is NOT registered, show Register to Match */
                    <Button 
                      variant="gradient" 
                      className="flex-1 gap-2"
                      onClick={handleRegisterClick}
                    >
                      <Sparkles className="w-4 h-4" />
                      Register to Match
                    </Button>
                  ) : null}
                </div>

                {!isViewerRegistered && (
                  <p className="text-center text-xs text-muted-foreground">
                    Register for this event to unlock matching
                  </p>
                )}

                {isViewerRegistered && eventStatus === "upcoming" && (
                  <p className="text-center text-xs text-muted-foreground">
                    Send a vibe to express interest before the event!
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default MiniProfileModal;
