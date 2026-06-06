import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  showAction?: boolean;
  actionLabel?: string;
  showRefreshIcon?: boolean;
  onAction?: () => void;
  showMysteryMatch?: boolean;
  isMysterySearching?: boolean;
  isMysteryWaiting?: boolean;
  onMysteryMatch?: () => void;
  onCancelMysteryMatch?: () => void;
}

const LobbyEmptyState = ({
  eventId,
  onRefresh,
  badge,
  title,
  message,
  showAction = true,
  actionLabel = "Refresh now",
  showRefreshIcon = true,
  onAction,
  showMysteryMatch = false,
  isMysterySearching = false,
  isMysteryWaiting = false,
  onMysteryMatch,
  onCancelMysteryMatch,
}: LobbyEmptyStateProps) => {
  const impressionRef = useRef(false);
  const mysteryImpressionRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const canShowMysteryMatch = showMysteryMatch && Boolean(onMysteryMatch);

  useEffect(() => {
    impressionRef.current = false;
  }, [eventId]);

  useEffect(() => {
    mysteryImpressionRef.current = false;
  }, [eventId, canShowMysteryMatch]);

  useEffect(() => {
    if (!eventId || impressionRef.current) return;
    impressionRef.current = true;
    trackEvent(LobbyPostDateEvents.LOBBY_EMPTY_STATE_IMPRESSION, {
      platform: "web",
      event_id: eventId,
    });
  }, [eventId]);

  useEffect(() => {
    if (
      !eventId ||
      !canShowMysteryMatch ||
      isMysteryWaiting ||
      mysteryImpressionRef.current
    ) {
      return;
    }
    mysteryImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.MYSTERY_MATCH_CTA_IMPRESSION, {
      platform: "web",
      event_id: eventId,
    });
  }, [canShowMysteryMatch, eventId, isMysteryWaiting]);

  const handleRefresh = () => {
    if (eventId) {
      trackEvent(LobbyPostDateEvents.LOBBY_EMPTY_STATE_REFRESH_TAP, {
        platform: "web",
        event_id: eventId,
      });
    }
    onRefresh();
  };

  const handleMysteryMatch = () => {
    if (eventId) {
      trackEvent(LobbyPostDateEvents.MYSTERY_MATCH_CTA_TAP, {
        platform: "web",
        event_id: eventId,
      });
    }
    onMysteryMatch?.();
  };

  const displayBadge = isMysteryWaiting ? "Still checking" : (badge ?? "Deck clear");
  const displayTitle = isMysteryWaiting ? "Hang tight!" : (title ?? "You've seen everyone for now");
  const displayMessage = isMysteryWaiting
    ? "New people may join the event. We'll refresh your deck automatically."
    : (message ??
      "More people may join the room — your deck refreshes every few seconds. Tap refresh if you don't want to wait.");

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={prefersReducedMotion ? { duration: 0.12 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-sm mx-auto"
    >
      <div className="relative min-h-[320px] rounded-3xl overflow-hidden border border-white/[0.12] bg-gradient-to-b from-zinc-900/90 via-zinc-950 to-black p-8 sm:p-10 text-center shadow-[0_0_60px_-12px_hsl(var(--neon-violet)/0.35)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(var(--neon-violet) / 0.14) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 100% 100%, hsl(var(--neon-cyan) / 0.08) 0%, transparent 50%)",
          }}
        />

        <div className="relative space-y-6">
          <motion.div
            animate={prefersReducedMotion ? undefined : { scale: [1, 1.03, 1] }}
            transition={prefersReducedMotion ? undefined : { duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="w-20 h-20 mx-auto rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center backdrop-blur-sm"
            aria-hidden="true"
          >
            <Sparkles className="w-9 h-9 text-primary" strokeWidth={1.5} />
          </motion.div>

          <div className="min-w-0 space-y-2" role="status" aria-live="polite">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/60 mx-auto">
              <Radio className="w-3 h-3 text-neon-cyan" />
              {displayBadge}
            </div>
            <h3 className="text-xl font-display font-bold text-white tracking-tight break-words">
              {displayTitle}
            </h3>
            <p className="text-sm text-white/55 leading-relaxed break-words">
              {displayMessage}
            </p>
          </div>

          {isMysteryWaiting ? (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Checking for new arrivals...
              </div>
              <Button
                variant="ghost"
                size="default"
                onClick={onCancelMysteryMatch}
                className="min-h-11 whitespace-normal text-white/70 hover:bg-white/[0.06] hover:text-white"
              >
                No thanks, I'll wait
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {showAction ? (
                <Button
                  variant="outline"
                  size="default"
                  onClick={onAction ?? handleRefresh}
                  className="min-h-11 gap-2 whitespace-normal border-white/20 bg-white/[0.04] text-white hover:bg-white/[0.08] hover:text-white"
                >
                  {showRefreshIcon ? <RefreshCw className="w-4 h-4" /> : null}
                  {actionLabel}
                </Button>
              ) : null}
              {canShowMysteryMatch ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  onClick={handleMysteryMatch}
                  disabled={isMysterySearching}
                  className="min-h-11 gap-2 whitespace-normal border border-white/10 bg-white/[0.03] px-4 text-white/80 hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  {isMysterySearching
                    ? "Finding match..."
                    : "Mystery Match (optional)"}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default LobbyEmptyState;
