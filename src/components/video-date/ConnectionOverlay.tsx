import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Play, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PeerMissingState, RemotePlaybackState } from "@/hooks/useVideoCall";

interface ConnectionOverlayProps {
  isConnecting: boolean;
  remotePlayback?: RemotePlaybackState;
  peerMissing?: PeerMissingState;
  onRetryRemotePlayback?: () => void;
  onRetryPeerMissing?: () => void;
  onKeepWaitingPeerMissing?: () => void;
  onLeave: () => void;
}

export const ConnectionOverlay = ({
  isConnecting,
  remotePlayback,
  peerMissing,
  onRetryRemotePlayback,
  onRetryPeerMissing,
  onKeepWaitingPeerMissing,
  onLeave,
}: ConnectionOverlayProps) => {
  const playbackRejected = Boolean(remotePlayback?.playRejected);
  const peerMissingTerminal = Boolean(peerMissing?.terminal);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-md z-50"
    >
      <div className="text-center space-y-6 px-8 max-w-xs">
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
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              {isConnecting ? (
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
          <h3 className="font-display font-semibold text-lg text-foreground mb-1">
            {peerMissingTerminal
              ? "They may need a little more time."
              : playbackRejected
                ? "Tap to gently resume"
                : isConnecting
                  ? "Opening the room..."
                  : "Holding the room for them..."}
          </h3>
          <p className="text-sm text-muted-foreground">
            {peerMissingTerminal
              ? "You can try reconnecting, keep waiting a little longer, or return to the lobby."
              : playbackRejected
              ? "Your match is here, but your browser paused the video or audio."
              : isConnecting
                ? "Setting up a quiet start for your video date."
                : "We'll keep the space ready and let you continue calmly if they need too long."}
          </p>
        </div>

        {playbackRejected && onRetryRemotePlayback && (
          <Button
            type="button"
            onClick={onRetryRemotePlayback}
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
                className="rounded-full px-6"
              >
                Keep waiting
              </Button>
            )}
          </div>
        )}

        <Button
          variant="outline"
          onClick={onLeave}
          className="rounded-full px-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Leave
        </Button>
      </div>
    </motion.div>
  );
};
