import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import confetti from "canvas-confetti";
import { MessageCircle, Sparkles, Zap, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { LazyImage } from "@/components/LazyImage";
import { PhoneVerificationNudge } from "@/components/PhoneVerificationNudge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface MatchSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  matchData?: {
    name: string;
    age: number;
    avatar: string;
    sharedVibes: string[];
    vibeScore: number;
  };
  userData?: {
    name: string;
    avatar: string;
  };
}

const MatchSuccessModal = ({
  isOpen,
  onClose,
  matchData = {
    name: "Sarah",
    age: 24,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
    sharedVibes: ["🦉 Night Owl", "🎨 Design", "🍕 Pizza"],
    vibeScore: 94,
  },
  userData = {
    name: "You",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
  },
}: MatchSuccessModalProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [animationPhase, setAnimationPhase] = useState(0);
  const { playFeedback, preloadAll } = useSoundEffects();
  const [showPhoneNudge, setShowPhoneNudge] = useState(false);

  // Check if this is user's first match and phone not verified
  useEffect(() => {
    if (!isOpen || !user) return;
    const dismissed = localStorage.getItem("vibely_phone_nudge_match_dismissed");
    if (dismissed) return;

    const checkFirstMatch = async () => {
      const [{ count }, { data: phoneData }] = await Promise.all([
        supabase.from("matches").select("*", { count: "exact", head: true })
          .or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`),
        supabase.from("profiles").select("phone_verified").eq("id", user.id).maybeSingle(),
      ]);
      if (count === 1 && phoneData && !phoneData.phone_verified) {
        setShowPhoneNudge(true);
      }
    };
    checkFirstMatch();
  }, [isOpen, user]);

  // Preload sounds on mount
  useEffect(() => {
    preloadAll();
  }, [preloadAll]);

  useEffect(() => {
    if (isOpen) {
      // Reset animation phase
      setAnimationPhase(0);
      
      // Orchestrate animation sequence
      const timeline = [
        { phase: 1, delay: 100 },   // Shockwave
        { phase: 2, delay: 300 },   // Avatars slide in
        { phase: 3, delay: 500 },   // Confetti & content
        { phase: 4, delay: 800 },   // Full reveal
      ];

      timeline.forEach(({ phase, delay }) => {
        setTimeout(() => {
          setAnimationPhase(phase);
          // Play sounds at specific phases
          if (phase === 1) {
            playFeedback('unlock', { volume: 0.6 });
          } else if (phase === 3) {
            playFeedback('match', { volume: 0.7 });
          }
        }, delay);
      });

      // Trigger confetti explosion
      setTimeout(() => {
        const colors = ["#8B5CF6", "#06B6D4", "#FFD700", "#EC4899"];
        
        // Center burst
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.5, x: 0.5 },
          colors,
          startVelocity: 50,
          gravity: 0.7,
          ticks: 400,
        });

        // Left burst
        confetti({
          particleCount: 75,
          angle: 60,
          spread: 60,
          origin: { x: 0, y: 0.5 },
          colors,
          startVelocity: 40,
        });

        // Right burst
        confetti({
          particleCount: 75,
          angle: 120,
          spread: 60,
          origin: { x: 1, y: 0.5 },
          colors,
          startVelocity: 40,
        });

        // Delayed second wave
        setTimeout(() => {
          confetti({
            particleCount: 50,
            spread: 100,
            origin: { y: 0.4, x: 0.5 },
            colors,
            startVelocity: 30,
          });
        }, 300);
      }, 500);
    }
  }, [isOpen, playFeedback]);

  const handleStartChatting = () => {
    onClose();
    navigate("/chat");
  };

  const handleKeepVibing = () => {
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
        >
          {/* Dark Background */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.1 }}
            className="absolute inset-0 bg-black/95"
          />

          {/* Shockwave Effect */}
          <AnimatePresence>
            {animationPhase >= 1 && (
              <motion.div
                initial={{ scale: 0, opacity: 1 }}
                animate={{ scale: 4, opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute w-64 h-64 rounded-full"
                style={{
                  background: "radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)",
                }}
              />
            )}
          </AnimatePresence>

          {/* Secondary Shockwave */}
          <AnimatePresence>
            {animationPhase >= 1 && (
              <motion.div
                initial={{ scale: 0, opacity: 0.8 }}
                animate={{ scale: 3, opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                className="absolute w-48 h-48 rounded-full"
                style={{
                  background: "radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)",
                }}
              />
            )}
          </AnimatePresence>

          {/* Main Content Container */}
          <div className="relative z-10 flex flex-col items-center justify-center w-full max-w-md px-6">
            
            {/* IT'S A VIBE! Headline */}
            <AnimatePresence>
              {animationPhase >= 3 && (
                <motion.div
                  initial={{ scale: 0, rotate: -10 }}
                  animate={{ scale: 1, rotate: -3 }}
                  transition={{ 
                    type: "spring", 
                    stiffness: 300, 
                    damping: 15,
                    delay: 0.1 
                  }}
                  className="mb-8"
                >
                  <h1 
                    className="text-5xl md:text-6xl font-black tracking-tight"
                    style={{
                      background: "linear-gradient(135deg, #8B5CF6 0%, #EC4899 50%, #06B6D4 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      textShadow: "0 0 60px rgba(139, 92, 246, 0.5)",
                      filter: "drop-shadow(0 0 30px rgba(139, 92, 246, 0.4))",
                    }}
                  >
                    IT'S A VIBE!
                  </h1>
                  
                  {/* Sound Equalizer Visualization */}
                  <div className="flex items-end justify-center gap-1 mt-2 h-4">
                    {[...Array(7)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1 bg-gradient-to-t from-primary to-accent rounded-full"
                        animate={{
                          height: [8, 16, 8, 12, 8],
                        }}
                        transition={{
                          duration: 0.5,
                          repeat: Infinity,
                          delay: i * 0.1,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Avatar Section */}
            <div className="relative flex items-center justify-center gap-4 mb-8">
              
              {/* User Avatar */}
              <AnimatePresence>
                {animationPhase >= 2 && (
                  <motion.div
                    initial={{ x: -200, opacity: 0, scale: 0.5 }}
                    animate={{ x: 0, opacity: 1, scale: 1 }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 200, 
                      damping: 20 
                    }}
                    className="relative"
                  >
                    {/* Rotating Glow Ring - Cyan */}
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                      className="absolute -inset-2 rounded-full"
                      style={{
                        background: "conic-gradient(from 0deg, #06B6D4, transparent, #06B6D4)",
                        filter: "blur(4px)",
                      }}
                    />
                    <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-background">
                      <img
                        src={userData.avatar}
                        alt={userData.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Energy Bolt Connection */}
              <AnimatePresence>
                {animationPhase >= 3 && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="relative z-20 -mx-6"
                  >
                    <motion.div
                      animate={{
                        boxShadow: [
                          "0 0 20px rgba(139, 92, 246, 0.5)",
                          "0 0 40px rgba(139, 92, 246, 0.8)",
                          "0 0 20px rgba(139, 92, 246, 0.5)",
                        ],
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-16 h-16 rounded-full bg-gradient-to-br from-primary via-accent to-pink-500 flex items-center justify-center"
                    >
                      <Zap className="w-8 h-8 text-white" fill="white" />
                    </motion.div>
                    
                    {/* Pulsing Ring */}
                    <motion.div
                      animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="absolute inset-0 rounded-full border-2 border-primary"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Match Avatar */}
              <AnimatePresence>
                {animationPhase >= 2 && (
                  <motion.div
                    initial={{ x: 200, opacity: 0, scale: 0.5 }}
                    animate={{ x: 0, opacity: 1, scale: 1 }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 200, 
                      damping: 20 
                    }}
                    className="relative"
                  >
                    {/* Rotating Glow Ring - Pink */}
                    <motion.div
                      animate={{ rotate: -360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                      className="absolute -inset-2 rounded-full"
                      style={{
                        background: "conic-gradient(from 0deg, #EC4899, transparent, #EC4899)",
                        filter: "blur(4px)",
                      }}
                    />
                    <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-background">
                      <img
                        src={matchData.avatar}
                        alt={matchData.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    
                    {/* Name Badge */}
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border"
                    >
                      <span className="text-sm font-semibold text-foreground">
                        {matchData.name}, {matchData.age}
                      </span>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Vibe Score Badge */}
              <AnimatePresence>
                {animationPhase >= 4 && (
                  <motion.div
                    initial={{ scale: 0, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    className="absolute -top-4 left-1/2 -translate-x-1/2"
                  >
                    <motion.div
                      animate={{
                        boxShadow: [
                          "0 0 20px rgba(255, 215, 0, 0.3)",
                          "0 0 30px rgba(255, 215, 0, 0.5)",
                          "0 0 20px rgba(255, 215, 0, 0.3)",
                        ],
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="px-4 py-2 rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 flex items-center gap-2"
                    >
                      <Heart className="w-4 h-4 text-white" fill="white" />
                      <span className="text-lg font-bold text-white">
                        {matchData.vibeScore}% Chemistry
                      </span>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Compatibility Card */}
            <AnimatePresence>
              {animationPhase >= 4 && (
                <motion.div
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                  className="w-full mb-8"
                >
                  <div className="glass-card p-5 rounded-2xl border border-border/50">
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <span className="text-sm text-muted-foreground font-medium">
                        You both vibe on:
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      {matchData.sharedVibes.map((vibe, index) => (
                        <motion.div
                          key={vibe}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 400, 
                            damping: 15,
                            delay: index * 0.1 
                          }}
                          className="relative"
                        >
                          <motion.div
                            animate={{
                              boxShadow: [
                                "0 0 10px rgba(255, 215, 0, 0.2)",
                                "0 0 20px rgba(255, 215, 0, 0.4)",
                                "0 0 10px rgba(255, 215, 0, 0.2)",
                              ],
                            }}
                            transition={{ 
                              duration: 2, 
                              repeat: Infinity,
                              delay: index * 0.2 
                            }}
                            className="px-4 py-2 rounded-full bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30"
                          >
                            <span className="text-sm font-medium text-foreground">
                              {vibe}
                            </span>
                          </motion.div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* CTA Buttons */}
            <AnimatePresence>
              {animationPhase >= 4 && (
                <motion.div
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="w-full space-y-3"
                >
                  {/* Primary CTA */}
                  <motion.div
                    animate={{
                      scale: [1, 1.02, 1],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <Button
                      onClick={handleStartChatting}
                      className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-primary via-violet-500 to-primary bg-[length:200%_100%] hover:bg-[length:100%_100%] transition-all duration-500"
                      style={{
                        boxShadow: "0 0 30px rgba(139, 92, 246, 0.4)",
                      }}
                    >
                      <MessageCircle className="w-5 h-5 mr-2" />
                      Start Chatting Now
                    </Button>
                  </motion.div>

                  {/* Secondary CTA */}
                  <Button
                    onClick={handleKeepVibing}
                    variant="ghost"
                    className="w-full h-12 text-muted-foreground hover:text-foreground hover:bg-white/5"
                  >
                    Keep Vibing (Back to Event)
                  </Button>

                  {/* Phone verification nudge after first match */}
                  {showPhoneNudge && (
                    <PhoneVerificationNudge
                      variant="match"
                      onDismiss={() => {
                        localStorage.setItem("vibely_phone_nudge_match_dismissed", "true");
                        setShowPhoneNudge(false);
                      }}
                      onVerified={() => setShowPhoneNudge(false)}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Floating Particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  background: ["#8B5CF6", "#EC4899", "#06B6D4", "#FFD700"][i % 4],
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                }}
                animate={{
                  y: [0, -30, 0],
                  opacity: [0.3, 0.8, 0.3],
                  scale: [1, 1.5, 1],
                }}
                transition={{
                  duration: 2 + Math.random() * 2,
                  repeat: Infinity,
                  delay: Math.random() * 2,
                }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MatchSuccessModal;
