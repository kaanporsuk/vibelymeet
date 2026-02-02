import { motion, AnimatePresence } from "framer-motion";
import { Video, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import confetti from "canvas-confetti";

interface PartnerInfo {
  id: string;
  name: string;
  avatar_url: string | null;
  age: number;
  bio: string | null;
}

interface MatchFoundModalProps {
  isOpen: boolean;
  partnerId: string | null;
  roomId: string | null;
  onJoinDate: () => void;
  onCancel: () => void;
}

const MatchFoundModal = ({
  isOpen,
  partnerId,
  roomId,
  onJoinDate,
  onCancel,
}: MatchFoundModalProps) => {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);

  // Fetch partner info when modal opens
  useEffect(() => {
    if (!isOpen || !partnerId) return;

    const fetchPartner = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, name, avatar_url, age, bio")
        .eq("id", partnerId)
        .maybeSingle();

      if (data) {
        setPartner(data);

        // Get signed URL for avatar
        if (data.avatar_url) {
          if (data.avatar_url.startsWith("http")) {
            setSignedPhotoUrl(data.avatar_url);
          } else {
            const { data: signedData } = await supabase.storage
              .from("profile-photos")
              .createSignedUrl(data.avatar_url, 3600);
            if (signedData?.signedUrl) {
              setSignedPhotoUrl(signedData.signedUrl);
            }
          }
        }
      }
    };

    fetchPartner();
    
    // Trigger confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8B5CF6', '#D946EF', '#F97316'],
    });
  }, [isOpen, partnerId]);

  // Auto-join countdown
  useEffect(() => {
    if (!isOpen || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onJoinDate();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, countdown, onJoinDate]);

  // Reset countdown when modal opens
  useEffect(() => {
    if (isOpen) {
      setCountdown(5);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/90 backdrop-blur-xl"
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="w-full max-w-sm"
        >
          {/* Glow Effect */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/30 via-accent/20 to-primary/30 blur-2xl -z-10" />

          <div className="glass-card p-6 space-y-6 text-center">
            {/* Header */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="flex justify-center"
            >
              <div className="relative">
                <Sparkles className="w-12 h-12 text-primary" />
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="absolute -inset-2 bg-primary/20 rounded-full -z-10"
                />
              </div>
            </motion.div>

            <h2 className="text-2xl font-display font-bold gradient-text">
              Match Found!
            </h2>

            {/* Partner Preview */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  className="absolute -inset-2 rounded-full border-2 border-dashed border-primary/30"
                />
                <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-primary/50 bg-gradient-to-br from-primary/20 to-accent/20">
                  {signedPhotoUrl ? (
                    <img
                      src={signedPhotoUrl}
                      alt={partner?.name || "Partner"}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-10 h-10 text-muted-foreground" />
                    </div>
                  )}
                </div>
                
                {/* Online indicator */}
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-green-500 border-4 border-background"
                />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-foreground">
                  {partner?.name || "Your Match"}{partner?.age ? `, ${partner.age}` : ""}
                </h3>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {partner?.bio || "Ready for a video date!"}
                </p>
              </div>
            </motion.div>

            {/* Countdown Ring */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="relative w-16 h-16">
                <svg className="w-full h-full -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    stroke="hsl(var(--border))"
                    strokeWidth="4"
                    fill="none"
                  />
                  <motion.circle
                    cx="32"
                    cy="32"
                    r="28"
                    stroke="url(#countdownGradient)"
                    strokeWidth="4"
                    fill="none"
                    strokeLinecap="round"
                    initial={{ strokeDasharray: "176", strokeDashoffset: 0 }}
                    animate={{ strokeDashoffset: 176 - (countdown / 5) * 176 }}
                    transition={{ duration: 1, ease: "linear" }}
                  />
                  <defs>
                    <linearGradient id="countdownGradient">
                      <stop offset="0%" stopColor="hsl(var(--primary))" />
                      <stop offset="100%" stopColor="hsl(var(--accent))" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-foreground">
                  {countdown}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Auto-joining in...</p>
            </motion.div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                variant="gradient"
                className="flex-1 gap-2"
                onClick={onJoinDate}
              >
                <Video className="w-4 h-4" />
                Join Now
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MatchFoundModal;
