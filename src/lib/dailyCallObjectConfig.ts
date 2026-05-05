import type { DailyFactoryOptions } from "@daily-co/daily-js";
import {
  VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS,
  videoDateWebVideoConstraintsForProfile,
  type VideoDateMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";

type WebDailyCallObjectMediaOptions = Pick<DailyFactoryOptions, "audioSource" | "videoSource">;
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
  profile: VideoDateMediaCaptureProfile,
): MediaStreamConstraints {
  return {
    audio: true,
    video: videoDateWebVideoConstraintsForProfile(profile) as MediaTrackConstraints,
  };
}

export function dailyVideoDateCallObjectOptions(
  profile: VideoDateMediaCaptureProfile,
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
    audioSource: true,
    videoSource: true,
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

export const dailyVideoDateIdealCaptureConstraints = VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS;
