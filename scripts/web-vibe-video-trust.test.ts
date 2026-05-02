import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getProfilePreviewVibeVideoSections,
} from "../src/lib/vibeVideo/profilePreviewVisibility.ts";
import {
  MAX_VIBE_CAPTION_LEN,
  MAX_VIBE_VIDEO_DURATION_S,
} from "../src/lib/vibeVideo/constants.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sectionTypes(
  state: Parameters<typeof getProfilePreviewVibeVideoSections>[0]["state"],
  playbackUrl: string | null,
  isOwnProfile?: boolean,
): string[] {
  return getProfilePreviewVibeVideoSections({ state, playbackUrl }, isOwnProfile).map((section) => section.type);
}

test("ProfilePreview shows processing state to all viewers", () => {
  assert.deepEqual(sectionTypes("processing", null, true), ["vibe_pipeline"]);
  assert.deepEqual(sectionTypes("stale_processing", null, true), ["vibe_pipeline"]);

  assert.deepEqual(sectionTypes("processing", null, false), ["vibe_pipeline"]);
  assert.deepEqual(sectionTypes("stale_processing", null, false), ["vibe_pipeline"]);
  assert.deepEqual(sectionTypes("processing", null), ["vibe_pipeline"]);
  assert.deepEqual(sectionTypes("stale_processing", null), ["vibe_pipeline"]);
});

test("ProfilePreview shows failed state to all viewers", () => {
  assert.deepEqual(sectionTypes("failed", null, true), ["vibe_failed"]);
  assert.deepEqual(sectionTypes("failed", null, false), ["vibe_failed"]);
});

test("ProfilePreview shows CDN-stuck ready state to all viewers", () => {
  assert.deepEqual(sectionTypes("ready", null, true), ["vibe_cdn"]);
  assert.deepEqual(sectionTypes("ready", null, false), ["vibe_cdn"]);
});

test("ProfilePreview still shows ready playable Vibe Video to non-owners", () => {
  assert.deepEqual(sectionTypes("ready", "https://cdn.example/video/playlist.m3u8", false), ["video"]);
});

test("web Vibe Video duration and caption constants are canonical and wired into web upload surfaces", () => {
  assert.equal(MAX_VIBE_VIDEO_DURATION_S, 15);
  assert.equal(MAX_VIBE_CAPTION_LEN, 50);

  const onboardingStep = read("src/pages/onboarding/steps/VibeVideoStep.tsx");
  const vibeStudioModal = read("src/components/vibe-video/VibeStudioModal.tsx");
  const vibeStudio = read("src/pages/VibeStudio.tsx");

  assert.match(onboardingStep, /MAX_VIBE_VIDEO_DURATION_S/);
  assert.doesNotMatch(onboardingStep, /MAX_DURATION_S\s*=\s*20/);
  assert.match(vibeStudioModal, /MAX_VIBE_VIDEO_DURATION_S/);
  assert.doesNotMatch(vibeStudioModal, /MAX_CLIP_DURATION\s*=\s*20/);
  assert.match(vibeStudio, /MAX_VIBE_CAPTION_LEN/);
  assert.doesNotMatch(vibeStudio, /const CAPTION_MAX\s*=\s*50/);
});

test("web profile and studio keep Vibe Video management available through delete/recovery states", () => {
  const profileStudio = read("src/pages/ProfileStudio.tsx");
  const vibeStudio = read("src/pages/VibeStudio.tsx");
  const heroController = read("src/lib/heroVideo/heroVideoUploadController.ts");

  assert.match(profileStudio, /resolveWebVibeVideoState/);
  assert.match(profileStudio, /const canManageVibeVideo\s*=/);
  assert.match(profileStudio, /resolvedVibeVideo\.canManage/);
  assert.doesNotMatch(profileStudio, /\{profile\.bunnyVideoUid \? \(/);

  assert.match(vibeStudio, /heroVideoReset/);
  assert.match(vibeStudio, /heroVideoReset\(\);/);
  assert.match(vibeStudio, /bunnyVideoUid:\s*null/);
  assert.match(vibeStudio, /bunnyVideoStatus:\s*"none"/);
  assert.match(vibeStudio, /setCaptionDraft\(""\)/);

  assert.match(heroController, /if \(!rowUid\) \{/);
  assert.match(heroController, /phase:\s*"idle", uploadProgress:\s*0, videoId:\s*null/);
});

test("native profile labels non-empty Vibe Video states as manageable", () => {
  const nativeProfileStudio = read("apps/mobile/app/(tabs)/profile/ProfileStudio.tsx");
  const nativeState = read("apps/mobile/lib/vibeVideoState.ts");
  const nativeStudio = read("apps/mobile/app/vibe-studio.tsx");

  assert.match(nativeProfileStudio, /showVibeVideoManageLabel/);
  assert.match(nativeProfileStudio, /\? 'Manage' : 'Open Studio'/);
  assert.match(nativeState, /canPlay: false, canManage: true, canDelete: true/);
  assert.match(nativeStudio, /nativeHeroVideoReset\(\);/);
  assert.match(nativeStudio, /bunny_video_uid:\s*null/);
  assert.match(nativeStudio, /bunny_video_status:\s*'none'/);
});

test("web Vibe Studio refresh repairs playable Bunny uploads stuck in uploading", () => {
  const sync = read("src/lib/vibeVideo/syncVibeVideoStatus.ts");
  const studio = read("src/pages/VibeStudio.tsx");
  const heroController = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const syncFunction = read("supabase/functions/sync-vibe-video-status/index.ts");

  assert.match(sync, /sync-vibe-video-status/);
  assert.match(sync, /body: \{ videoId: uid \}/);
  assert.match(studio, /await syncCurrentVibeVideoStatus\(effectiveVibeVideo\.bunnyVideoUid, "manual_refresh"\)/);
  assert.match(heroController, /await syncCurrentVibeVideoStatus\(expectedVideoId, "processing_poll"\)/);
  assert.match(syncFunction, /status === 3 \|\| status === 4/);
  assert.match(syncFunction, /mappedStatus/);
  assert.match(syncFunction, /update_media_session_status/);
});
