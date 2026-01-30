import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  isRegistered?: boolean;
}

const MiniProfileModal = ({ 
  profile, 
  isOpen, 
  onClose, 
  onRegister,
  isRegistered = false 
}: MiniProfileModalProps) => {
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);

  useEffect(() => {
    if (!profile || !isOpen) {
      setSignedPhotoUrl(null);
      return;
    }

    const loadSignedUrl = async () => {
      // Determine which photo to use
      const photoPath = profile.photos?.[0] || profile.avatar;
      
      if (!photoPath) {
        setSignedPhotoUrl(null);
        return;
      }

      // If it's already a full URL (not a storage path), use it directly
      if (photoPath.startsWith("http://") || photoPath.startsWith("https://")) {
        setSignedPhotoUrl(photoPath);
        return;
      }

      // Otherwise, generate a signed URL from storage
      setLoadingPhoto(true);
      try {
        const { data } = await supabase.storage
          .from("profile-photos")
          .createSignedUrl(photoPath, 3600); // 1 hour expiry

        if (data?.signedUrl) {
          setSignedPhotoUrl(data.signedUrl);
        } else {
          // Fallback to the raw path
          setSignedPhotoUrl(photoPath);
        }
      } catch (err) {
        console.error("Error creating signed URL:", err);
        setSignedPhotoUrl(photoPath);
      } finally {
        setLoadingPhoto(false);
      }
    };

    loadSignedUrl();
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
              <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
                {loadingPhoto ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : signedPhotoUrl ? (
                  <img
                    src={signedPhotoUrl}
                    alt={profile.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // If image fails to load, hide it
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
                    <span className="text-4xl font-bold text-foreground/50">
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                
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
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {profile.bio || "Ready to meet new people!"}
                </p>

                {/* CTA */}
                <div className="flex items-center gap-3">
                  <Button variant="outline" className="flex-1" onClick={onClose}>
                    Maybe Later
                  </Button>
                  {isRegistered ? (
                    <Button variant="gradient" className="flex-1 gap-2" disabled>
                      <Sparkles className="w-4 h-4" />
                      Already Registered
                    </Button>
                  ) : (
                    <Button 
                      variant="gradient" 
                      className="flex-1 gap-2"
                      onClick={handleRegisterClick}
                    >
                      <Sparkles className="w-4 h-4" />
                      Register to Match
                    </Button>
                  )}
                </div>

                {!isRegistered && (
                  <p className="text-center text-xs text-muted-foreground">
                    Register for this event to unlock matching
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
