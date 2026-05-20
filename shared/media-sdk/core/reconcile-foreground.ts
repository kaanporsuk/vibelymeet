export const MEDIA_SDK_FOREGROUND_RECONCILE_MIN_MS = 5 * 60 * 1000;

const lastForegroundReconcileByKey = new Map<string, number>();

export function shouldRunMediaSdkForegroundReconcile(
  key: string,
  nowMs = Date.now(),
  minIntervalMs = MEDIA_SDK_FOREGROUND_RECONCILE_MIN_MS,
): boolean {
  const stableKey = key.trim() || "default";
  const lastRunMs = lastForegroundReconcileByKey.get(stableKey) ?? 0;
  if (nowMs - lastRunMs < minIntervalMs) return false;
  lastForegroundReconcileByKey.set(stableKey, nowMs);
  return true;
}

export function markMediaSdkForegroundReconcile(key: string, nowMs = Date.now()): void {
  lastForegroundReconcileByKey.set(key.trim() || "default", nowMs);
}

export function clearMediaSdkForegroundReconcileForTests(): void {
  lastForegroundReconcileByKey.clear();
}
