const REBUFFER_DEGRADE_WINDOW_MS = 30_000;
const REBUFFER_DEGRADE_THRESHOLD = 2;
const PREWARM_SESSION_BYTE_LIMIT = 10 * 1024 * 1024;

let qoeDegraded = false;
let prewarmBytesUsed = 0;
let batterySnapshot: { level: number; charging: boolean } | null = null;
let batterySnapshotRequested = false;
const recentRebufferEvents: number[] = [];
const reservedPrewarmSources = new Set<string>();

type BrowserConnection = {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
};

function connectionInfo(): BrowserConnection | null {
  if (typeof navigator === "undefined") return null;
  return ((navigator as Navigator & { connection?: BrowserConnection }).connection ?? null);
}

function primeBatterySnapshot() {
  if (batterySnapshotRequested || typeof navigator === "undefined") return;
  const getBattery = (navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  }).getBattery;
  if (typeof getBattery !== "function") return;
  batterySnapshotRequested = true;
  void getBattery.call(navigator).then((battery: { level: number; charging: boolean }) => {
    batterySnapshot = { level: battery.level, charging: battery.charging };
  }).catch(() => {
    batterySnapshot = null;
  });
}

export function recordMediaPlaybackRebuffer(nowMs = Date.now()): boolean {
  recentRebufferEvents.push(nowMs);
  while (recentRebufferEvents.length && recentRebufferEvents[0] < nowMs - REBUFFER_DEGRADE_WINDOW_MS) {
    recentRebufferEvents.shift();
  }
  if (recentRebufferEvents.length > REBUFFER_DEGRADE_THRESHOLD) qoeDegraded = true;
  return qoeDegraded;
}

export function isMediaPlaybackQoeDegraded(): boolean {
  return qoeDegraded;
}

export function mediaConnectionSnapshot(): {
  connectionType: string;
  effectiveType: string;
  saveData: boolean;
} {
  const connection = connectionInfo();
  return {
    connectionType: connection?.type ?? "unknown",
    effectiveType: connection?.effectiveType ?? "unknown",
    saveData: connection?.saveData === true,
  };
}

export function canPrewarmMedia(bytesEstimate = 0): boolean {
  const connection = connectionInfo();
  primeBatterySnapshot();
  if (qoeDegraded) return false;
  if (connection?.saveData === true) return false;
  if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return false;
  if (batterySnapshot && batterySnapshot.level < 0.2 && !batterySnapshot.charging) return false;
  return prewarmBytesUsed + Math.max(0, bytesEstimate) <= PREWARM_SESSION_BYTE_LIMIT;
}

export function recordMediaPrewarmBytes(bytes: number): number {
  prewarmBytesUsed = Math.min(PREWARM_SESSION_BYTE_LIMIT, prewarmBytesUsed + Math.max(0, bytes));
  return prewarmBytesUsed;
}

export function reserveMediaPrewarmBudgetForSource(sourceKey: string, bytesEstimate: number): boolean {
  const key = sourceKey.trim();
  if (!key) return false;
  if (reservedPrewarmSources.has(key)) return canPrewarmMedia();
  if (!canPrewarmMedia(bytesEstimate)) return false;
  reservedPrewarmSources.add(key);
  recordMediaPrewarmBytes(bytesEstimate);
  return true;
}
