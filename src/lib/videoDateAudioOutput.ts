/**
 * Web audio output device routing for the video date.
 *
 * Definitive contract:
 *   - `isSetSinkIdSupported()` reports support for HTMLMediaElement.setSinkId.
 *     Even when supported, applying a non-default sinkId still requires that
 *     the user has granted media permission so audiooutput labels are populated.
 *   - `enumerateAudioOutputDevices()` is a thin wrapper around
 *     navigator.mediaDevices.enumerateDevices() that returns only audiooutput
 *     entries. Any error is swallowed and treated as "no devices" — callers
 *     should fall back to the OS default.
 *   - `applyAudioOutputDeviceToElement()` is idempotent. It returns
 *     `{ ok: true }` on success, `{ ok: false, reason }` when the browser
 *     cannot honor the request. Reasons are stable strings safe to log.
 *   - Preference persistence uses a single localStorage key so the picker
 *     survives reloads, but a sinkId that is no longer present on the device
 *     is detected at apply-time and falls back to "default".
 *
 * iOS Safari (all versions through 17), older Firefox (<116) and very old
 * Chromium do not implement setSinkId. The picker is hidden in those cases
 * and a one-line explanation is shown instead.
 */

const STORAGE_KEY = "vibely:videoDate:audioOutputDeviceId";
const DEFAULT_DEVICE_ID = "default";

export type AudioOutputDevice = {
  deviceId: string;
  label: string;
  /** True when this is the OS default sink. */
  isDefault: boolean;
  /** True when the OS routes this through the system communications profile. */
  isCommunications: boolean;
};

export type ApplyAudioOutputFailureReason =
  | "no_element"
  | "unsupported_browser"
  | "no_device_id"
  | "device_not_found"
  | "permission_denied"
  | "abort"
  | "unknown_error";

export type ApplyAudioOutputResult = {
  ok: boolean;
  deviceId?: string;
  reason?: ApplyAudioOutputFailureReason;
  message?: string;
};

type SetSinkIdElement = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

export function isSetSinkIdSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof HTMLMediaElement === "undefined") return false;
  return typeof (HTMLMediaElement.prototype as SetSinkIdElement).setSinkId === "function";
}

export function isAudioDeviceEnumerationSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.enumerateDevices === "function";
}

export async function enumerateAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (!isAudioDeviceEnumerationSupported()) return [];
  try {
    const all = await navigator.mediaDevices!.enumerateDevices();
    return (all ?? [])
      .filter((device): device is MediaDeviceInfo => device.kind === "audiooutput")
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || (
          device.deviceId === DEFAULT_DEVICE_ID
            ? "System default"
            : device.deviceId === "communications"
              ? "Communications device"
              : "Audio output"
        ),
        isDefault: device.deviceId === DEFAULT_DEVICE_ID,
        isCommunications: device.deviceId === "communications",
      }));
  } catch {
    return [];
  }
}

export function loadStoredAudioOutputDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function storeAudioOutputDeviceId(deviceId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (!deviceId) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    /* localStorage may be disabled (private browsing); preference becomes session-only. */
  }
}

export async function applyAudioOutputDeviceToElement(
  element: HTMLMediaElement | null,
  deviceId: string | null | undefined,
): Promise<ApplyAudioOutputResult> {
  if (!element) return { ok: false, reason: "no_element" };
  if (!isSetSinkIdSupported()) return { ok: false, reason: "unsupported_browser" };
  if (!deviceId) return { ok: false, reason: "no_device_id" };

  const node = element as SetSinkIdElement;
  if (typeof node.setSinkId !== "function") {
    return { ok: false, reason: "unsupported_browser" };
  }

  // Already applied — short-circuit so we don't churn audio output during
  // reconnects or remote track swaps.
  if (typeof node.sinkId === "string" && node.sinkId === deviceId) {
    return { ok: true, deviceId };
  }

  try {
    await node.setSinkId(deviceId);
    return { ok: true, deviceId };
  } catch (err) {
    if (err && typeof err === "object" && "name" in err) {
      const name = (err as { name?: string }).name ?? "";
      const message = (err as { message?: string }).message ?? "";
      if (name === "NotFoundError") {
        return { ok: false, reason: "device_not_found", message };
      }
      if (name === "SecurityError" || name === "NotAllowedError") {
        return { ok: false, reason: "permission_denied", message };
      }
      if (name === "AbortError") {
        return { ok: false, reason: "abort", message };
      }
      return { ok: false, reason: "unknown_error", message: `${name}: ${message}` };
    }
    return {
      ok: false,
      reason: "unknown_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Apply the user's stored preference (or the system default) to the element.
 * Falls back to "default" if the stored sinkId is no longer enumerated, and
 * clears the stale storage key so the picker reflects reality.
 */
export async function applyStoredAudioOutputPreference(
  element: HTMLMediaElement | null,
  options: { availableDevices?: AudioOutputDevice[] } = {},
): Promise<ApplyAudioOutputResult> {
  if (!element) return { ok: false, reason: "no_element" };
  if (!isSetSinkIdSupported()) return { ok: false, reason: "unsupported_browser" };

  const stored = loadStoredAudioOutputDeviceId();
  const devices = options.availableDevices ?? (await enumerateAudioOutputDevices());
  const desiredId = stored && devices.some((d) => d.deviceId === stored) ? stored : DEFAULT_DEVICE_ID;

  const result = await applyAudioOutputDeviceToElement(element, desiredId);

  if (!result.ok && stored && result.reason === "device_not_found") {
    storeAudioOutputDeviceId(null);
  }

  return result;
}

export const VIDEO_DATE_AUDIO_OUTPUT_DEFAULT_ID = DEFAULT_DEVICE_ID;
