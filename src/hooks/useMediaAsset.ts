import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getCachedMediaAsset,
  getCachedMediaAssetFailureCode,
  isHlsMediaAssetUrl,
  isPlayableMediaAssetUrl,
  refreshMediaAsset,
  type ChatVibeClipProcessingStatus,
  type MediaAssetKind,
  type MediaAssetRefreshOptions,
  type MediaAssetResolveResult,
} from "@/lib/mediaAssetResolver";
import { attachHlsPlayback } from "@/lib/vibeVideo/attachHlsPlayback";

export type { MediaAssetKind } from "@/lib/mediaAssetResolver";
export type MediaAssetRefreshReason = "cache" | "initial" | "preview" | "playback" | "manual" | "proactive";
export type UseMediaAssetStatus = "idle" | "loading" | "ready" | "error";

type UseMediaAssetOptions = {
  kind: MediaAssetKind | "vibe_video";
  messageId?: string | null;
  sourceRef?: string | null;
  initialUrl?: string | null;
  autoResolve?: boolean;
  enabled?: boolean;
  processingStatus?: ChatVibeClipProcessingStatus | null;
  onResolvedUrl?: (url: string) => void;
  onProcessingStatusChange?: (status: ChatVibeClipProcessingStatus) => void;
};

type UseMediaAssetResult = {
  url: string | null;
  posterUrl: string | null;
  status: UseMediaAssetStatus;
  error: string | null;
  expiresAtMs: number | null;
  isPlayable: boolean;
  refresh: (reason?: MediaAssetRefreshReason, options?: MediaAssetRefreshOptions) => Promise<string | null>;
};

type UseMediaAssetPlaybackOptions = {
  enabled?: boolean;
  autoPlay?: boolean;
  onAutoplayBlocked?: (detail?: unknown) => void;
  onManifestParsed?: () => void;
  onError?: (kind: "native" | "unsupported" | "fatal", detail?: unknown) => void;
};

const PROACTIVE_REFRESH_LEAD_MS = 5 * 60 * 1000;
const MIN_PROACTIVE_REFRESH_DELAY_MS = 30 * 1000;
const IMMEDIATE_PROACTIVE_REFRESH_THRESHOLD_MS = 2 * 1000;

function isChatRealtimeMediaKind(kind: MediaAssetKind | "vibe_video"): boolean {
  return kind === "image" || kind === "voice" || kind === "video" || kind === "vibe_clip" || kind === "thumbnail";
}

function processingStatusFromPayload(payload: unknown): ChatVibeClipProcessingStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const status = (payload as { processing_status?: unknown }).processing_status;
  return status === "uploading" || status === "processing" || status === "ready" || status === "failed" ? status : null;
}

function isActiveProcessingStatus(status: ChatVibeClipProcessingStatus | null | undefined): boolean {
  return status === "uploading" || status === "processing";
}

function realtimeChannelName(messageId: string, kind: MediaAssetKind | "vibe_video"): string {
  return `media-asset-message:${messageId}:${kind}`;
}

function passthroughAsset(url: string): MediaAssetResolveResult {
  return {
    url,
    posterUrl: null,
    playbackKind: isHlsMediaAssetUrl(url) ? "hls" : "progressive",
    provider: /^https?:\/\//i.test(url) ? "remote" : "local",
    expiresAtMs: Number.POSITIVE_INFINITY,
  };
}

function mediaStatusForUrl(url: string | null | undefined): UseMediaAssetStatus {
  if (!url) return "idle";
  return isPlayableMediaAssetUrl(url) ? "ready" : "idle";
}

function proactiveRefreshDelayMs(expiresAtMs: number, nowMs = Date.now()): number | null {
  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) return null;
  if (remainingMs <= IMMEDIATE_PROACTIVE_REFRESH_THRESHOLD_MS) return 0;
  if (remainingMs > PROACTIVE_REFRESH_LEAD_MS) return remainingMs - PROACTIVE_REFRESH_LEAD_MS;
  return Math.max(1_000, Math.min(MIN_PROACTIVE_REFRESH_DELAY_MS, Math.floor(remainingMs / 2)));
}

