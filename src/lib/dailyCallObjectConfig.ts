import type { DailyFactoryOptions } from "@daily-co/daily-js";
import {
  VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS,
  videoDateWebVideoConstraintsForProfile,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";

type WebDailyCallObjectMediaOptions = Pick<DailyFactoryOptions, "audioSource" | "videoSource">;
type VideoDateAppAcquiredMediaTracks = {
  audioTrack: MediaStreamTrack;
  videoTrack: MediaStreamTrack;
};
type DailyAdvancedConfigWithVideoDateKnobs = NonNullable<DailyFactoryOptions["dailyConfig"]> & {
  experimentalChromeVideoMuteLightOff?: boolean;
};

function readBooleanEnvFlag(name: string): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return String(env[name] ?? "false").toLowerCase() === "true";
}

export function dailyCallObjectOptions(options: WebDailyCallObjectMediaOptions): DailyFactoryOptions {
  const dailyConfig: DailyAdvancedConfigWithVideoDateKnobs = {
    avoidEval: true,
  };

  return {
    ...options,
    dailyConfig,
  };
}

export function videoDateWebMediaStreamConstraints(
  profile: VideoDateWebMediaCaptureProfile,
): MediaStreamConstraints {
  return {
    audio: true,
    video: videoDateWebVideoConstraintsForProfile(profile) as MediaTrackConstraints,
  };
}

export function dailyVideoDateCallObjectOptions(
  profile: VideoDateWebMediaCaptureProfile,
  appAcquiredMedia?: VideoDateAppAcquiredMediaTracks,
): DailyFactoryOptions {
  const videoConstraints = videoDateWebVideoConstraintsForProfile(profile) as MediaTrackConstraints;
  const bandwidthOptimized = readBooleanEnvFlag("VITE_VIDEO_DATE_DAILY_BANDWIDTH_OPTIMIZED");
  const devicePreferenceCookies = readBooleanEnvFlag("VITE_VIDEO_DATE_DAILY_DEVICE_PREFERENCE_COOKIES");
  const dailyConfig: DailyAdvancedConfigWithVideoDateKnobs = {
    avoidEval: true,
    experimentalChromeVideoMuteLightOff: true,
    ...(devicePreferenceCookies ? { useDevicePreferenceCookies: true } : {}),
  };

  return {
    audioSource: appAcquiredMedia?.audioTrack ?? true,
    videoSource: appAcquiredMedia?.videoTrack ?? true,
    inputSettings: {
      video: {
        settings: videoConstraints,
      },
    },
    sendSettings: {
      video: "quality-optimized",
      ...(bandwidthOptimized ? { video: "bandwidth-optimized" as const } : {}),
    },
    dailyConfig,
  };
}

export function dailyVideoDateCallObjectOptionsWithAppAcquiredMedia(
  profile: VideoDateWebMediaCaptureProfile,
  appAcquiredMedia: VideoDateAppAcquiredMediaTracks,
): DailyFactoryOptions {
  return dailyVideoDateCallObjectOptions(profile, appAcquiredMedia);
}

export const dailyVideoDateIdealCaptureConstraints = VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS;
