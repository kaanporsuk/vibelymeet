import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Sparkles, X } from "lucide-react";
import { useReadyGate } from "@/hooks/useReadyGate";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { toast } from "sonner";

interface ReadyGateOverlayProps {
  sessionId: string;
  eventId: string;
  onClose: () => void;
}

const GATE_TIMEOUT = 30;

const ReadyGateOverlay = ({ sessionId, eventId, onClose }: ReadyGateOverlayProps) => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { setStatus } = useEventStatus({ eventId, enabled: !!eventId && !!user?.id });

  const [partnerPhotos, setPartnerPhotos] = useState<string[] | null>(null);
  const [partnerAvatarUrl, setPartnerAvatarUrl] = useState<string | null>(null);
  const [sharedVibes, setSharedVibes] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const closedRef = useRef(false);

  const handleBothReady = useCallback(() => {
    if (closedRef.current) return;
    setIsTransitioning(true);
    setStatus("in_date");
    setTimeout(() => {
      navigate(`/date/${sessionId}`);
    }, 1200);
  }, [navigate, sessionId, setStatus]);

  const handleForfeited = useCallback(
    (reason: "timeout" | "skip") => {
      if (closedRef.current) return;
      closedRef.current = true;
      setStatus("browsing");
      toast(
        reason === "timeout"
          ? "They weren't ready — back to browsing!"
          : "No worries! Back to browsing 💚",
        { duration: 2500 }
      );
      onClose();
    },
    [setStatus, onClose]
  );

  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    markReady,
    skip,
    snooze,
  } = useReadyGate({
    sessionId,
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  // Set status to in_ready_gate on mount
  useEffect(() => {
    setStatus("in_ready_gate");
  }, [setStatus]);

  // Fetch partner photo + shared vibes
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    (async () => {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!session) return;

      const partnerId =
        session.participant_1_id === user.id
          ? session.participant_2_id
          : session.participant_1_id;

      // Partner photo
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url, photos")
        .eq("id", partnerId)
        .maybeSingle();

      if (profile) {
        setPartnerPhotos((profile.photos as string[]) || null);
        setPartnerAvatarUrl(profile.avatar_url || null);
      }

      // Shared vibes
      const [{ data: myVibes }, { data: partnerVibes }] = await Promise.all([
        supabase
          .from("profile_vibes")
          .select("vibe_tags(label, emoji)")
          .eq("profile_id", user.id),
        supabase
          .from("profile_vibes")
          .select("vibe_tags(label, emoji)")
          .eq("profile_id", partnerId),
      ]);

      if (myVibes && partnerVibes) {
        const myLabels = new Set(
          myVibes
            .map((v) => {
              const raw = v.vibe_tags as { label: string } | { label: string }[] | null;
              const tag = Array.isArray(raw) ? raw[0] : raw;
              return tag?.label;
            })
            .filter(Boolean)
        );
        const shared = partnerVibes
          .map((v) => {
            const raw = v.vibe_tags as { label: string; emoji: string } | { label: string; emoji: string }[] | null;
            const tag = Array.isArray(raw) ? raw[0] : raw;
            return tag && myLabels.has(tag.label) ? `${tag.emoji ?? ''} ${tag.label}`.trim() : null;
          })
          .filter(Boolean) as string[];
        setSharedVibes(shared);
      }
    })();
  }, [sessionId, user?.id]);

  // Countdown timer (only when user hasn't pressed ready yet)
  useEffect(() => {
    if (isTransitioning || iAmReady || snoozedByPartner) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          skip();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isTransitioning, iAmReady, snoozedByPartner, skip]);

  const progress = timeLeft / GATE_TIMEOUT;
  const ringSize = 96;
  const strokeWidth = 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => {}} />

      {/* Transitioning to video */}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-10 bg-background flex items-center justify-center"
          >
            <div className="text-center space-y-4">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Sparkles className="w-12 h-12 text-primary mx-auto" />
              </motion.div>
              <p className="text-lg font-display font-semibold text-foreground">
                Connecting your vibe date...
              </p>
              <p className="text-sm text-muted-foreground">Get ready to shine ✨</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card */}
      <motion.div
        initial={{ y: 100, scale: 0.95, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 100, scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-white/10 overflow-hidden mb-4 sm:mb-0"
        style={{
          background:
            "linear-gradient(145deg, hsl(var(--card)), hsl(var(--card) / 0.95))",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="p-6 space-y-5">
          {/* Heading */}
          <div className="text-center space-y-1">
            <h2 className="text-xl font-display font-bold text-foreground">
              Ready to vibe?
            </h2>
            <p className="text-sm text-muted-foreground">
              You matched with {partnerName || "someone"}!
            </p>
          </div>

          {/* Blurred partner photo */}
          <div className="flex justify-center">
            <div className="relative w-28 h-28 rounded-full overflow-hidden border-2 border-primary/30">
              <div style={{ filter: "blur(15px)" }}>
                <ProfilePhoto
                  photos={partnerPhotos}
                  avatarUrl={partnerAvatarUrl}
                  name={partnerName || "Match"}
                  size="full"
                  rounded="full"
                  loading="eager"
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <span className="text-white font-display font-semibold text-sm">
                  {partnerName || "Match"}
                </span>
              </div>
            </div>
          </div>

          {/* Shared vibes */}
          {sharedVibes.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {sharedVibes.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Partner ready indicator */}
          <AnimatePresence>
            {partnerReady && !iAmReady && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 py-2"
              >
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400 font-medium">
                  {partnerName} is ready!
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Snoozed by partner */}
          <AnimatePresence>
            {snoozedByPartner && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-center gap-2 py-2"
              >
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {partnerName} needs a moment...
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action area */}
          {!iAmReady ? (
            <div className="space-y-3">
              {/* Ready button with countdown ring */}
              <div className="flex justify-center">
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={markReady}
                  className="relative"
                >
                  <svg
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                    className="absolute inset-0 -rotate-90"
                  >
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth={strokeWidth}
                      opacity={0.3}
                    />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={radius}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      className="transition-all duration-1000 linear"
                    />
                  </svg>
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30">
                    <span className="text-sm font-display font-bold text-primary-foreground text-center leading-tight">
                      I'm
                      <br />
                      Ready ✨
                    </span>
                  </div>
                </motion.button>
              </div>

              {/* Skip */}
              <button
                onClick={() => {
                  closedRef.current = true;
                  skip();
                  setStatus("browsing");
                  onClose();
                }}
                className="block mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip this one
              </button>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary/10 border border-primary/20"
              >
                <Check className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  Waiting for {partnerName}...
                </span>
              </motion.div>
              <button
                onClick={() => {
                  closedRef.current = true;
                  skip();
                  setStatus("browsing");
                  onClose();
                }}
                className="block mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel & go back
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ReadyGateOverlay;
