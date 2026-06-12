/**
 * Native Video Date surface-claim client identity + backoff state.
 * Extracted verbatim from `app/date/[id].tsx` (VD rebuild PR 8).
 */

export const NATIVE_VIDEO_DATE_SURFACE_CLAIM_TTL_SECONDS = 30;
export const NATIVE_VIDEO_DATE_SURFACE_CLAIM_REFRESH_MS = 10_000;
export const NATIVE_VIDEO_DATE_SURFACE_CLAIM_BACKOFF_BASE_MS = 1_000;
export const NATIVE_VIDEO_DATE_SURFACE_CLAIM_BACKOFF_MAX_MS = 15_000;
export const NATIVE_VIDEO_DATE_SURFACE_CLAIM_RELEASE_GRACE_MS = 1_000;
export const NATIVE_VIDEO_DATE_SURFACE_CLIENT_STORAGE_PREFIX =
  "vibely_vd_native_surface_client";

export type NativeVideoDateSurfaceClaimResult = {
  canContinue: boolean;
  confirmed: boolean;
};

export function nextNativeSurfaceClaimBackoffMs(failureCount: number) {
  return Math.min(
    NATIVE_VIDEO_DATE_SURFACE_CLAIM_BACKOFF_MAX_MS,
    NATIVE_VIDEO_DATE_SURFACE_CLAIM_BACKOFF_BASE_MS *
      2 ** Math.min(failureCount, 4),
  );
}

export const nativeVideoDateSurfaceClientInstanceIds = new Map<string, string>();
export type NativeVideoDateActiveSurfaceOwner = {
  owner: string;
  clientInstanceId: string;
};
export const nativeVideoDateActiveSurfaceOwners = new Map<
  string,
  NativeVideoDateActiveSurfaceOwner
>();

export function nativeVideoDateSurfaceStorageKey(
  sessionId: string,
  profileId: string,
) {
  return `${NATIVE_VIDEO_DATE_SURFACE_CLIENT_STORAGE_PREFIX}:${profileId}:${sessionId}`;
}

export function nativeVideoDateActiveSurfaceKey(sessionId: string, profileId: string) {
  return `${profileId}:${sessionId}`;
}

export function createNativeVideoDateClientInstanceId() {
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `vd-native-${cryptoApi.randomUUID()}`;
  }
  return `vd-native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createNativeVideoDateSurfaceOwnerId() {
  return `vd-native-owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isValidNativeVideoDateClientInstanceId(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 120;
}

export function getOrCreateNativeVideoDateClientInstanceId(
  sessionId: string,
  profileId: string,
) {
  const key = nativeVideoDateSurfaceStorageKey(sessionId, profileId);
  const existing = nativeVideoDateSurfaceClientInstanceIds.get(key);
  if (isValidNativeVideoDateClientInstanceId(existing)) return existing;
  const next = createNativeVideoDateClientInstanceId();
  nativeVideoDateSurfaceClientInstanceIds.set(key, next);
  return next;
}

export function getCachedNativeVideoDateClientInstanceId(
  sessionId: string,
  profileId: string,
) {
  const key = nativeVideoDateSurfaceStorageKey(sessionId, profileId);
  const existing = nativeVideoDateSurfaceClientInstanceIds.get(key);
  return isValidNativeVideoDateClientInstanceId(existing) ? existing : null;
}
