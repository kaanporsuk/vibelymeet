/**
 * Opt-in runtime diagnostics for web OneSignal / permission flows.
 * Enable: localStorage.setItem('vibely_onesignal_debug', '1') then hard refresh.
 */
export function vibelyOneSignalDebugEnabled(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem("vibely_onesignal_debug") === "1";
  } catch {
    return false;
  }
}

export function vibelyOsLog(phase: string, payload?: Record<string, unknown>): void {
  if (!vibelyOneSignalDebugEnabled()) return;
  const perm =
    typeof Notification !== "undefined" ? Notification.permission : "Notification API missing";
  console.log("[VibelyOneSignalDbg]", phase, { ...payload, Notification_permission: perm });
}
