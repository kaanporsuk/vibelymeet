import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCachedMediaAsset,
  isHlsMediaAssetUrl,
  isPlayableMediaAssetUrl,
  refreshMediaAsset,
  type MediaAssetKind,
  type MediaAssetRefreshOptions,
  type MediaAssetResolveResult,
} from '@/lib/mediaAssetResolver';

export type { MediaAssetKind } from '@/lib/mediaAssetResolver';
export type MediaAssetRefreshReason = 'cache' | 'initial' | 'preview' | 'playback' | 'manual' | 'proactive';
export type UseMediaAssetStatus = 'idle' | 'loading' | 'ready' | 'error';

type UseMediaAssetOptions = {
  kind: MediaAssetKind | 'vibe_video';
  messageId?: string | null;
  sourceRef?: string | null;
  initialUrl?: string | null;
  autoResolve?: boolean;
  enabled?: boolean;
  onResolvedUrl?: (url: string) => void;
};

type UseMediaAssetResult = {
  url: string | null;
  status: UseMediaAssetStatus;
  error: string | null;
  expiresAtMs: number | null;
  isPlayable: boolean;
  refresh: (reason?: MediaAssetRefreshReason, options?: MediaAssetRefreshOptions) => Promise<string | null>;
};

const PROACTIVE_REFRESH_LEAD_MS = 5 * 60 * 1000;
const MIN_PROACTIVE_REFRESH_DELAY_MS = 30 * 1000;
const IMMEDIATE_PROACTIVE_REFRESH_THRESHOLD_MS = 2 * 1000;

function passthroughAsset(url: string): MediaAssetResolveResult {
  return {
    url,
    posterUrl: null,
    playbackKind: isHlsMediaAssetUrl(url) ? 'hls' : 'progressive',
    provider: /^https?:\/\//i.test(url) ? 'remote' : 'local',
    expiresAtMs: Number.POSITIVE_INFINITY,
  };
}

function mediaStatusForUrl(url: string | null | undefined): UseMediaAssetStatus {
  if (!url) return 'idle';
  return isPlayableMediaAssetUrl(url) ? 'ready' : 'idle';
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
  onResolvedUrl,
}: UseMediaAssetOptions): UseMediaAssetResult {
  const initial = initialUrl ?? sourceRef ?? null;
  const [url, setUrl] = useState<string | null>(initial);
  const [status, setStatus] = useState<UseMediaAssetStatus>(() => mediaStatusForUrl(initial));
  const [error, setError] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const onResolvedUrlRef = useRef(onResolvedUrl);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    onResolvedUrlRef.current = onResolvedUrl;
  }, [onResolvedUrl]);

  useEffect(() => {
    const next = initialUrl ?? sourceRef ?? null;
    setUrl(next);
    setStatus(mediaStatusForUrl(next));
    setError(null);
    setExpiresAtMs(null);
    requestSeqRef.current += 1;
  }, [initialUrl, sourceRef]);

  const commitResult = useCallback((seq: number, result: MediaAssetResolveResult | null): string | null => {
    if (requestSeqRef.current !== seq) return null;
    if (!result?.url) {
      setStatus('error');
      setError('media_asset_unavailable');
      return null;
    }
    setUrl(result.url);
    setStatus('ready');
    setError(null);
    setExpiresAtMs(Number.isFinite(result.expiresAtMs) ? result.expiresAtMs : null);
    onResolvedUrlRef.current?.(result.url);
    return result.url;
  }, []);

  const refresh = useCallback(
    async (
      reason: MediaAssetRefreshReason = 'manual',
      options: MediaAssetRefreshOptions = {},
    ): Promise<string | null> => {
      if (!enabled) return null;
      const rawRef = sourceRef ?? initialUrl ?? null;
      if (!rawRef) return null;

      if (kind === 'vibe_video' || !messageId || !sourceRef) {
        const result = passthroughAsset(rawRef);
        const seq = requestSeqRef.current + 1;
        requestSeqRef.current = seq;
        return commitResult(seq, result);
      }

      const seq = requestSeqRef.current + 1;
      requestSeqRef.current = seq;
      if (reason !== 'proactive' && reason !== 'cache') setStatus('loading');
      const resolver = reason === 'cache' ? getCachedMediaAsset : refreshMediaAsset;
      const result = await resolver(messageId, kind, sourceRef, options);
      return commitResult(seq, result);
    },
    [commitResult, enabled, initialUrl, kind, messageId, sourceRef],
  );

  useEffect(() => {
    if (!enabled || !autoResolve) return;
    const rawRef = sourceRef ?? initialUrl ?? null;
    if (!rawRef) return;
    if (!sourceRef && isPlayableMediaAssetUrl(rawRef)) return;
    void refresh('cache');
  }, [autoResolve, enabled, initialUrl, refresh, sourceRef]);

  useEffect(() => {
    if (!enabled || !messageId || !sourceRef || !expiresAtMs || !Number.isFinite(expiresAtMs)) return;
    const delayMs = proactiveRefreshDelayMs(expiresAtMs);
    if (delayMs === null) return;
    const timeout = setTimeout(() => {
      void refresh('proactive');
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [enabled, expiresAtMs, messageId, refresh, sourceRef]);

  return useMemo(
    () => ({
      url,
      status,
      error,
      expiresAtMs,
      isPlayable: isPlayableMediaAssetUrl(url),
      refresh,
    }),
    [error, expiresAtMs, refresh, status, url],
  );
}
