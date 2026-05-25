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
import type { HlsAuthErrorRefreshDetail, HlsPlaybackRefreshResult } from "@/lib/vibeVideo/attachHlsPlayback";
import type { MediaPlaceholderKind } from "@clientShared/media/placeholders";
import {
  resolveMediaFallbackCopy,
  resolveMediaFallbackReason,
  type MediaFallbackCopy,
  type MediaFallbackReason,
} from "@clientShared/media/mediaFallbackCopy";

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
  placeholderKind: MediaPlaceholderKind | null;
  placeholderHash: string | null;
  dominantColor: string | null;
  status: UseMediaAssetStatus;
  error: string | null;
  fallbackReason: MediaFallbackReason | null;
  fallbackCopy: MediaFallbackCopy | null;
  expiresAtMs: number | null;
  isPlayable: boolean;
  refresh: (reason?: MediaAssetRefreshReason, options?: MediaAssetRefreshOptions) => Promise<string | null>;
};

type UseMediaAssetPlaybackOptions = {
  enabled?: boolean;
  autoPlay?: boolean;
  expiresAtMs?: number | null;
  onAutoplayBlocked?: (detail?: unknown) => void;
  onManifestParsed?: () => void;
  onError?: (kind: "native" | "unsupported" | "fatal", detail?: unknown) => void;
  onAuthErrorRefresh?: (
    detail: HlsAuthErrorRefreshDetail,
  ) => Promise<HlsPlaybackRefreshResult> | HlsPlaybackRefreshResult;
  onProactiveRefresh?: () => Promise<HlsPlaybackRefreshResult> | HlsPlaybackRefreshResult;
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

function mediaAssetOwnerTopic(userId: string): string {
  return `media:user:${userId}`;
}

function mediaFamilyMatchesKind(mediaFamily: unknown, kind: MediaAssetKind | "vibe_video"): boolean {
  if (kind === "image") return mediaFamily === "chat_image";
  if (kind === "voice") return mediaFamily === "voice_message";
  if (kind === "profile_vibe_video" || kind === "vibe_video") return mediaFamily === "vibe_video";
  if (kind === "thumbnail") return mediaFamily === "chat_video" || mediaFamily === "chat_video_thumbnail";
  if (kind === "video" || kind === "vibe_clip") return mediaFamily === "chat_video";
  return false;
}

function mediaAssetBroadcastPayload(message: unknown): Record<string, unknown> | null {
  const payload = message && typeof message === "object" && !Array.isArray(message)
    ? (message as { payload?: unknown }).payload
    : null;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

function passthroughAsset(url: string): MediaAssetResolveResult {
  return {
    url,
    posterUrl: null,
    playbackKind: isHlsMediaAssetUrl(url) ? "hls" : "progressive",
    provider: /^https?:\/\//i.test(url) ? "remote" : "local",
    expiresAtMs: Number.POSITIVE_INFINITY,
    placeholderKind: null,
    placeholderHash: null,
    dominantColor: null,
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
  const [placeholderKind, setPlaceholderKind] = useState<MediaPlaceholderKind | null>(null);
  const [placeholderHash, setPlaceholderHash] = useState<string | null>(null);
  const [dominantColor, setDominantColor] = useState<string | null>(null);
  const [status, setStatus] = useState<UseMediaAssetStatus>(() => mediaStatusForUrl(initial));
  const [error, setError] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<MediaFallbackReason | null>(null);
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
    setPlaceholderKind(null);
    setPlaceholderHash(null);
    setDominantColor(null);
    setStatus(mediaStatusForUrl(next));
    setError(null);
    setFallbackReason(null);
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
      const errorCode = failureCode ?? "media_asset_unavailable";
      const reason = resolveMediaFallbackReason({ errorCode });
      setStatus("error");
      setError(errorCode);
      setFallbackReason(reason);
      return null;
    }
    setUrl(result.url);
    setPosterUrl(result.posterUrl);
    setPlaceholderKind(result.placeholderKind);
    setPlaceholderHash(result.placeholderHash);
    setDominantColor(result.dominantColor);
    setStatus("ready");
    setError(null);
    setFallbackReason(null);
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
    if (url && isHlsMediaAssetUrl(url)) return;
    const delayMs = proactiveRefreshDelayMs(expiresAtMs);
    if (delayMs === null) return;
    const timeout = window.setTimeout(() => {
      void refresh("proactive");
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [enabled, expiresAtMs, kind, messageId, refresh, sourceRef, url]);

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

  useEffect(() => {
    const useOwnerBroadcast =
      kind === "profile_vibe_video" ||
      kind === "vibe_video" ||
      isActiveProcessingStatus(processingStatus);
    if (!enabled || !sourceRef || !useOwnerBroadcast) {
      return;
    }
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user?.id) return;
      channel = supabase
        .channel(mediaAssetOwnerTopic(data.user.id), { config: { private: true } })
        .on("broadcast", { event: "media_asset_event" }, (message) => {
          if (!active) return;
          const payload = mediaAssetBroadcastPayload(message);
          if (!payload || !mediaFamilyMatchesKind(payload.mediaFamily, kind)) return;
          void refreshRef.current("manual", { bypassFailureCooldown: true });
        })
        .subscribe();
    }).catch(() => {});
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, kind, processingStatus, sourceRef]);

  return useMemo(
    () => ({
      url,
      posterUrl,
      placeholderKind,
      placeholderHash,
      dominantColor,
      status,
      error,
      fallbackReason,
      fallbackCopy: fallbackReason ? resolveMediaFallbackCopy({ reason: fallbackReason }) : null,
      expiresAtMs,
      isPlayable: isPlayableMediaAssetUrl(url),
      refresh,
    }),
    [dominantColor, error, expiresAtMs, fallbackReason, placeholderHash, placeholderKind, posterUrl, refresh, status, url],
  );
}

