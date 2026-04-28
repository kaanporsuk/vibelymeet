import type { WebVibeVideoInfo } from "./webVibeVideoState";

export type ProfilePreviewVibeVideoSection =
  | { type: "video"; data: string }
  | { type: "vibe_pipeline" }
  | { type: "vibe_failed" }
  | { type: "vibe_cdn" };

export function getProfilePreviewVibeVideoSections(
  vibeVideo: Pick<WebVibeVideoInfo, "state" | "playbackUrl">,
  isOwnProfile = false,
): ProfilePreviewVibeVideoSection[] {
  if (vibeVideo.state === "ready" && vibeVideo.playbackUrl) {
    return [{ type: "video", data: vibeVideo.playbackUrl }];
  }

  if (!isOwnProfile) {
    return [];
  }

  if (vibeVideo.state === "processing" || vibeVideo.state === "uploading") {
    return [{ type: "vibe_pipeline" }];
  }

  if (vibeVideo.state === "failed") {
    return [{ type: "vibe_failed" }];
  }

  if (vibeVideo.state === "ready" && !vibeVideo.playbackUrl) {
    return [{ type: "vibe_cdn" }];
  }

  return [];
}
