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

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Play, RefreshCw, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHeroVideoUpload } from "@/hooks/useHeroVideoUpload";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { useMediaAsset } from "@/hooks/useMediaAsset";
import { isProfileVibeVideoRef } from "@/lib/mediaAssetResolver";

interface ProfileSnap {
  id?: string | null;
  bunnyVideoUid?: string | null;
  bunnyVideoStatus?: string | null;
  bunnyVideoUpdatedAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
  vibeVideoPlaybackRef?: string | null;
  playbackRef?: string | null;
  vibeCaption?: string | null;
}

interface HeroVideoStatusCardProps {
  /** Current profile data — used when controller is idle */
  profile: ProfileSnap | null;
  /** Open the recorder modal / page */
  onOpenRecorder: () => void;
  /** Open the fullscreen HLS player */
  onOpenPlayer?: () => void;
  onRefresh?: () => void;
  className?: string;
}

export function HeroVideoStatusCard({
  profile,
  onOpenRecorder,
  onOpenPlayer,
  onRefresh,
  className,
}: HeroVideoStatusCardProps) {
  const ctrl = useHeroVideoUpload();
  const [thumbErr, setThumbErr] = useState(false);

  const backendInfo = resolveWebVibeVideoState(
    profile
      ? {
          bunny_video_uid: profile.bunnyVideoUid,
          bunny_video_status: profile.bunnyVideoStatus,
          id: profile.id,
          playbackRef: profile.vibeVideoPlaybackRef ?? profile.playbackRef,
          bunnyVideoUpdatedAt: profile.bunnyVideoUpdatedAt,
          updatedAt: profile.updatedAt,
          vibe_caption: profile.vibeCaption,
        }
      : null,
  );
  const controllerInfo = resolveWebVibeVideoState(
    ctrl.videoId
      ? {
          bunny_video_uid: ctrl.videoId,
          bunny_video_status: ctrl.phase,
          id: profile?.id,
          vibe_caption: profile?.vibeCaption,
        }
      : null,
  );

  // Effective phase: controller overrides profile when it has an active session
  const controllerIsActive =
    ctrl.phase === "uploading" || ctrl.phase === "processing";
  const controllerIsTerminal =
    ctrl.phase === "ready" || ctrl.phase === "failed" || ctrl.phase === "stalled";

  const effectivePhase =
    controllerIsActive || controllerIsTerminal ? ctrl.phase : backendInfo.state;
  const effectiveReadyInfo = ctrl.phase === "ready" && controllerInfo.uid ? controllerInfo : backendInfo;
  const signedProfileVibeVideoRef = isProfileVibeVideoRef(effectiveReadyInfo.playbackUrl)
    ? effectiveReadyInfo.playbackUrl
    : null;
  const { posterUrl: signedPosterUrl } = useMediaAsset({
    kind: "profile_vibe_video",
    sourceRef: signedProfileVibeVideoRef,
    initialUrl: null,
    autoResolve: !!signedProfileVibeVideoRef,
    enabled: effectivePhase === "ready" && !!signedProfileVibeVideoRef,
  });
  const displayThumbnailUrl = signedProfileVibeVideoRef
    ? signedPosterUrl
    : effectiveReadyInfo.thumbnailUrl;

  // Reset thumbnail error when the displayed video identity or signed poster URL changes.
  useEffect(() => {
    setThumbErr(false);
  }, [effectiveReadyInfo.uid, displayThumbnailUrl]);

  // ── Ready ──────────────────────────────────────────────────────────────────
  if (effectivePhase === "ready") {
    const info = effectiveReadyInfo;
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
          {displayThumbnailUrl && !thumbErr ? (
            <img
              src={displayThumbnailUrl}
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
            {isPlayable ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-300" />
            )}
            <span
              className={cn(
                "text-[11px] font-semibold tracking-wide",
                isPlayable ? "text-emerald-300" : "text-amber-200",
              )}
            >
              {isPlayable ? "READY" : "NEEDS CHECK"}
            </span>
          </div>
        </div>

        {!isPlayable && (
          <div className="px-4 py-3 border-t border-amber-500/20 bg-amber-500/5">
            <p className="text-sm font-semibold text-amber-100">
              Video saved, playback needs attention
            </p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              Your Vibe Video is still saved, but playback is not available right now. Try again later or replace it.
            </p>
          </div>
        )}

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
          You can navigate freely — the upload continues in the background.
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
              Your video uploaded and is still processing. This can take a few minutes. We'll keep checking.
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          You can leave this page — processing continues on our servers.
        </p>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-violet-200 hover:text-violet-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh status
          </button>
        ) : null}
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

  // ── Stalled ────────────────────────────────────────────────────────────────
  if (effectivePhase === "stalled") {
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-amber-500/25 p-5", className)}>
        <div className="flex items-start gap-3 mb-3">
          <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Still preparing your Vibe Video</p>
            <p className="text-xs text-gray-400 mt-0.5 break-words">
              {ctrl.errorMessage ?? "This is taking longer than usual. Your video is still on file."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh ?? onOpenRecorder}
          className="flex items-center gap-1.5 text-xs font-semibold text-amber-200 hover:text-amber-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {onRefresh ? "Retry status check" : "Replace video"}
        </button>
      </div>
    );
  }

  // ── Profile-sourced in-pipeline state when controller is idle.
  if (backendInfo.state === "processing" || backendInfo.state === "stale_processing") {
    const isStale = backendInfo.state === "stale_processing";
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-violet-500/20 p-5", isStale && "border-amber-500/25", className)}>
        <div className="flex items-start gap-3">
          {isStale ? (
            <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
          ) : (
            <Loader2 className="w-5 h-5 text-violet-300 animate-spin flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className="text-sm font-semibold text-white">
              {isStale ? "Still processing your Vibe Video" : "Processing your Vibe Video"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {isStale
                ? "Still processing. You can refresh, try again later, or re-upload if it does not finish."
                : "Your video uploaded and is still processing. This can take a few minutes. We'll keep checking."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1.5 text-xs font-semibold text-violet-200 hover:text-violet-100 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh status
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenRecorder}
            className="flex items-center gap-1.5 text-xs font-semibold text-violet-200 hover:text-violet-100 transition-colors"
          >
            <Video className="w-3.5 h-3.5" />
            Open Studio
          </button>
        </div>
      </div>
    );
  }

  // ── Backend inconsistency / resolver error ─────────────────────────────────
  if (backendInfo.state === "error") {
    return (
      <div className={cn("rounded-2xl bg-white/5 border border-amber-500/25 p-5", className)}>
        <div className="flex items-start gap-3 mb-3">
          <AlertCircle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Vibe Video needs attention</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              We found video status without the video ID needed for playback. You did nothing wrong; record again to repair it.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenRecorder}
          className="flex items-center gap-1.5 text-xs font-semibold text-amber-200 hover:text-amber-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Record again
        </button>
      </div>
    );
  }

  // ── None — invite to create ───────────────────────────────────────────────
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
