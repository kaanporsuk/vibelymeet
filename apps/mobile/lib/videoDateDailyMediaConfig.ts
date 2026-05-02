import Daily from '@daily-co/react-native-daily-js';
import {
  isVideoDateCameraConstraintError,
  type VideoDateMediaCaptureProfile,
} from '@clientShared/matching/videoDateMediaContract';

export type NativeVideoDateCaptureProfile = VideoDateMediaCaptureProfile;
export type VideoDateDailyCallObject = ReturnType<typeof Daily.createCallObject>;

type NativeDailyCallOptions = NonNullable<Parameters<typeof Daily.createCallObject>[0]>;

export function videoDateNativeDailyCallOptions(
  profile: NativeVideoDateCaptureProfile,
): NativeDailyCallOptions {
  void profile;

  return {
    audioSource: true,
    videoSource: true,
    sendSettings: {
      video: 'quality-optimized',
    },
  } as NativeDailyCallOptions;
}

export function createVideoDateDailyCallObject(
  profile: NativeVideoDateCaptureProfile = 'ideal',
): VideoDateDailyCallObject {
  return Daily.createCallObject(videoDateNativeDailyCallOptions(profile));
}

export { isVideoDateCameraConstraintError };
