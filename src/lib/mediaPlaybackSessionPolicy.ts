import {
  createMediaPlaybackSessionPolicy,
  PREWARM_SESSION_BYTE_LIMIT,
  REBUFFER_DEGRADE_THRESHOLD,
  REBUFFER_DEGRADE_WINDOW_MS,
} from "../../shared/media/playback-session-policy-core";

type BrowserConnection = {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
};

let batterySnapshot: { level: number; charging: boolean } | null = null;
let batterySnapshotRequested = false;

function connectionInfo(): BrowserConnection | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { connection?: BrowserConnection }).connection ?? null;
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

const policy = createMediaPlaybackSessionPolicy({
  getConnectionSnapshot: () => {
    const connection = connectionInfo();
    return {
      connectionType: connection?.type ?? "unknown",
      effectiveType: connection?.effectiveType ?? "unknown",
      saveData: connection?.saveData === true,
    };
  },
  getBatterySnapshot: () => batterySnapshot,
  primeBatterySnapshot,
});

export {
  PREWARM_SESSION_BYTE_LIMIT,
  REBUFFER_DEGRADE_THRESHOLD,
  REBUFFER_DEGRADE_WINDOW_MS,
};

export const {
  recordMediaPlaybackRebuffer,
  isMediaPlaybackQoeDegraded,
  recordMediaPlaybackStartup,
  mediaConnectionSnapshot,
  canPrewarmMedia,
  recordMediaPrewarmBytes,
  reserveMediaPrewarmBudgetForSource,
  getMediaPlaybackQoeSnapshot,
} = policy;
