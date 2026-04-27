import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("inline VibePlayer uses the shared HLS attachment path", () => {
  const player = read("src/components/vibe-video/VibePlayer.tsx");
  const attach = read("src/lib/vibeVideo/attachHlsPlayback.ts");

  assert.match(player, /attachHlsPlayback/);
  assert.doesNotMatch(player, /src=\{shouldLoad \? videoUrl : undefined\}/);
  assert.match(attach, /import\("hls\.js"\)/);
  assert.match(attach, /Hls\.isSupported\(\)/);
  assert.match(attach, /application\/vnd\.apple\.mpegurl/);
});

test("native onboarding no longer sends pending as a Vibe Video uid", () => {
  const record = read("apps/mobile/app/vibe-video-record.tsx");
  const onboarding = read("apps/mobile/app/(onboarding)/index.tsx");

  assert.doesNotMatch(record, /returnToOnboarding\(['"]pending['"]\)/);
  assert.match(onboarding, /normalizeBunnyVideoUid/);
});

test("web and native upload controllers expose an explicit stalled phase", () => {
  const web = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const native = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");

  assert.match(web, /"stalled"/);
  assert.match(native, /'stalled'/);
  assert.match(web, /taking longer than expected/);
  assert.match(native, /taking longer than expected/);
});
