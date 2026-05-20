export const REBUFFER_DEGRADE_WINDOW_MS = 30_000;
export const REBUFFER_DEGRADE_THRESHOLD = 2;
export const PREWARM_SESSION_BYTE_LIMIT = 10 * 1024 * 1024;

export type MediaConnectionSnapshot = {
  connectionType: string;
  effectiveType: string;
  saveData: boolean;
};

export type MediaBatterySnapshot = {
  level: number;
  charging: boolean;
};

export type MediaPlaybackQoeSnapshot = {
  qoeDegraded: boolean;
  recentRebufferCount: number;
  rebufferWindowMs: number;
  rebufferThreshold: number;
  lastStartupMs: number | null;
  lastRebufferAtMs: number | null;
  prewarmBytesUsed: number;
  prewarmByteLimit: number;
  connectionType: string;
  effectiveType: string;
  saveData: boolean;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
};

type PlaybackSessionPolicyAdapter = {
  getConnectionSnapshot?: () => MediaConnectionSnapshot;
  getBatterySnapshot?: () => MediaBatterySnapshot | null;
  primeBatterySnapshot?: () => void;
};

const UNKNOWN_CONNECTION: MediaConnectionSnapshot = {
  connectionType: "unknown",
  effectiveType: "unknown",
  saveData: false,
};

export function createMediaPlaybackSessionPolicy(adapter: PlaybackSessionPolicyAdapter = {}) {
  let qoeDegraded = false;
  let prewarmBytesUsed = 0;
  let lastStartupMs: number | null = null;
  let lastRebufferAtMs: number | null = null;
  const recentRebufferEvents: number[] = [];
  const reservedPrewarmSources = new Set<string>();

  const connectionSnapshot = () => adapter.getConnectionSnapshot?.() ?? UNKNOWN_CONNECTION;
  const batterySnapshot = () => adapter.getBatterySnapshot?.() ?? null;

  function recordMediaPlaybackRebuffer(nowMs = Date.now()): boolean {
    recentRebufferEvents.push(nowMs);
    lastRebufferAtMs = nowMs;
    while (recentRebufferEvents.length && recentRebufferEvents[0] < nowMs - REBUFFER_DEGRADE_WINDOW_MS) {
      recentRebufferEvents.shift();
    }
    if (recentRebufferEvents.length > REBUFFER_DEGRADE_THRESHOLD) qoeDegraded = true;
    return qoeDegraded;
  }

  function isMediaPlaybackQoeDegraded(): boolean {
    return qoeDegraded;
  }

  function recordMediaPlaybackStartup(startupMs: number | null | undefined): void {
    if (typeof startupMs !== "number" || !Number.isFinite(startupMs) || startupMs < 0) return;
    lastStartupMs = Math.round(startupMs);
  }

  function mediaConnectionSnapshot(): MediaConnectionSnapshot {
    return connectionSnapshot();
  }

  function canPrewarmMedia(bytesEstimate = 0): boolean {
    adapter.primeBatterySnapshot?.();
    const connection = connectionSnapshot();
    const battery = batterySnapshot();
    if (qoeDegraded) return false;
    if (connection.saveData) return false;
    if (connection.effectiveType === "slow-2g" || connection.effectiveType === "2g") return false;
    if (battery && battery.level < 0.2 && !battery.charging) return false;
    return prewarmBytesUsed + Math.max(0, bytesEstimate) <= PREWARM_SESSION_BYTE_LIMIT;
  }

  function recordMediaPrewarmBytes(bytes: number): number {
    if (!Number.isFinite(bytes) || bytes <= 0) return prewarmBytesUsed;
    prewarmBytesUsed = Math.min(PREWARM_SESSION_BYTE_LIMIT, prewarmBytesUsed + bytes);
    return prewarmBytesUsed;
  }

  function reserveMediaPrewarmBudgetForSource(sourceKey: string, bytesEstimate: number): boolean {
    const key = sourceKey.trim();
    if (!key) return false;
    if (reservedPrewarmSources.has(key)) return canPrewarmMedia();
    if (!canPrewarmMedia(bytesEstimate)) return false;
    reservedPrewarmSources.add(key);
    recordMediaPrewarmBytes(bytesEstimate);
    return true;
  }

  function getMediaPlaybackQoeSnapshot(nowMs = Date.now()): MediaPlaybackQoeSnapshot {
    while (recentRebufferEvents.length && recentRebufferEvents[0] < nowMs - REBUFFER_DEGRADE_WINDOW_MS) {
      recentRebufferEvents.shift();
    }
    const connection = connectionSnapshot();
    const battery = batterySnapshot();
    return {
      qoeDegraded,
      recentRebufferCount: recentRebufferEvents.length,
      rebufferWindowMs: REBUFFER_DEGRADE_WINDOW_MS,
      rebufferThreshold: REBUFFER_DEGRADE_THRESHOLD,
      lastStartupMs,
      lastRebufferAtMs,
      prewarmBytesUsed,
      prewarmByteLimit: PREWARM_SESSION_BYTE_LIMIT,
      connectionType: connection.connectionType,
      effectiveType: connection.effectiveType,
      saveData: connection.saveData,
      batteryLevel: battery?.level ?? null,
      batteryCharging: battery?.charging ?? null,
    };
  }

  return {
    recordMediaPlaybackRebuffer,
    isMediaPlaybackQoeDegraded,
    recordMediaPlaybackStartup,
    mediaConnectionSnapshot,
    canPrewarmMedia,
    recordMediaPrewarmBytes,
    reserveMediaPrewarmBudgetForSource,
    getMediaPlaybackQoeSnapshot,
  };
}
