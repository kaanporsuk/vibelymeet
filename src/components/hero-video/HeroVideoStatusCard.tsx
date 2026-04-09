/**
 * HeroVideoStatusCard — persistent hero video status shown on You / Vibe Studio.
 *
 * State priority:
 *   1. Controller active (uploading / processing) → controller owns the display
 *   2. Controller terminal (ready / failed)        → controller still owns until reset
 *   3. Controller idle                             → profile backend state
 *
 * This means the card is always correct: it reflects live upload progress while the
 * tus connection is open, then transitions to backend truth once the controller resets.
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Play, RefreshCw, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHeroVideoUpload } from "@/hooks/useHeroVideoUpload";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";

interface ProfileSnap {
  bunnyVideoUid?: string | null;
  bunnyVideoStatus?: string | null;
  vibeCaption?: string | null;
}

interface HeroVideoStatusCardProps {
  /** Current profile data — used when controller is idle */
  profile: ProfileSnap | null;
  /** Open the recorder modal / page */
  onOpenRecorder: () => void;
  /** Open the fullscreen HLS player */
  onOpenPlayer?: () => void;
  className?: string;
}

export function HeroVideoStatusCard({
  profile,
  onOpenRecorder,
  onOpenPlayer,
  className,
}: HeroVideoStatusCardProps) {
  const ctrl = useHeroVideoUpload();
  const [thumbErr, setThumbErr] = useState(false);
  const prevUidRef = useRef<string | null | undefined>(null);

  const backendInfo = resolveWebVibeVideoState(
    profile
      ? {
          bunny_video_uid: profile.bunnyVideoUid,
          bunny_video_status: profile.bunnyVideoStatus,
          vibe_caption: profile.vibeCaption,
        }
      : null,
  );

  // Reset thumbnail error when the video UID changes
  useEffect(() => {
    if (prevUidRef.current !== backendInfo.uid) {
      prevUidRef.current = backendInfo.uid;
      setThumbErr(false);
    }
  }, [backendInfo.uid]);

  // Effective phase: controller overrides profile when it has an active session
  const controllerIsActive =
    ctrl.phase === "uploading" || ctrl.phase === "processing";
  const controllerIsTerminal =
    ctrl.phase === "ready" || ctrl.phase === "failed";

  const effectivePhase =
    controllerIsActive || controllerIsTerminal ? ctrl.phase : backendInfo.state;

  // ── Ready ──────────────────────────────────────────────────────────────────
  if (effectivePhase === "ready") {
    const info = backendInfo;
    const isPlayable = info.canPlay && !!info.playbackUrl;
    return (
      <div className={cn("rounded-2xl overflow-hidden bg-white/5 border border-white/10", className)}>
        <div
          className={cn(
            "relative w-full",
            isPlayable && "cursor-pointer",
          )}
          style={{ aspectRatio: "16/9" }}
          onClick={isPlayable ? onOpenPlayer : undefined}
        >
          {info.thumbnailUrl && !thumbErr ? (
            <img
              src={info.thumbnailUrl}
              alt="Vibe Video"
              className="w-full h-full object-cover"
              onError={() => setThumbErr(true)}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-violet-900/50 to-pink-900/40 flex items-center justify-center">
              <Video className="w-10 h-10 text-white/25" />
            </div>
          )}

          {isPlayable && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenPlayer?.(); }}
                className="w-14 h-14 rounded-full bg-white/15 border border-white/25 flex items-center justify-center hover:bg-white/25 active:scale-95 transition-all"
                aria-label="Play Vibe Video"
              >
                <Play className="w-6 h-6 text-white ml-0.5" />
              </button>
            </div>
          )}

          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span className="text-[11px] font-semibold text-emerald-300 tracking-wide">READY</span>
          </div>
        </div>

        {info.caption && (
          <div className="px-4 py-3 border-t border-white/10">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400 mb-0.5">
              Vibing on
            </p>
            <p className="text-sm text-white font-medium">{info.caption}</p>
          </div>
        )}

        <div className="px-4 py-3 border-t border-white/8 flex items-center justify-between">
          <button
            type="button"
            onClick={onOpenRecorder}
            className="text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
          >
            Replace video
          </button>
          {isPlayable && (
            <button
              type="button"
              onClick={onOpenPlayer}
              className="text-xs font-medium text-violet-300 hover:text-violet-200 transition-colors"
            >
              Full screen →
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Uploading ──────────────────────────────────────────────────────────────
  if (effectivePhase === "uploading") {
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-cyan-500/25 p-5", className)}>
        <div className="flex items-start gap-3 mb-3">
          <Loader2 className="w-5 h-5 text-cyan-300 animate-spin flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Uploading your Vibe Video</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {ctrl.uploadProgress > 0
                ? `${ctrl.uploadProgress}% uploaded`
                : "Starting upload…"}
            </p>
          </div>
        </div>

        {ctrl.uploadProgress > 0 && (
          <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${ctrl.uploadProgress}%` }}
            />
          </div>
        )}

        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
          You can keep using Vibely while this uploads.
        </p>
      </div>
    );
  }

  // ── Processing ─────────────────────────────────────────────────────────────
  if (effectivePhase === "processing") {
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-violet-500/25 p-5", className)}>
        <div className="flex items-start gap-3 mb-2">
          <Loader2 className="w-5 h-5 text-violet-300 animate-spin flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-white">Processing your Vibe Video</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Preparing for playback.
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          Once uploaded, processing continues on our servers.
        </p>
      </div>
    );
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (effectivePhase === "failed") {
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-red-500/20 p-5", className)}>
        <div className="flex items-start gap-3 mb-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Upload or processing failed</p>
            <p className="text-xs text-gray-400 mt-0.5 break-words">
              {ctrl.phase === "failed" && ctrl.errorMessage
                ? ctrl.errorMessage
                : "The video did not reach a playable state."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenRecorder}
          className="flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:text-red-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      </div>
    );
  }

  // ── Profile-sourced in-pipeline states (uploading/processing from backend
  //    when controller is idle — e.g. after page reload mid-processing) ────────
  if (backendInfo.state === "uploading" || backendInfo.state === "processing") {
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-violet-500/20 p-5", className)}>
        <div className="flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-violet-300 animate-spin flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-white">
              {backendInfo.state === "uploading"
                ? "Upload in progress"
                : "Processing your Vibe Video"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Preparing for playback. Refresh to check the latest status.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── None / error — invite to create ───────────────────────────────────────
  return (
    <div
      className={cn(
        "rounded-2xl bg-white/5 border border-white/10 border-dashed p-6 flex flex-col items-center text-center gap-4",
        className,
      )}
    >
      <div className="w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
        <Video className="w-5 h-5 text-violet-300" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">No Vibe Video yet</p>
        <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">
          Give people a feel for your energy before the first chat.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenRecorder}
        className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 text-white text-sm font-semibold hover:opacity-90 active:scale-95 transition-all"
      >
        Create Vibe Video
      </button>
    </div>
  );
}
