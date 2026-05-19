import type { MediaUploadFamily, MediaUploadInput } from "./types";

export type MediaV2FlagKey = "media_v2_video" | "media_v2_photo" | "media_v2_voice";

export interface MediaFeatureFlagGate {
  isEnabled(flag: MediaV2FlagKey, input?: MediaUploadInput): Promise<boolean>;
}

export function mediaFlagForFamily(family: MediaUploadFamily): MediaV2FlagKey {
  if (family === "vibe_video" || family === "chat_vibe_clip") return "media_v2_video";
  if (family === "voice_note") return "media_v2_voice";
  return "media_v2_photo";
}

export const defaultOffMediaFeatureFlagGate: MediaFeatureFlagGate = {
  async isEnabled() {
    return false;
  },
};

export function createStaticMediaFeatureFlagGate(
  config: boolean | Partial<Record<MediaV2FlagKey, boolean>>,
): MediaFeatureFlagGate {
  return {
    async isEnabled(flag) {
      if (typeof config === "boolean") return config;
      return config[flag] === true;
    },
  };
}
