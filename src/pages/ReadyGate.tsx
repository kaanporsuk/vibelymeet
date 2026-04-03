import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Heart, Loader2, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useReadyGate } from "@/hooks/useReadyGate";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { trackEvent } from "@/lib/analytics";

interface PartnerProfile {
  name: string;
  age: number;
  about_me?: string;
  avatarUrl?: string;
  photos?: string[];
  tags: string[];
  
}

const GATE_TIMEOUT = 30; // seconds

const ReadyGate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useUserProfile();
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const { setStatus } = useEventStatus({ eventId });

  const [partner, setPartner] = useState<PartnerProfile>({
    name: "Your date",
    age: 0,
    tags: [],
  });
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeTimeLeft, setSnoozeTimeLeft] = useState(120);

  const handleBothReady = useCallback(() => {
    setIsTransitioning(true);
    // queue_status stays in_ready_gate until VideoDate succeeds at enter_handshake (server sets in_handshake)
    toast.success("Both ready! Connecting... 💚", { duration: 1500 });
    setTimeout(() => {
      navigate(`/date/${id}`);
    }, 1500);
  }, [navigate, id, setStatus]);

  const handleForfeited = useCallback(
    (reason: "timeout" | "skip") => {
      setStatus("browsing");
      toast("They had to step away — back to the deck! More people to meet 💚", {
        duration: 3000,
      });
      if (eventId) {
        setTimeout(() => navigate(`/event/${eventId}/lobby`), 2000);
      } else {
        setTimeout(() => navigate("/home"), 2000);
      }
    },
    [navigate, setStatus, eventId]
  );

  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    snoozeExpiresAt,
    markReady,
    skip,
    snooze,
  } = useReadyGate({
    sessionId: id || "",
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  // Fetch partner profile
  useEffect(() => {
    if (!id || !user?.id) return;

    const fetchPartner = async () => {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, event_id")
        .eq("id", id)
        .maybeSingle();

      if (!session) return;

      if (session.event_id) setEventId(session.event_id);

      const partnerId =
        session.participant_1_id === user.id
          ? session.participant_2_id
          : session.participant_1_id;

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, age, avatar_url, photos, about_me")
        .eq("id", partnerId)
        .maybeSingle();

      if (profile) {
        const { data: vibes } = await supabase
          .from("profile_vibes")
          .select("vibe_tags(label, emoji)")
          .eq("profile_id", partnerId);

        const tags =
          vibes
            ?.map((v: any) => `${v.vibe_tags?.emoji || ""} ${v.vibe_tags?.label || ""}`.trim())
            .filter(Boolean) || [];

        const rawPhotos = (profile.photos as string[]) || [];
        const resolvedPhotos = rawPhotos.map(p => resolvePhotoUrl(p)).filter(Boolean);

        setPartner({
          name: profile.name,
          age: profile.age,
          about_me: profile.about_me || undefined,
          avatarUrl: resolvePhotoUrl(profile.avatar_url) || undefined,
          photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
          tags,
          
        });
      }
    };

    fetchPartner();
  }, [id, user?.id]);

  // Countdown timer
  useEffect(() => {
    if (isTransitioning || iAmReady) return;

    if (snoozedByPartner) {
      setIsSnoozed(true);
      if (snoozeExpiresAt) {
        const remaining = Math.max(
          0,
          Math.floor((new Date(snoozeExpiresAt).getTime() - Date.now()) / 1000)
        );
        setSnoozeTimeLeft(remaining);
      }
      return;
    }

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
  }, [isTransitioning, iAmReady, snoozedByPartner, snoozeExpiresAt, skip]);

  // Snooze countdown
  useEffect(() => {
    if (!isSnoozed) return;

    const interval = setInterval(() => {
      setSnoozeTimeLeft((prev) => {
        if (prev <= 1) {
          skip();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSnoozed, skip]);

  const allPhotos = partner.photos?.length
    ? partner.photos
    : partner.avatarUrl
    ? [partner.avatarUrl]
    : [];

  const progress = timeLeft / GATE_TIMEOUT;
  const ringSize = 80;
  const strokeWidth = 4;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="fixed inset-0 bg-background flex flex-col overflow-y-auto">
      {/* Transitioning overlay */}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-background flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              >
                <Loader2 className="w-12 h-12 text-primary mx-auto" />
              </motion.div>
              <p className="mt-4 text-lg font-display font-semibold text-foreground">
                Connecting...
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Your video date is about to start
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Partner Profile Section ─── */}
      <div className="flex-1 px-4 pt-6 pb-4 space-y-5 max-w-md mx-auto w-full">
        {/* Photo Gallery */}
        {allPhotos.length > 0 && (
          <div className="relative aspect-[3/4] max-h-[360px] rounded-3xl overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.img
                key={photoIndex}
                src={allPhotos[photoIndex]}
                alt={partner.name}
                className="w-full h-full object-cover"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              />
            </AnimatePresence>

            {/* Photo navigation */}
            {allPhotos.length > 1 && (
              <>
                <div className="absolute top-3 left-0 right-0 flex justify-center gap-1.5 z-10">
                  {allPhotos.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 rounded-full transition-all ${
                        i === photoIndex
                          ? "w-6 bg-white"
                          : "w-1.5 bg-white/40"
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setPhotoIndex((p) => Math.max(0, p - 1))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
                >
                  <ChevronLeft className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={() =>
                    setPhotoIndex((p) => Math.min(allPhotos.length - 1, p + 1))
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
                >
                  <ChevronRight className="w-4 h-4 text-white" />
                </button>
              </>
            )}

            {/* Name overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
              <h2 className="text-2xl font-display font-bold text-white">
                {partner.name}
                {partner.age > 0 && (
                  <span className="font-normal text-white/70 ml-2">{partner.age}</span>
                )}
              </h2>
            </div>
          </div>
        )}

        {/* Bio */}
        {partner.about_me && (
          <p className="text-sm text-muted-foreground leading-relaxed">{partner.about_me}</p>
        )}

        {/* Vibe Tags */}
        {partner.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {partner.tags.map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}


        {/* Community Message */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl p-4 border border-primary/20"
          style={{
            background: "linear-gradient(135deg, hsl(263 70% 66% / 0.08), hsl(330 81% 60% / 0.05))",
          }}
        >
          <div className="flex items-start gap-3">
            <Heart className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
            <p className="text-sm text-foreground/80 leading-relaxed">
              Vibely is a space for kind, curious people getting to know each other.
              Be yourself. Be respectful. Unacceptable rude behavior will result in a ban.
            </p>
          </div>
        </motion.div>

        {/* Partner ready indicator */}
        <AnimatePresence>
          {partnerReady && !iAmReady && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-3 rounded-xl flex items-center gap-2"
            >
              <Check className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">
                {partnerName || "Your match"} is ready and waiting!
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Snoozed by partner */}
        <AnimatePresence>
          {snoozedByPartner && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-3 rounded-xl flex items-center gap-2"
            >
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">
                {partnerName} needs a moment — they'll be right back!
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {Math.floor(snoozeTimeLeft / 60)}:{String(snoozeTimeLeft % 60).padStart(2, "0")}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Bottom Action Bar ─── */}
      <div className="sticky bottom-0 px-4 pb-safe pt-4" style={{ background: "linear-gradient(to top, hsl(var(--background)), hsl(var(--background) / 0.9), transparent)" }}>
        <div className="max-w-md mx-auto space-y-3">
          {!iAmReady ? (
            <>
              {/* Ready button with countdown ring */}
              <div className="flex justify-center">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { trackEvent('ready_gate_ready', { session_id: id }); markReady(); }}
                  className="relative"
                >
                  {/* Countdown ring */}
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
                  <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                    <span className="text-sm font-display font-bold text-primary-foreground text-center leading-tight">
                      I'm
                      <br />
                      Ready ✨
                    </span>
                  </div>
                </motion.button>
              </div>

              {/* Secondary actions */}
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => {
                    snooze();
                    setIsSnoozed(true);
                    setSnoozeTimeLeft(120);
                    toast("Take your time! Your match will wait 💚", { duration: 2000 });
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Snooze — give me 2 min
                </button>
                <span className="text-muted-foreground/30">·</span>
                <button
                  onClick={() => {
                    trackEvent('ready_gate_skipped', { session_id: id });
                    skip();
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Not ready? Skip
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="inline-flex items-center gap-2 glass-card px-6 py-3 rounded-full"
              >
                <Check className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  You're ready! Waiting for {partnerName}...
                </span>
              </motion.div>
              <button
                onClick={() => skip()}
                className="block mx-auto mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel & go back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReadyGate;
