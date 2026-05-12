import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_VIBE_CAPTION_LEN,
  MAX_VIBE_VIDEO_DURATION_S,
} from "../src/lib/vibeVideo/constants.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("canonical web full profile shows non-playable Vibe Video states to all viewers", () => {
  const canonicalProfile = read("src/components/profile/OtherUserFullProfileView.tsx");

  assert.match(canonicalProfile, /vibeVideo\.state === "processing" \|\| vibeVideo\.state === "stale_processing"/);
  assert.match(canonicalProfile, /Vibe Video still processing/);
  assert.match(canonicalProfile, /Vibe Video processing/);
  assert.match(canonicalProfile, /vibeVideo\.state === "failed" \|\| vibeVideo\.state === "error"/);
  assert.match(canonicalProfile, /Vibe Video needs a fresh take/);
  assert.match(canonicalProfile, /Vibe Video unavailable/);
  assert.match(canonicalProfile, /vibeVideo\.state === "ready" && !vibeVideo\.playbackUrl/);
  assert.match(canonicalProfile, /Vibe Video preview syncing/);
});

test("canonical web full profile still shows ready playable Vibe Video", () => {
  const canonicalProfile = read("src/components/profile/OtherUserFullProfileView.tsx");

  assert.match(canonicalProfile, /hasPlayableVibeVideo && vibeVideo\.playbackUrl/);
  assert.match(canonicalProfile, /<VibePlayer/);
  assert.match(canonicalProfile, /aria-label="Watch Intro"/);
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
