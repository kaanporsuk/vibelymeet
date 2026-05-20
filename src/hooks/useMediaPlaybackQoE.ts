import { useEffect, type RefObject } from "react";
import { trackEvent } from "@/lib/analytics";
import {
  recordMediaPlaybackStartup,
  isMediaPlaybackQoeDegraded,
  mediaConnectionSnapshot,
  recordMediaPlaybackRebuffer,
} from "@/lib/mediaPlaybackSessionPolicy";
import { telemetrySafeSourceRef } from "../../shared/media/telemetry-safe-ref";

type UseMediaPlaybackQoEOptions = {
  enabled?: boolean;
  family: string;
  surface: string;
  provider?: string | null;
  sourceRef?: string | null;
  messageId?: string | null;
  clientRequestId?: string | null;
  muted?: boolean;
  autoplay?: boolean;
};

type VideoWithPlaybackQuality = HTMLVideoElement & {
  getVideoPlaybackQuality?: () => {
    droppedVideoFrames?: number;
    totalVideoFrames?: number;
  };
};

function deviceClass(): "desktop" | "mobile" | "tablet" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  if (/iPad|Tablet|PlayBook/i.test(ua) || (touchPoints > 1 && /Macintosh/i.test(ua))) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

export function useMediaPlaybackQoE(
  videoRef: RefObject<HTMLVideoElement | null>,
  {
    enabled = true,
    family,
    surface,
    provider = null,
    sourceRef = null,
    messageId = null,
    clientRequestId = null,
    muted = false,
    autoplay = false,
  }: UseMediaPlaybackQoEOptions,
): void {
  useEffect(() => {
    const video = videoRef.current as VideoWithPlaybackQuality | null;
    if (!enabled || !video) return;

    let startupStartedAtMs: number | null = null;
    let startupMs: number | null = null;
    let sawPlaying = false;
    let buffering = false;
    let rebufferCount = 0;
    let bitrateSwitchCount = 0;
    let emitted = false;

    const emit = (reason: "pause" | "ended" | "error" | "unmount") => {
      if (emitted && reason !== "error") return;
      emitted = true;
      const quality = video.getVideoPlaybackQuality?.();
      const connection = mediaConnectionSnapshot();
      trackEvent("media_playback_qoe", {
        family,
        surface,
        provider: provider ?? "unknown",
        source_ref: telemetrySafeSourceRef(sourceRef),
        message_id: messageId ?? "none",
        client_request_id: clientRequestId ?? "none",
        reason,
        startup_ms: startupMs ?? (startupStartedAtMs ? Math.max(0, Math.round(performance.now() - startupStartedAtMs)) : -1),
        rebuffer_count: rebufferCount,
        bitrate_switch_count: bitrateSwitchCount,
        dropped_frame_count: quality?.droppedVideoFrames ?? 0,
        total_frame_count: quality?.totalVideoFrames ?? 0,
        muted,
        autoplay,
        device_class: deviceClass(),
        qoe_degraded: isMediaPlaybackQoeDegraded(),
        connection_type: connection.connectionType,
        effective_type: connection.effectiveType,
        save_data: connection.saveData,
      });
    };

    const handleLoadStart = () => {
      startupStartedAtMs = performance.now();
      startupMs = null;
      sawPlaying = false;
      buffering = false;
      rebufferCount = 0;
      bitrateSwitchCount = 0;
      emitted = false;
    };
    const handlePlaying = () => {
      if (!sawPlaying && startupStartedAtMs !== null) {
        startupMs = Math.max(0, Math.round(performance.now() - startupStartedAtMs));
        recordMediaPlaybackStartup(startupMs);
      }
      sawPlaying = true;
      buffering = false;
    };
    const handleWaiting = () => {
      if (!sawPlaying || buffering) return;
      buffering = true;
      rebufferCount += 1;
      const degraded = recordMediaPlaybackRebuffer();
      trackEvent("media_playback_qoe_rebuffer", {
        family,
        surface,
        provider: provider ?? "unknown",
        message_id: messageId ?? "none",
        client_request_id: clientRequestId ?? "none",
        rebuffer_count: rebufferCount,
        qoe_degraded: degraded,
      });
    };
    const handleLevelSwitched = () => {
      bitrateSwitchCount += 1;
    };
    const handlePause = () => emit("pause");
    const handleEnded = () => emit("ended");
    const handleError = () => emit("error");

    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleWaiting);
    video.addEventListener("vibely-hls-level-switched", handleLevelSwitched);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    if (video.readyState > 0) handleLoadStart();

    return () => {
      emit("unmount");
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleWaiting);
      video.removeEventListener("vibely-hls-level-switched", handleLevelSwitched);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
    };
  }, [autoplay, clientRequestId, enabled, family, messageId, muted, provider, sourceRef, surface, videoRef]);
}
