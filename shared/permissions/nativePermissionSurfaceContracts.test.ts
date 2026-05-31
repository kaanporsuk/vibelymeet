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
