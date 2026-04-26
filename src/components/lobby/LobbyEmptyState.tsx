import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Sparkles, RefreshCw, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";

interface LobbyEmptyStateProps {
  eventId: string | undefined;
  onRefresh: () => void;
  badge?: string;
  title?: string;
  message?: string;
}

const LobbyEmptyState = ({ eventId, onRefresh, badge, title, message }: LobbyEmptyStateProps) => {
  const impressionRef = useRef(false);

  useEffect(() => {
    impressionRef.current = false;
  }, [eventId]);

  useEffect(() => {
    if (!eventId || impressionRef.current) return;
    impressionRef.current = true;
    trackEvent(LobbyPostDateEvents.LOBBY_EMPTY_STATE_IMPRESSION, {
      platform: "web",
      event_id: eventId,
    });
  }, [eventId]);

  const handleRefresh = () => {
    if (eventId) {
      trackEvent(LobbyPostDateEvents.LOBBY_EMPTY_STATE_REFRESH_TAP, {
        platform: "web",
        event_id: eventId,
      });
    }
    onRefresh();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-sm mx-auto"
    >
      <div className="relative rounded-3xl overflow-hidden border border-white/[0.12] bg-gradient-to-b from-zinc-900/90 via-zinc-950 to-black p-8 sm:p-10 text-center shadow-[0_0_60px_-12px_hsl(var(--neon-violet)/0.35)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(var(--neon-violet) / 0.14) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 100% 100%, hsl(var(--neon-cyan) / 0.08) 0%, transparent 50%)",
          }}
        />

        <div className="relative space-y-6">
          <motion.div
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="w-20 h-20 mx-auto rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center backdrop-blur-sm"
          >
            <Sparkles className="w-9 h-9 text-primary" strokeWidth={1.5} />
          </motion.div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/60 mx-auto">
              <Radio className="w-3 h-3 text-neon-cyan" />
              {badge ?? "Deck clear"}
            </div>
            <h3 className="text-xl font-display font-bold text-white tracking-tight">
              {title ?? "You&apos;ve seen everyone for now"}
            </h3>
            <p className="text-sm text-white/55 leading-relaxed">
              {message ??
                "More people may join the room — your deck refreshes every few seconds. Tap refresh if you don&apos;t want to wait."}
            </p>
          </div>

          <Button
            variant="outline"
            size="default"
            onClick={handleRefresh}
            className="gap-2 border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08] hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh now
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default LobbyEmptyState;
