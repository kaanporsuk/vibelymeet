import type { DailyFactoryOptions } from "@daily-co/daily-js";

type WebDailyCallObjectMediaOptions = Pick<DailyFactoryOptions, "audioSource" | "videoSource">;

export function dailyCallObjectOptions(options: WebDailyCallObjectMediaOptions): DailyFactoryOptions {
  return {
    ...options,
    dailyConfig: {
      avoidEval: true,
    },
  };
}
