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

/**
 * Audio session for playing voice messages.
 *
 * Two iOS failure modes this guards against:
 *  - default sessions have playsInSilentMode=false, so the hardware ring/silent switch
 *    fully mutes playback; we force playsInSilentMode=true so voice notes are audible.
 *  - after recording the session stays in PlayAndRecord (allowsRecording=true), which
 *    routes output to the quiet earpiece; we force allowsRecording=false so playback
 *    returns to the loudspeaker.
 *
 * Idempotent and safe to call before every play. Never throws (delegates to the guarded
 * setSafeAudioMode wrapper).
 */
export async function ensureVoicePlaybackAudioMode(): Promise<void> {
  await setSafeAudioMode({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    shouldDuckAndroid: false,
  });
}
