import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function findRepoFilesContaining(pattern: RegExp, relativeDir: string): string[] {
  const hits: string[] = [];
  const visit = (relativePath: string) => {
    const absolutePath = join(repoRoot, relativePath);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolutePath)) {
        if (entry === "node_modules" || entry === ".expo" || entry === "ios") continue;
        visit(join(relativePath, entry));
      }
      return;
    }
    if (!/\.(ts|tsx|json)$/.test(relativePath)) return;
    if (pattern.test(readFileSync(absolutePath, "utf8"))) hits.push(relativePath);
  };
  visit(relativeDir);
  return hits;
}

test("native Vibe Clip permission surface cannot reuse flex-filled preview buttons", () => {
  const source = readRepo("apps/mobile/app/chat/[id].tsx");
  const primaryStyle = /nativeClipPrimaryButton:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1] ?? "";
  const secondaryStyle = /nativeClipSecondaryButton:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1] ?? "";

  assert.doesNotMatch(primaryStyle, /\bflex:\s*1\b/);
  assert.doesNotMatch(secondaryStyle, /\bflex:\s*1\b/);
  assert.match(source, /native-vibe-clip-permission-card/);
  assert.match(source, /nativeClipPreviewActionButton:\s*\{[\s\S]*?\bflex:\s*1\b/);
});

test("native media pickers do not preflight broad photo-library permission", () => {
  const chat = readRepo("apps/mobile/app/chat/[id].tsx");
  const vibeVideo = readRepo("apps/mobile/app/vibe-video-record.tsx");
  const photoBatch = readRepo("apps/mobile/lib/photoBatchController.ts");
  const repoHits = findRepoFilesContaining(/requestMediaLibraryPermissionsAsync/, "apps/mobile");

  assert.doesNotMatch(chat, /requestMediaLibraryPermissionsAsync/);
  assert.doesNotMatch(vibeVideo, /requestMediaLibraryPermissionsAsync/);
  assert.doesNotMatch(photoBatch, /requestMediaLibraryPermissionsAsync/);
  assert.deepEqual(repoHits, []);
});

test("native reusable permission card uses fixed-height actions", () => {
  const source = readRepo("apps/mobile/components/permissions/PermissionRecoveryCard.tsx");
  assert.match(source, /minHeight:\s*48/);
  assert.doesNotMatch(source, /\bflex:\s*1\b/);
  assert.match(source, /availableWidth = Math\.max\(0, width - 32\)/);
  assert.match(source, /adjustsFontSizeToFit/);
  assert.match(source, /minimumFontScale=\{0\.82\}/);
  assert.match(source, /Open Settings|primaryLabel/);
});

test("native permission settings recovery is centralized and refreshes on app return", () => {
  const helper = readRepo("apps/mobile/lib/permissionSettings.ts");
  const matchCall = readRepo("apps/mobile/lib/useMatchCall.tsx");
  const directOpenSettingsHits = findRepoFilesContaining(/Linking\.openSettings\(/, "apps/mobile")
    .filter((path) => path !== "apps/mobile/lib/permissionSettings.ts");

  assert.match(helper, /export async function openPermissionSettings/);
  assert.match(helper, /Linking\.openSettings\(\)/);
  assert.match(helper, /Linking\.openURL\('app-settings:'\)/);
  assert.match(helper, /export function useSettingsReturnRefresh/);
  assert.match(helper, /AppState\.addEventListener\('change'/);
  assert.match(matchCall, /matchCallPermissionSettingsTargetRef/);
  assert.match(matchCall, /retryMatchCallMediaAfterSettingsReturn/);
  assert.match(matchCall, /next === 'active'[\s\S]*retryMatchCallMediaAfterSettingsReturn/);
  assert.match(matchCall, /setLocalAudio\(true\)/);
  assert.match(matchCall, /setLocalVideo\(true\)/);
  assert.deepEqual(directOpenSettingsHits, []);
});

test("native profile photo picker and camera launch failures stay recoverable", () => {
  const photoBatch = readRepo("apps/mobile/lib/photoBatchController.ts");

  assert.match(photoBatch, /showPhotoPickerFailureDialog/);
  assert.match(photoBatch, /showCameraLaunchFailureDialog/);
  assert.match(photoBatch, /openPermissionSettings\('photo_batch_camera_permission'\)/);
  assert.match(photoBatch, /openPermissionSettings\(source\)/);
  assert.match(photoBatch, /catch \(error\)[\s\S]*showPhotoPickerFailureDialog/);
  assert.match(photoBatch, /catch \(error\)[\s\S]*showCameraLaunchFailureDialog/);
});

test("native chat game photo pickers recover camera and library permission failures", () => {
  const bubble = readRepo("apps/mobile/components/chat/games/ScavengerBubble.tsx");
  const startSheet = readRepo("apps/mobile/components/chat/games/ScavengerStartSheet.tsx");

  for (const source of [bubble, startSheet]) {
    assert.match(source, /isPermissionLikeMediaError/);
    assert.match(source, /capability: fromCamera \? 'photo_capture' : 'photo_picker'/);
    assert.match(source, /Choose from library/);
    assert.match(source, /Take photo/);
    assert.match(source, /Camera issue/);
  }
});
