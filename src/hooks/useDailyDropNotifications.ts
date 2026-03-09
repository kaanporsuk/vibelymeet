// Daily Drop notifications are now handled server-side via generate-daily-drops edge function.
// This hook is kept as a minimal stub for backward compatibility.

export function useDailyDropNotifications() {
  return {
    isSupported: false,
    isEnabled: false,
    requestPermission: async () => false,
    sendDropReadyNotification: () => null,
    scheduleNextDropNotification: () => null,
  };
}
