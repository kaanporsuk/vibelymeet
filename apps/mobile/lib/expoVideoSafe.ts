/** Avoid NativeSharedObjectNotFoundException when expo-video player is already disposed. */
export function safeVideoPlayerCall(fn: () => void) {
  try {
    fn();
  } catch {
    /* no-op */
  }
}
