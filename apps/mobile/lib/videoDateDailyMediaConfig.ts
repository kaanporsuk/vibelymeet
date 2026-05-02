import Daily from '@daily-co/react-native-daily-js';
import {
  isVideoDateCameraConstraintError,
  videoDateNativeVideoConstraintsForProfile,
  type VideoDateMediaCaptureProfile,
} from '@clientShared/matching/videoDateMediaContract';

export type NativeVideoDateCaptureProfile = VideoDateMediaCaptureProfile;
export type VideoDateDailyCallObject = ReturnType<typeof Daily.createCallObject>;

type NativeDailyCallOptions = NonNullable<Parameters<typeof Daily.createCallObject>[0]>;

export function videoDateNativeDailyCallOptions(
  profile: NativeVideoDateCaptureProfile,
): NativeDailyCallOptions {
  const videoConstraints = videoDateNativeVideoConstraintsForProfile(profile);

  return {
    audioSource: true,
    videoSource: true,
    sendSettings: {
      video: 'quality-optimized',
    },
    dailyConfig: {
      userMediaVideoConstraints: videoConstraints,
    },
  } as NativeDailyCallOptions;
}

export function createVideoDateDailyCallObject(
  profile: NativeVideoDateCaptureProfile = 'ideal',
): VideoDateDailyCallObject {
  return Daily.createCallObject(videoDateNativeDailyCallOptions(profile));
}

export { isVideoDateCameraConstraintError };