export function useMediaAssetPlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  sourceUrl: string | null | undefined,
  {
    enabled = true,
    autoPlay = true,
    expiresAtMs = null,
    onAutoplayBlocked,
    onManifestParsed,
    onError,
    onAuthErrorRefresh,
    onProactiveRefresh,
  }: UseMediaAssetPlaybackOptions = {},
): void {
  const onAutoplayBlockedRef = useRef(onAutoplayBlocked);
  const onManifestParsedRef = useRef(onManifestParsed);
  const onErrorRef = useRef(onError);
  const onAuthErrorRefreshRef = useRef(onAuthErrorRefresh);
  const onProactiveRefreshRef = useRef(onProactiveRefresh);
  const hasAuthErrorRefresh = typeof onAuthErrorRefresh === "function";
  const hasProactiveRefresh = typeof onProactiveRefresh === "function";

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
    onAuthErrorRefreshRef.current = onAuthErrorRefresh;
  }, [onAuthErrorRefresh]);

  useEffect(() => {
    onProactiveRefreshRef.current = onProactiveRefresh;
  }, [onProactiveRefresh]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video || !sourceUrl) return;

    if (isHlsMediaAssetUrl(sourceUrl)) {
      return attachHlsPlayback(video, sourceUrl, {
        autoPlay,
        expiresAtMs,
        onAutoplayBlocked: (detail) => onAutoplayBlockedRef.current?.(detail),
        onManifestParsed: () => onManifestParsedRef.current?.(),
        onError: (kind, detail) => onErrorRef.current?.(kind, detail),
        onAuthErrorRefresh: hasAuthErrorRefresh ? (detail) => onAuthErrorRefreshRef.current?.(detail) : undefined,
        onProactiveRefresh: hasProactiveRefresh ? () => onProactiveRefreshRef.current?.() : undefined,
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
  }, [autoPlay, enabled, expiresAtMs, hasAuthErrorRefresh, hasProactiveRefresh, sourceUrl, videoRef]);
}
