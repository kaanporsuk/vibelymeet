import type { DailyFactoryOptions } from "@daily-co/daily-js";
import {
  VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS,
  videoDateWebVideoConstraintsForProfile,
  type VideoDateMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";

type WebDailyCallObjectMediaOptions = Pick<DailyFactoryOptions, "audioSource" | "videoSource">;

export function dailyCallObjectOptions(options: WebDailyCallObjectMediaOptions): DailyFactoryOptions {
  return {
    ...options,
    dailyConfig: {
      avoidEval: true,
    },
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
    },
    dailyConfig: {
      avoidEval: true,
    },
  };
}

export const dailyVideoDateIdealCaptureConstraints = VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS;
