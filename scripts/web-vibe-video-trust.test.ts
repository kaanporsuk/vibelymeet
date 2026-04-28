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

test("ProfilePreview shows uploading/processing diagnostics only to owners", () => {
  assert.deepEqual(sectionTypes("uploading", null, true), ["vibe_pipeline"]);
  assert.deepEqual(sectionTypes("processing", null, true), ["vibe_pipeline"]);

  assert.deepEqual(sectionTypes("uploading", null, false), []);
  assert.deepEqual(sectionTypes("processing", null, false), []);
  assert.deepEqual(sectionTypes("processing", null), [], "safe default should be non-owner visibility");
});

test("ProfilePreview shows failed diagnostics only to owners", () => {
  assert.deepEqual(sectionTypes("failed", null, true), ["vibe_failed"]);
  assert.deepEqual(sectionTypes("failed", null, false), []);
});

test("ProfilePreview shows CDN-stuck ready diagnostics only to owners", () => {
  assert.deepEqual(sectionTypes("ready", null, true), ["vibe_cdn"]);
  assert.deepEqual(sectionTypes("ready", null, false), []);
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
