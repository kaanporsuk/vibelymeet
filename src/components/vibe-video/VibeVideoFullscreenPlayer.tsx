import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Play, X } from "lucide-react";
import * as Sentry from "@sentry/react";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { useMediaAsset, useMediaAssetPlayback } from "@/hooks/useMediaAsset";
import { useMediaPlaybackQoE } from "@/hooks/useMediaPlaybackQoE";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { isProfileVibeVideoRef } from "@/lib/mediaAssetResolver";
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from "@/lib/vibeVideo/vibeVideoTelemetry";
import {
  captionTextFromMediaCaptions,
  mediaCaptionLanguage,
  mediaCaptionsToWebVtt,
  type MediaCaptions,
} from "../../../shared/media/captions";

type Props = {
  show: boolean;
  bunnyVideoUid: string | null;
  bunnyVideoStatus: string;
  playbackRef?: string | null;
  profileId?: string | null;
  vibeCaption: string;
  captions?: MediaCaptions | null;
  onClose: () => void;
};

const MAX_HLS_AUTH_REFRESH_ATTEMPTS = 2;

/**
 * Fullscreen HLS playback (Safari native + hls.js elsewhere) with honest error overlay
 * when the stream is "ready" in DB but manifest/media fails.
 */
export function VibeVideoFullscreenPlayer({
  show,
  bunnyVideoUid,
  bunnyVideoStatus,
  playbackRef = null,
  profileId = null,
  vibeCaption,
  captions = null,
  onClose,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackSucceededRef = useRef(false);
  const hlsAuthRefreshAttemptCountRef = useRef(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [manualPlaybackRequested, setManualPlaybackRequested] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [captionTrackUrl, setCaptionTrackUrl] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const vibeVideoInfo = resolveWebVibeVideoState({
    id: profileId,
    bunny_video_uid: bunnyVideoUid,
    bunny_video_status: bunnyVideoStatus,
    playbackRef,
    vibe_caption: vibeCaption,
  });
  const isReady = vibeVideoInfo.state === "ready" && !!vibeVideoInfo.uid;
  const usesSignedProfileRef = isProfileVibeVideoRef(vibeVideoInfo.playbackUrl);
  const {
    url: mediaAssetUrl,
    posterUrl: mediaAssetPosterUrl,
    status: mediaAssetStatus,
    refresh: refreshMediaAsset,
  } = useMediaAsset({
    kind: usesSignedProfileRef ? "profile_vibe_video" : "vibe_video",
    sourceRef: vibeVideoInfo.playbackUrl,
    initialUrl: usesSignedProfileRef ? null : vibeVideoInfo.playbackUrl,
    autoResolve: usesSignedProfileRef,
    enabled: show && isReady,
  });
  const playbackUrl = mediaAssetUrl ?? (usesSignedProfileRef ? null : vibeVideoInfo.playbackUrl);
  const captionText = captionTextFromMediaCaptions(captions);
  const captionLanguage = mediaCaptionLanguage(captions) ?? "und";
  const shouldAttachPlayback = !prefersReducedMotion || manualPlaybackRequested;
  const shouldPlayOnAttach = !prefersReducedMotion || manualPlaybackRequested;

  useEffect(() => {
    const vtt = mediaCaptionsToWebVtt(captions, 15_000);
    if (!vtt) {
      setCaptionTrackUrl(null);
      return;
    }
    const blobUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setCaptionTrackUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [captions]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) {
      track.mode = showCaptions ? "showing" : "disabled";
    }
  }, [captionTrackUrl, showCaptions]);

  const reportSucceeded = useCallback(() => {
    if (playbackSucceededRef.current) return;
    playbackSucceededRef.current = true;
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackSucceeded, {
      source: "vibe_player_fullscreen",
      video_guid: vibeVideoInfo.uid,
    });
  }, [vibeVideoInfo.uid]);

  const reportPlaybackError = useCallback((kind: "native" | "unsupported" | "fatal", detail?: unknown) => {
    setPlaybackFailed(true);
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackFailed, {
      source: "vibe_player_fullscreen",
      kind,
      video_guid: vibeVideoInfo.uid,
    });
    Sentry.addBreadcrumb({
      category: "vibe-video-playback",
      message: kind === "fatal" ? "fullscreen_hls_fatal" : "fullscreen_video_element_error",
      level: "error",
      data: { surface: "fullscreen", kind, detail: kind === "fatal" ? (detail as { type?: unknown })?.type : undefined },
    });
  }, [vibeVideoInfo.uid]);

  useEffect(() => {
    setPlaybackFailed(false);
    playbackSucceededRef.current = false;
    hlsAuthRefreshAttemptCountRef.current = 0;
    setManualPlaybackRequested(false);
  }, [show, vibeVideoInfo.playbackUrl]);

  useEffect(() => {
    if (!show || !isReady || !vibeVideoInfo.uid) return;

    if (!playbackUrl) {
      if (usesSignedProfileRef && mediaAssetStatus !== "error") return;
      setPlaybackFailed(true);
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackFailed, {
        source: "vibe_player_fullscreen",
        kind: usesSignedProfileRef ? "signed_resolve_failed" : "missing_src",
        has_uid: true,
      });
      Sentry.addBreadcrumb({
        category: "vibe-video-playback",
        message: usesSignedProfileRef ? "fullscreen_signed_media_resolve_failed" : "fullscreen_missing_cdn_or_uid",
        level: "warning",
        data: { hasUid: true, usesSignedProfileRef },
      });
      return;
    }

    if (!shouldAttachPlayback) return;

    const videoEl = videoRef.current;
    if (!videoEl) return;

    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackAttempted, {
      source: "vibe_player_fullscreen",
      autoplay: !prefersReducedMotion,
      video_guid: vibeVideoInfo.uid,
    });

    videoEl.addEventListener("play", reportSucceeded);
    return () => {
      videoEl.removeEventListener("play", reportSucceeded);
    };
  }, [
    show,
    isReady,
    playbackUrl,
    usesSignedProfileRef,
    mediaAssetStatus,
    reportSucceeded,
    vibeVideoInfo.uid,
    prefersReducedMotion,
    shouldAttachPlayback,
  ]);

  useMediaAssetPlayback(videoRef, playbackUrl, {
    enabled: show && isReady && !!playbackUrl && shouldAttachPlayback,
    autoPlay: shouldPlayOnAttach,
    onManifestParsed: reportSucceeded,
    onError: reportPlaybackError,
    onAuthErrorRefresh: async () => {
      if (!usesSignedProfileRef) return null;
      if (hlsAuthRefreshAttemptCountRef.current >= MAX_HLS_AUTH_REFRESH_ATTEMPTS) return null;
      hlsAuthRefreshAttemptCountRef.current += 1;
      const attempt = hlsAuthRefreshAttemptCountRef.current;
      try {
        const freshUrl = await refreshMediaAsset("playback", { bypassFailureCooldown: true });
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, {
          source: "vibe_player_fullscreen",
          attempt,
          outcome: freshUrl ? "refreshed" : "unavailable",
        });
        return freshUrl;
      } catch {
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, {
          source: "vibe_player_fullscreen",
          attempt,
          outcome: "failed",
        });
        return null;
      }
    },
  });
  useMediaPlaybackQoE(videoRef, {
    enabled: show && isReady && !!playbackUrl && shouldAttachPlayback,
    family: usesSignedProfileRef ? "profile_vibe_video" : "vibe_video",
    surface: "vibe_player_fullscreen",
    provider: usesSignedProfileRef ? "bunny_stream" : "remote",
    sourceRef: vibeVideoInfo.playbackUrl,
    muted: false,
    autoplay: !prefersReducedMotion,
  });

  const poster = mediaAssetPosterUrl ?? vibeVideoInfo.thumbnailUrl;
  const signedProfileRefPlaybackPending =
    usesSignedProfileRef && !playbackUrl && mediaAssetStatus !== "error" && !playbackFailed;

  return (
    <AnimatePresence>
      {show && isReady && vibeVideoInfo.uid && (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
          className="fixed inset-0 bg-black flex items-center justify-center z-[9999]"
          style={{ height: "100dvh" }}
          onClick={onClose}
        >
          <button
            type="button"
            className="absolute top-4 right-4 z-30 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
            onClick={onClose}
            aria-label="Close video"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          <video
            ref={videoRef}
            className={`w-full h-full object-contain ${playbackFailed ? "opacity-0" : "opacity-100"}`}
            poster={poster ?? undefined}
            playsInline
            loop
            controls={prefersReducedMotion}
            preload={prefersReducedMotion ? "none" : "metadata"}
            onClick={(e) => e.stopPropagation()}
          >
            {captionTrackUrl ? (
              <track kind="subtitles" src={captionTrackUrl} srcLang={captionLanguage} label="Captions" default={showCaptions} />
            ) : null}
          </video>

          {captionText && !playbackFailed ? (
            <>
              <button
                type="button"
                className="absolute top-4 right-16 z-30 w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowCaptions((visible) => {
                    const next = !visible;
                    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionToggleChanged, {
                      surface: "vibe_player_fullscreen",
                      enabled: next,
                    });
                    return next;
                  });
                }}
                aria-label={showCaptions ? "Hide captions" : "Show captions"}
              >
                CC
              </button>
              {showCaptions ? (
                <div className="pointer-events-none absolute inset-x-8 bottom-28 z-20 rounded-md bg-black/65 px-3 py-2 text-center text-sm font-medium leading-snug text-white shadow-lg">
                  {captionText}
                </div>
              ) : null}
            </>
          ) : null}

          {prefersReducedMotion && !manualPlaybackRequested && !playbackFailed ? (
            <button
              type="button"
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 text-white"
              onClick={(event) => {
                event.stopPropagation();
                setManualPlaybackRequested(true);
              }}
              aria-label="Play video"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                <Play className="ml-1 h-8 w-8" />
              </span>
            </button>
          ) : null}

          {signedProfileRefPlaybackPending ? (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/35 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm font-medium text-white/85">Preparing playback...</p>
            </div>
          ) : null}

          {playbackFailed && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-white text-base font-medium">Can&apos;t play right now</p>
              <p className="text-white/70 text-sm mt-2 max-w-sm">
                It&apos;s ready on our side, but playback didn&apos;t load. Try again in a moment.
              </p>
            </div>
          )}

          {vibeCaption && !playbackFailed && (
            <div
              className="absolute bottom-0 left-0 right-0 px-6 pb-8 pointer-events-none z-10"
              style={{
                background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
              }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #E84393)" }}
                />
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{
                    background: "linear-gradient(90deg, #8B5CF6, #E84393)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Vibing on
                </span>
              </div>
              <p
                className="text-white font-bold leading-tight"
                style={{
                  fontSize: "22px",
                  letterSpacing: "-0.3px",
                  textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                }}
              >
                {vibeCaption}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
