import Daily from '@daily-co/react-native-daily-js';
import {
  isVideoDateCameraConstraintError,
  type VideoDateNativeMediaCaptureProfile,
} from '@clientShared/matching/videoDateMediaContract';
import {
  createNativeDailyCallObjectGuarded,
  type GuardedNativeDailyCreateResult,
} from '@/lib/nativeDailyCallInstance';

export type NativeVideoDateCaptureProfile = VideoDateNativeMediaCaptureProfile;
export type VideoDateDailyCallObject = ReturnType<typeof Daily.createCallObject>;

type NativeDailyCallOptions = NonNullable<Parameters<typeof Daily.createCallObject>[0]>;

function readBooleanEnvFlag(name: string): boolean {
  return String(process.env[name] ?? 'false').toLowerCase() === 'true';
}

export function videoDateNativeDailyCallOptions(
  profile: NativeVideoDateCaptureProfile,
): NativeDailyCallOptions {
  void profile;
  const bandwidthOptimized = readBooleanEnvFlag('EXPO_PUBLIC_VIDEO_DATE_DAILY_BANDWIDTH_OPTIMIZED');

  return {
    audioSource: true,
    videoSource: true,
    sendSettings: {
      video: 'quality-optimized',
      ...(bandwidthOptimized ? { video: 'bandwidth-optimized' as const } : {}),
    },
  } as NativeDailyCallOptions;
}

export function createVideoDateDailyCallObjectGuarded(
  profile: NativeVideoDateCaptureProfile = 'ideal',
  options: Parameters<typeof createNativeDailyCallObjectGuarded>[1],
): Promise<GuardedNativeDailyCreateResult> {
  return createNativeDailyCallObjectGuarded(videoDateNativeDailyCallOptions(profile), options);
}

export function createVideoDateDailyDiagnosticCallObjectGuarded(
  options: Parameters<typeof createNativeDailyCallObjectGuarded>[1],
): Promise<GuardedNativeDailyCreateResult> {
  return createNativeDailyCallObjectGuarded({
    audioSource: false,
    videoSource: false,
  } as NativeDailyCallOptions, options);
}

export { isVideoDateCameraConstraintError };