export function useMediaAsset({
  kind,
  messageId,
  sourceRef,
  initialUrl,
  autoResolve = true,
  enabled = true,
  processingStatus,
  onResolvedUrl,
  onProcessingStatusChange,
}: UseMediaAssetOptions): UseMediaAssetResult {
  const initial = initialUrl === null ? null : initialUrl ?? sourceRef ?? null;
  const [url, setUrl] = useState<string | null>(initial);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<UseMediaAssetStatus>(() => mediaStatusForUrl(initial));
  const [error, setError] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const onResolvedUrlRef = useRef(onResolvedUrl);
  const onProcessingStatusChangeRef = useRef(onProcessingStatusChange);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    onResolvedUrlRef.current = onResolvedUrl;
  }, [onResolvedUrl]);

  useEffect(() => {
    onProcessingStatusChangeRef.current = onProcessingStatusChange;
  }, [onProcessingStatusChange]);

  useEffect(() => {
    const next = initialUrl === null ? null : initialUrl ?? sourceRef ?? null;
    setUrl(next);
    setPosterUrl(null);
    setStatus(mediaStatusForUrl(next));
    setError(null);
    setExpiresAtMs(null);
    requestSeqRef.current += 1;
  }, [initialUrl, sourceRef]);

  const commitResult = useCallback((
    seq: number,
    result: MediaAssetResolveResult | null,
    failureCode?: string | null,
  ): string | null => {
    if (requestSeqRef.current !== seq) return null;
    if (!result?.url) {
      setStatus("error");
      setError(failureCode ?? "media_asset_unavailable");
      return null;
    }
    setUrl(result.url);
    setPosterUrl(result.posterUrl);
    setStatus("ready");
    setError(null);
    setExpiresAtMs(Number.isFinite(result.expiresAtMs) ? result.expiresAtMs : null);
    onResolvedUrlRef.current?.(result.url);
    return result.url;
  }, []);

  const refresh = useCallback(
    async (
      reason: MediaAssetRefreshReason = "manual",
      options: MediaAssetRefreshOptions = {},
    ): Promise<string | null> => {
      if (!enabled) return null;
      const rawRef = sourceRef ?? initialUrl ?? null;
      if (!rawRef) return null;

      const canResolveProfileVibeVideo = kind === "profile_vibe_video" && !!sourceRef;
      if (kind === "vibe_video" || (!messageId && !canResolveProfileVibeVideo) || !sourceRef) {
        const result = passthroughAsset(rawRef);
        const seq = requestSeqRef.current + 1;
        requestSeqRef.current = seq;
        return commitResult(seq, result);
      }

      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      if (reason !== "proactive" && reason !== "cache") setStatus("loading");
      const resolver = reason === "cache" ? getCachedMediaAsset : refreshMediaAsset;
      const result = await resolver(messageId ?? "", kind, sourceRef, options);
      const failureCode = !result?.url ? getCachedMediaAssetFailureCode(messageId ?? "", kind, sourceRef) : null;
      return commitResult(seq, result, failureCode);
    },
    [commitResult, enabled, initialUrl, kind, messageId, sourceRef],
  );

  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !autoResolve) return;
    const rawRef = sourceRef ?? initialUrl ?? null;
    if (!rawRef) return;
    if (!sourceRef && isPlayableMediaAssetUrl(rawRef)) return;
    void refresh("cache");
  }, [autoResolve, enabled, initialUrl, refresh, sourceRef]);

  useEffect(() => {
    const canRefreshScopedAsset = !!messageId || kind === "profile_vibe_video";
    if (!enabled || !canRefreshScopedAsset || !sourceRef || !expiresAtMs || !Number.isFinite(expiresAtMs)) return;
    const delayMs = proactiveRefreshDelayMs(expiresAtMs);
    if (delayMs === null) return;
    const timeout = window.setTimeout(() => {
      void refresh("proactive");
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [enabled, expiresAtMs, kind, messageId, refresh, sourceRef]);

  useEffect(() => {
    if (
      !enabled ||
      !messageId ||
      !sourceRef ||
      !onProcessingStatusChange ||
      !isChatRealtimeMediaKind(kind) ||
      !isActiveProcessingStatus(processingStatus)
    ) {
      return;
    }
    let active = true;
    const channel = supabase
      .channel(realtimeChannelName(messageId, kind))
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `id=eq.${messageId}` },
        (payload) => {
          if (!active) return;
          const nextStatus = processingStatusFromPayload(
            (payload.new as { structured_payload?: unknown } | null)?.structured_payload,
          );
          if (!nextStatus) return;
          onProcessingStatusChangeRef.current?.(nextStatus);
          if (nextStatus === "ready") {
            setError(null);
            void refreshRef.current("manual", { bypassFailureCooldown: true });
          } else if (nextStatus === "failed") {
            requestSeqRef.current += 1;
            setStatus("error");
            setError("media_asset_processing_failed");
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [enabled, kind, messageId, onProcessingStatusChange, processingStatus, sourceRef]);

  return useMemo(
    () => ({
      url,
      posterUrl,
      status,
      error,
      expiresAtMs,
      isPlayable: isPlayableMediaAssetUrl(url),
      refresh,
    }),
    [error, expiresAtMs, posterUrl, refresh, status, url],
  );
}

export function useMediaAssetPlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  sourceUrl: string | null | undefined,
  {
    enabled = true,
    autoPlay = true,
    onAutoplayBlocked,
    onManifestParsed,
    onError,
  }: UseMediaAssetPlaybackOptions = {},
): void {
  const onAutoplayBlockedRef = useRef(onAutoplayBlocked);
  const onManifestParsedRef = useRef(onManifestParsed);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onAutoplayBlockedRef.current = onAutoplayBlocked;
  }, [onAutoplayBlocked]);

  useEffect(() => {
    onManifestParsedRef.current = onManifestParsed;
  }, [onManifestParsed]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video || !sourceUrl) return;

    if (isHlsMediaAssetUrl(sourceUrl)) {
      return attachHlsPlayback(video, sourceUrl, {
        autoPlay,
        onAutoplayBlocked: (detail) => onAutoplayBlockedRef.current?.(detail),
        onManifestParsed: () => onManifestParsedRef.current?.(),
        onError: (kind, detail) => onErrorRef.current?.(kind, detail),
      });
    }

    video.src = sourceUrl;
    video.load();
    if (autoPlay) {
      void video.play().catch((error: unknown) => onAutoplayBlockedRef.current?.(error));
    }
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [autoPlay, enabled, sourceUrl, videoRef]);
}
