import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

const profileStudio = read("src/pages/ProfileStudio.tsx");
const vibeScoreDrawer = read("src/components/profile/VibeScoreDrawer.tsx");
const photoManageDrawer = read("src/components/photos/PhotoManageDrawer.tsx");

assert.match(
  profileStudio,
  /min-h-screen w-full max-w-\[100svw\] overflow-x-hidden bg-background/,
  "Profile Studio page shell should be horizontally contained",
);
assert.match(
  profileStudio,
  /mx-auto w-full max-w-lg min-w-0 overflow-x-hidden px-4/,
  "Profile Studio main content should not allow children to widen the document",
);

assert.match(
  profileStudio,
  /flex w-full max-w-full min-w-0 gap-2 overflow-x-auto overscroll-x-contain overflow-y-hidden scrollbar-hide/,
  "Quick Actions should keep horizontal scroll local",
);
assert.match(
  profileStudio,
  /max-w-full min-w-0 overflow-x-auto overscroll-x-contain overflow-y-hidden scrollbar-hide/,
  "Vibe Schedule should keep horizontal scroll local",
);
assert.doesNotMatch(
  profileStudio,
  /px-4 py-2 overflow-x-auto scrollbar-hide -mx-1 md:mx-0/,
  "Quick Actions must not use the old negative-margin horizontal scroller",
);

assert.match(
  profileStudio,
  /const PROFILE_STUDIO_DRAWER_PROPS = \{\s*shouldScaleBackground: false,\s*fixed: true,\s*\} as const;/,
  "Profile Studio drawers should opt out of Vaul background scaling and use fixed positioning",
);
assert.equal(
  countMatches(profileStudio, /<Drawer \{\.\.\.PROFILE_STUDIO_DRAWER_PROPS\}/g),
  8,
  "Every local Profile Studio drawer should use the shared mobile-safe Vaul props",
);
assert.match(
  profileStudio,
  /const PROFILE_STUDIO_DRAWER_CONTENT_CLASS = "max-h-\[88dvh\] w-full max-w-\[100svw\] overflow-hidden";/,
  "Profile Studio drawer content should be bounded by the visual viewport",
);
assert.match(
  profileStudio,
  /const PROFILE_STUDIO_DRAWER_BODY_CLASS =\s*"min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]";/,
  "Profile Studio drawer bodies should own vertical scroll and hide horizontal overflow",
);
assert.match(
  profileStudio,
  /const PROFILE_STUDIO_DRAWER_FOOTER_CLASS = "shrink-0 pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]";/,
  "Profile Studio drawer footers should preserve iOS safe-area padding",
);

assert.match(
  profileStudio,
  /const displayPrompts = promptSlots[\s\S]*\.sort\(\(a, b\) => Number\(b\.filled\) - Number\(a\.filled\)\);/,
  "The existing local prompt ordering should remain intact",
);
assert.match(
  profileStudio,
  /\{displayPrompts\.map\(\(\{ slot, index \}\) => \{/,
  "Prompt rendering should still use displayPrompts",
);

assert.match(
  vibeScoreDrawer,
  /const VIBE_SCORE_DRAWER_PROPS = \{\s*shouldScaleBackground: false,\s*fixed: true,\s*\} as const;/,
  "Vibe Score drawer should use the same mobile-safe Vaul root props",
);
assert.match(
  vibeScoreDrawer,
  /max-h-\[88dvh\] w-full max-w-\[100svw\] overflow-hidden/,
  "Vibe Score drawer content should be viewport bounded",
);
assert.match(
  vibeScoreDrawer,
  /min-h-0 flex-1 overflow-y-auto overflow-x-hidden/,
  "Vibe Score drawer body should not create horizontal overflow",
);

assert.match(
  photoManageDrawer,
  /fixed inset-0 z-50 flex w-\[100svw\] max-w-\[100svw\][^"]*overflow-hidden/,
  "Photo drawer overlay should be bounded to the small viewport width",
);
assert.match(
  photoManageDrawer,
  /relative z-10 flex w-full max-w-\[100svw\] flex-col overflow-hidden/,
  "Photo drawer modal shell should not exceed the viewport width",
);
assert.match(
  photoManageDrawer,
  /h-\[92dvh\] max-h-\[92dvh\]/,
  "Photo drawer mobile height should use dynamic viewport units",
);
assert.match(
  photoManageDrawer,
  /overflow-x-auto overscroll-x-contain overflow-y-hidden/,
  "Photo drawer filmstrip should keep horizontal scroll local",
);
assert.match(
  photoManageDrawer,
  /min-h-0 flex-1 overflow-y-auto overflow-x-hidden/,
  "Photo drawer grid body should own vertical scroll and hide horizontal overflow",
);
assert.match(
  photoManageDrawer,
  /pb-\[max\(1\.25rem,env\(safe-area-inset-bottom\)\)\]/,
  "Photo drawer footer should preserve iOS safe-area padding",
);
assert.match(
  photoManageDrawer,
  /fixed inset-0 z-\[9999\] flex w-\[100svw\] max-w-\[100svw\][^"]*overflow-hidden/,
  "Photo fullscreen viewer should also stay viewport bounded",
);
assert.match(
  photoManageDrawer,
  /max-w-\[90svw\] max-h-\[85dvh\]/,
  "Photo fullscreen image should use viewport-safe units",
);

console.log("profile-studio-mobile-overflow-contract: all assertions passed");
