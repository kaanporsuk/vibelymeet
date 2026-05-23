import {
  beginProfileVibeVideoTtffPlayback as beginSharedProfileVibeVideoTtffPlayback,
  completeProfileVibeVideoTtffPlayback as completeSharedProfileVibeVideoTtffPlayback,
  markProfileVibeVideoTtffPrewarm as markSharedProfileVibeVideoTtffPrewarm,
  type ProfileVibeVideoTtffContextInput,
} from "@clientShared/media/profileVibeVideoTtff";
import { isHlsMediaAssetUrl, isProfileVibeVideoRef } from "@/lib/mediaAssetResolver";
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from "@/lib/vibeVideo/vibeVideoTelemetry";

type WebProfileVibeVideoTtffContext = Omit<ProfileVibeVideoTtffContextInput, "profileId" | "platform" | "nowMs" | "sourceKind"> & {
  sourceRef?: string | null;
  sourceKind?: ProfileVibeVideoTtffContextInput["sourceKind"];
};

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function sourceKindFor(sourceRef: string | null | undefined): string {
  if (!sourceRef) return "unknown";
  if (isProfileVibeVideoRef(sourceRef)) return "profile_vibe_video_ref";
  if (isHlsMediaAssetUrl(sourceRef)) return "hls_url";
  return "legacy_url";
}

function contextFor(profileId: string | null | undefined, context: WebProfileVibeVideoTtffContext): ProfileVibeVideoTtffContextInput {
  return {
    ...context,
    profileId,
    platform: "web",
    nowMs: nowMs(),
    usesSignedProfileRef: context.usesSignedProfileRef ?? isProfileVibeVideoRef(context.sourceRef ?? ""),
    sourceKind: context.sourceKind ?? sourceKindFor(context.sourceRef),
  };
}

export function markProfileVibeVideoTtffPrewarm(
  profileId: string | null | undefined,
  context: WebProfileVibeVideoTtffContext,
): void {
  markSharedProfileVibeVideoTtffPrewarm(contextFor(profileId, context));
}

export function beginProfileVibeVideoTtffPlayback(
  profileId: string | null | undefined,
  context: WebProfileVibeVideoTtffContext,
): string | null {
  return beginSharedProfileVibeVideoTtffPlayback(contextFor(profileId, context));
}

export function completeProfileVibeVideoTtffPlayback(token: string | null | undefined): void {
  const payload = completeSharedProfileVibeVideoTtffPlayback({ token, nowMs: nowMs() });
  if (!payload) return;
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.profileTtffMeasured, payload);
}
