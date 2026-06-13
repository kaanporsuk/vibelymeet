import type { LobbyPostDatePlatform } from "../analytics/lobbyToPostDateJourney";

export const VIDEO_DATE_PERMISSION_HANDOFF_TTL_MS = 45_000;

export type VideoDatePermissionHandoffCaptureProfile =
  | "ideal"
  | "portrait_medium"
  | "portrait_compatible"
  | "fallback";

export type VideoDatePermissionHandoffState = {
  sessionId: string;
  userId: string;
  platform: LobbyPostDatePlatform;
  grantedAtMs: number;
  expiresAtMs: number;
  cameraGranted: true;
  microphoneGranted: true;
  captureProfile: VideoDatePermissionHandoffCaptureProfile | null;
  source: string;
};

export type VideoDatePermissionHandoffStatus =
  | { ok: true; entry: VideoDatePermissionHandoffState }
  | { ok: false; reason: "missing" | "expired" };

const permissionHandoffs = new Map<string, VideoDatePermissionHandoffState>();

function permissionHandoffKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

export function pruneExpiredVideoDatePermissionHandoffs(nowMs: number = Date.now()): number {
  let removedCount = 0;
  for (const [key, entry] of permissionHandoffs) {
    if (entry.expiresAtMs <= nowMs) {
      permissionHandoffs.delete(key);
      removedCount += 1;
    }
  }
  return removedCount;
}

export function setVideoDatePermissionHandoff(params: {
  sessionId: string;
  userId: string;
  platform: LobbyPostDatePlatform;
  source: string;
  captureProfile?: VideoDatePermissionHandoffCaptureProfile | null;
  nowMs?: number;
  ttlMs?: number;
}): VideoDatePermissionHandoffState {
  const nowMs = params.nowMs ?? Date.now();
  pruneExpiredVideoDatePermissionHandoffs(nowMs);
  const entry: VideoDatePermissionHandoffState = {
    sessionId: params.sessionId,
    userId: params.userId,
    platform: params.platform,
    grantedAtMs: nowMs,
    expiresAtMs: nowMs + (params.ttlMs ?? VIDEO_DATE_PERMISSION_HANDOFF_TTL_MS),
    cameraGranted: true,
    microphoneGranted: true,
    captureProfile: params.captureProfile ?? null,
    source: params.source,
  };
  permissionHandoffs.set(permissionHandoffKey(params.sessionId, params.userId), entry);
  return entry;
}

export function getVideoDatePermissionHandoff(
  sessionId: string,
  userId: string,
  nowMs: number = Date.now(),
): VideoDatePermissionHandoffState | null {
  const status = getVideoDatePermissionHandoffStatus(sessionId, userId, nowMs);
  return status.ok ? status.entry : null;
}

export function getVideoDatePermissionHandoffStatus(
  sessionId: string,
  userId: string,
  nowMs: number = Date.now(),
): VideoDatePermissionHandoffStatus {
  const key = permissionHandoffKey(sessionId, userId);
  const entry = permissionHandoffs.get(key);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.expiresAtMs <= nowMs) {
    permissionHandoffs.delete(key);
    return { ok: false, reason: "expired" };
  }
  return { ok: true, entry };
}

export function clearVideoDatePermissionHandoff(sessionId: string, userId: string): boolean {
  return permissionHandoffs.delete(permissionHandoffKey(sessionId, userId));
}

export function clearAllVideoDatePermissionHandoffs(): void {
  permissionHandoffs.clear();
}
