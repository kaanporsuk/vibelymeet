import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Play, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import type { PeerMissingState, RemotePlaybackState } from "@/hooks/useVideoCall";

interface ConnectionOverlayProps {
  isConnecting: boolean;
  remotePlayback?: RemotePlaybackState;
  peerMissing?: PeerMissingState;
  onRetryRemotePlayback?: () => void;
  onRetryPeerMissing?: () => void;
  onKeepWaitingPeerMissing?: () => void;
  onLeave: () => void;
  isLeaving?: boolean;
  partnerName?: string | null;
  partnerAvatarUrl?: string | null;
}

export const ConnectionOverlay = ({
  isConnecting,
  remotePlayback,
  peerMissing,
  onRetryRemotePlayback,
  onRetryPeerMissing,
  onKeepWaitingPeerMissing,
  onLeave,
  isLeaving = false,
  partnerName,
  partnerAvatarUrl,
}: ConnectionOverlayProps) => {
  const playbackRejected = Boolean(remotePlayback?.playRejected);
  const peerMissingTerminal = Boolean(peerMissing?.terminal);
  const openingPartnerName = isConnecting && partnerName?.trim() ? partnerName.trim() : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-2xl z-50"
    >
      <div className="max-w-sm space-y-6 rounded-[2rem] border border-white/10 bg-black/40 px-7 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.08)]">
        {/* Animated rings */}
        <div className="relative w-24 h-24 mx-auto">
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-primary/30"
            animate={{ scale: [1, 1.5, 1.5], opacity: [0.6, 0, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-primary/30"
            animate={{ scale: [1, 1.5, 1.5], opacity: [0.6, 0, 0] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.6,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 border border-primary/25 flex items-center justify-center shadow-[0_0_32px_hsl(var(--primary)/0.24)]">
              {isConnecting && openingPartnerName ? (
                <>
                  <ProfilePhoto
                    avatarUrl={partnerAvatarUrl}
                    name={openingPartnerName}
                    size="full"
                    rounded="full"
                    loading="eager"
                    className="h-full w-full border border-primary/35 shadow-[0_0_28px_hsl(var(--primary)/0.18)]"
                  />
                  <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/75 shadow-[0_0_18px_hsl(var(--primary)/0.22)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  </span>
                </>
              ) : isConnecting ? (
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
              ) : playbackRejected ? (
                <Play className="w-7 h-7 text-primary" />
              ) : (
                <Wifi className="w-7 h-7 text-primary" />
              )}
            </div>
          </div>
        </div>

        <div>
          {isConnecting && openingPartnerName && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/85">
              You're both ready
            </p>
          )}
          <h3 className="font-display font-semibold text-lg text-foreground mb-1">
            {peerMissingTerminal
              ? "They may need a little more time."
              : playbackRejected
                ? "Tap to gently resume"
                : isConnecting
                  ? "Opening the room..."
                  : "Holding the room for them..."}
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {peerMissingTerminal
              ? "You can try reconnecting, keep waiting a little longer, or return to the lobby."
              : playbackRejected
              ? "Your match is here, but your browser paused the video or audio."
              : isConnecting
                ? openingPartnerName
                  ? `Setting up a quiet start with ${openingPartnerName}.`
                  : "Setting up a quiet start for your video date."
                : "We'll keep the space ready and let you continue calmly if they need too long."}
          </p>
        </div>

        {playbackRejected && onRetryRemotePlayback && (
          <Button
            type="button"
            onClick={onRetryRemotePlayback}
            disabled={isLeaving}
            className="rounded-full px-6"
          >
            <Play className="w-4 h-4 mr-2" />
            Resume audio/video
          </Button>
        )}

        {peerMissingTerminal && (
          <div className="flex flex-col gap-2">
            {onRetryPeerMissing && (
              <Button
                type="button"
                onClick={onRetryPeerMissing}
                disabled={isLeaving}
                className="rounded-full px-6"
              >
                Try reconnecting
              </Button>
            )}
            {onKeepWaitingPeerMissing && (
              <Button
                type="button"
                variant="secondary"
                onClick={onKeepWaitingPeerMissing}
                disabled={isLeaving}
                className="rounded-full px-6"
              >
                Keep waiting
              </Button>
            )}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={onLeave}
          disabled={isLeaving}
          className="rounded-full px-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {isLeaving ? "Leaving..." : "Leave"}
        </Button>
      </div>
    </motion.div>
  );
};
