/**
 * Audio mode configuration is not available without the Expo AV native module.
 * This is a no-op until the next native rebuild includes it.
 *
 * Impact: On iOS silent mode, video playback may be silent.
 * This is acceptable — the app functioning is more important.
 */
export async function setSafeAudioMode(_config: {
  playsInSilentModeIOS?: boolean;
  allowsRecordingIOS?: boolean;
  staysActiveInBackground?: boolean;
  shouldDuckAndroid?: boolean;
}) {
  // No-op — AV audio session APIs not in current binary
  return;
}
