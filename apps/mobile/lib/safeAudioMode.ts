import { setAudioModeAsync } from 'expo-audio';

/**
 * Safe audio session configuration through the Expo Audio module already present
 * in the native app. This intentionally does not use expo-av.
 */
export async function setSafeAudioMode(config: {
  playsInSilentModeIOS?: boolean;
  allowsRecordingIOS?: boolean;
  staysActiveInBackground?: boolean;
  shouldDuckAndroid?: boolean;
}) {
  try {
    await setAudioModeAsync({
      playsInSilentMode: config.playsInSilentModeIOS === true,
      allowsRecording: config.allowsRecordingIOS === true,
      shouldPlayInBackground: config.staysActiveInBackground === true,
      shouldRouteThroughEarpiece: false,
      interruptionMode:
        config.shouldDuckAndroid === true && config.playsInSilentModeIOS === true
          ? 'duckOthers'
          : 'doNotMix',
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[safeAudioMode] setAudioModeAsync failed', error);
    }
  }
}
