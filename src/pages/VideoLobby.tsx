import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelfCheckMirror } from "@/components/video-date/SelfCheckMirror";
import { PartnerTeaseCard } from "@/components/video-date/PartnerTeaseCard";
import { TipsCarousel } from "@/components/video-date/TipsCarousel";
import { supabase } from "@/integrations/supabase/client";

interface PartnerProfile {
  name: string;
  photo: string;
  vibeTags: string[];
  vibeVideoUrl: string | null;
  vibeCaption: string;
}

// Default partner data
const DEFAULT_PARTNER: PartnerProfile = {
  name: "Your Match",
  photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=300&fit=crop",
  vibeTags: ["🎵 Music Lover", "☕ Coffee Enthusiast"],
  vibeVideoUrl: null,
  vibeCaption: "",
};

const VideoLobby = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const partnerId = searchParams.get("partnerId");
  
  const [partner, setPartner] = useState<PartnerProfile>(DEFAULT_PARTNER);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isBlurOn, setIsBlurOn] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Fetch partner profile if partnerId provided
  useEffect(() => {
    const fetchPartner = async () => {
      if (!partnerId) return;
      
      const { data } = await supabase
        .from("profiles")
        .select("name, avatar_url, bio")
        .eq("id", partnerId)
        .maybeSingle();
      
      if (data) {
        setPartner({
          name: data.name,
          photo: data.avatar_url || DEFAULT_PARTNER.photo,
          vibeTags: DEFAULT_PARTNER.vibeTags,
          vibeVideoUrl: null, // Would fetch from storage if available
          vibeCaption: data.bio?.slice(0, 50) || "",
        });
      }
    };
    
    fetchPartner();
  }, [partnerId]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0 || !isReady) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate("/video-date");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown, isReady, navigate]);

  const handleJoinRoom = () => {
    setIsConnecting(true);
    // Simulate connection delay
    setTimeout(() => {
      setIsConnecting(false);
      setIsReady(true);
    }, 1500);
  };

  const handleLeaveQueue = () => {
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Blurred Background */}
      <div className="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&h=1200&fit=crop"
          alt=""
          className="w-full h-full object-cover blur-3xl opacity-20 scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="rounded-xl"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>

        <div className="text-center">
          <h1 className="text-lg font-semibold text-foreground">Video Date Lobby</h1>
          <p className="text-xs text-muted-foreground">Get ready to vibe</p>
        </div>

        <div className="w-10" /> {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="relative z-10 px-4 pb-32">
        <div className="max-w-4xl mx-auto">
          {/* Desktop: Side by side, Mobile: Stacked */}
          <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-6 lg:gap-10">
            {/* Self-Check Mirror */}
            <SelfCheckMirror
              isCameraOn={isCameraOn}
              isMicOn={isMicOn}
              isBlurOn={isBlurOn}
              onToggleCamera={() => setIsCameraOn(!isCameraOn)}
              onToggleMic={() => setIsMicOn(!isMicOn)}
              onToggleBlur={() => setIsBlurOn(!isBlurOn)}
            />

            {/* Partner Card & Vibe Video */}
            <div className="flex flex-col gap-6 w-full max-w-sm">
              {/* Partner's Vibe Video (The Hype) */}
              {partner.vibeVideoUrl && isReady && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass-card rounded-2xl overflow-hidden"
                >
                  <div className="relative aspect-[9/16] max-h-[300px]">
                    <video
                      src={partner.vibeVideoUrl}
                      className="w-full h-full object-cover"
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-background/90 to-transparent">
                      <p className="text-xs text-muted-foreground">Currently vibing on...</p>
                      <p className="text-sm font-medium text-foreground">{partner.vibeCaption}</p>
                    </div>
                  </div>
                </motion.div>
              )}

              <PartnerTeaseCard
                isBlindDate={false}
                partnerName={partner.name}
                partnerPhoto={partner.photo}
                vibeTags={partner.vibeTags}
                countdown={countdown}
              />

              <TipsCarousel />
            </div>
            </div>
          </div>
        </div>
      </main>

      {/* Floating Action Bar */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="fixed bottom-0 left-0 right-0 z-20 p-4 pb-safe"
      >
        <div className="max-w-md mx-auto glass-card rounded-3xl p-4">
          <AnimatePresence mode="wait">
            {!isReady ? (
              <motion.div
                key="join"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <Button
                  variant="gradient"
                  size="xl"
                  className="w-full"
                  onClick={handleJoinRoom}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                      </span>
                      Join Vibe Room
                    </>
                  )}
                </Button>

                <button
                  onClick={handleLeaveQueue}
                  className="w-full text-center text-sm text-muted-foreground hover:text-destructive transition-colors"
                >
                  Leave Queue
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <Button
                  variant="glass"
                  size="xl"
                  className="w-full pointer-events-none"
                >
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="gradient-text font-semibold">
                    Waiting for Partner...
                  </span>
                </Button>

                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--neon-green))] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--neon-green))]" />
                  </span>
                  Auto-connecting when partner joins
                </div>

                <button
                  onClick={handleLeaveQueue}
                  className="w-full text-center text-sm text-muted-foreground hover:text-destructive transition-colors"
                >
                  Cancel & Leave
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default VideoLobby;
