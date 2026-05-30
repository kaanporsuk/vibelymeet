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
const indexCss = read("src/index.css");
const bottomNav = read("src/components/navigation/BottomNav.tsx");
const heroVideoStatusCard = read("src/components/hero-video/HeroVideoStatusCard.tsx");
const vibeScoreDrawer = read("src/components/profile/VibeScoreDrawer.tsx");
const photoManageDrawer = read("src/components/photos/PhotoManageDrawer.tsx");

assert.match(
  indexCss,
  /html,\s*body,\s*#root\s*\{[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*overflow-x: hidden;/,
  "Global web root should not allow document-level horizontal overflow",
);
assert.match(
  indexCss,
  /#root\s*\{[\s\S]*min-height: 100%;[\s\S]*\}/,
  "Global root should retain full-height app sizing while clipping horizontal overflow",
);
assert.match(
  indexCss,
  /input:not\([\s\S]*\),\s*select,\s*textarea,\s*\[contenteditable="true"\]\s*\{[\s\S]*font-size: 16px;/,
  "Mobile iOS focus zoom guard should include native select controls",
);

assert.doesNotMatch(
  profileStudio,
  /100svw/,
  "Profile Studio should not use 100svw for page or drawer containment",
);
assert.match(
  profileStudio,
  /min-h-screen w-full max-w-full supports-\[width:100dvw\]:max-w-\[100dvw\] overflow-x-hidden bg-background/,
  "Profile Studio page shell should be horizontally contained",
);
assert.match(
  profileStudio,
  /mx-auto w-full max-w-lg min-w-0 overflow-x-hidden px-4/,
  "Profile Studio main content should not allow children to widen the document",
);
assert.match(
  profileStudio,
  /relative -mx-4 mb-0 max-w-\[calc\(100%_\+_2rem\)\] overflow-x-hidden/,
  "Profile Studio hero should clip its intentional full-bleed mobile treatment locally",
);
assert.match(
  profileStudio,
  /mt-3 md:mt-4 flex w-full max-w-full min-w-0 flex-row items-center justify-between gap-2 overflow-hidden/,
  "Profile Studio action row should stay inside the viewport",
);
assert.match(
  profileStudio,
  /grid w-full max-w-full min-w-0 grid-cols-3 gap-2 overflow-hidden/,
  "Profile Studio counters should stay inside the viewport",
);

assert.match(
  profileStudio,
  /flex w-full max-w-full min-w-0 gap-2 overflow-x-auto overscroll-x-contain overflow-y-hidden scrollbar-hide/,
  "Quick Actions should keep horizontal scroll local",
);
assert.match(
  profileStudio,
  /<HeroVideoStatusCard[\s\S]*className="max-w-full min-w-0 overflow-hidden"/,
  "Vibe Video status card should receive viewport-contained wrapper classes",
);
assert.match(
  heroVideoStatusCard,
  /const HERO_VIDEO_STATUS_CARD_BASE_CLASS = "max-w-full min-w-0 overflow-hidden rounded-2xl bg-white\/5";/,
  "HeroVideoStatusCard surfaces should be locally bounded by default",
);
assert.match(
  heroVideoStatusCard,
  /break-words/,
  "HeroVideoStatusCard async status and caption copy should wrap instead of widening the viewport",
);
assert.match(
  profileStudio,
  /flex w-full max-w-full min-w-0 flex-col gap-2 overflow-hidden/,
  "Photo grid should not widen the Profile Studio document",
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
assert.match(
  profileStudio,
  /const PROFILE_STUDIO_PROMPT_DRAWER_PROPS = \{\s*shouldScaleBackground: false,\s*fixed: true,\s*repositionInputs: false,\s*\} as const;/,
  "Profile Studio prompt drawer should disable Vaul input repositioning and own keyboard layout directly",
);
assert.match(
  profileStudio,
  /const PROFILE_STUDIO_BIO_DRAWER_PROPS = \{\s*shouldScaleBackground: false,\s*fixed: true,\s*repositionInputs: false,\s*\} as const;/,
  "Profile Studio bio drawer should disable Vaul input repositioning and own keyboard layout directly",
);
assert.doesNotMatch(
  profileStudio,
  /const PROFILE_STUDIO_PROMPT_DRAWER_PROPS = \{[\s\S]*repositionInputs: true,[\s\S]*\} as const;/,
  "Profile Studio prompt drawer must not re-enable Vaul's global input repositioner",
);
assert.doesNotMatch(
  profileStudio,
  /const PROFILE_STUDIO_BIO_DRAWER_PROPS = \{[\s\S]*repositionInputs: true,[\s\S]*\} as const;/,
  "Profile Studio bio drawer must not re-enable Vaul's global input repositioner",
);
assert.equal(
  countMatches(profileStudio, /<Drawer \{\.\.\.PROFILE_STUDIO_DRAWER_PROPS\}/g),
  6,
  "Every non-keyboard-specific local Profile Studio drawer should use the shared mobile-safe Vaul props",
);
assert.equal(
  countMatches(profileStudio, /<Drawer \{\.\.\.PROFILE_STUDIO_PROMPT_DRAWER_PROPS\}/g),
  1,
  "Only the prompt drawer should use keyboard-specific Vaul props",
);
assert.equal(
  countMatches(profileStudio, /<Drawer \{\.\.\.PROFILE_STUDIO_BIO_DRAWER_PROPS\}/g),
  1,
  "Only the About Me drawer should use bio-specific keyboard-safe Vaul props",
);
assert.match(
  profileStudio,
  /max-w-full min-w-0 overflow-hidden rounded-2xl border border-white\/10 bg-white\/5 p-4 backdrop-blur/,
  "Editable Profile Studio card wrappers should clip long async content locally",
);
assert.match(
  profileStudio,
  /break-words text-sm leading-relaxed/,
  "About Me copy should wrap instead of widening the viewport",
);
assert.match(
  profileStudio,
  /mb-4 grid max-w-full min-w-0 grid-cols-2 gap-2 overflow-hidden/,
  "Details grid should stay bounded on narrow mobile viewports",
);

assert.match(
  profileStudio,
  /const PROFILE_STUDIO_DRAWER_CONTENT_CLASS =\s*"max-h-\[88dvh\] w-full max-w-full supports-\[width:100dvw\]:max-w-\[100dvw\] overflow-hidden";/,
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
  profileStudio,
  /const promptDrawerBodyRef = useRef<HTMLDivElement \| null>\(null\);/,
  "Prompt drawer should keep a ref to its local scroll body",
);
assert.match(
  profileStudio,
  /const promptAnswerFieldRef = useRef<HTMLTextAreaElement \| null>\(null\);/,
  "Prompt drawer should keep a ref to the focused answer textarea",
);
assert.match(
  profileStudio,
  /const promptAnswerNudgeRafRef = useRef<number \| null>\(null\);[\s\S]*const promptAnswerNudgeTimeoutsRef = useRef<number\[\]>\(\[\]\);/,
  "Prompt drawer visibility nudges should be tracked so they can be cancelled",
);
assert.match(
  profileStudio,
  /const \[promptDrawerKeyboardStyle, setPromptDrawerKeyboardStyle\] = useState<CSSProperties \| undefined>\(\);/,
  "Prompt drawer should keep keyboard-time layout style in React state",
);
assert.match(
  profileStudio,
  /const promptDrawerStableViewportHeightRef = useRef<number \| null>\([\s\S]*Math\.max\(window\.visualViewport\?\.height \?\? 0, window\.innerHeight \?\? 0\)/,
  "Prompt drawer should keep a stable pre-keyboard viewport baseline",
);
assert.match(
  profileStudio,
  /const updatePromptDrawerKeyboardStyle = useCallback\(\(\) => \{[\s\S]*const currentViewportHeight = viewport\?\.height \?\? 0;[\s\S]*const currentLayoutHeight = window\.innerHeight;[\s\S]*const stableViewportHeight =[\s\S]*promptDrawerStableViewportHeightRef\.current[\s\S]*const keyboardOverlap = Math\.max\([\s\S]*currentLayoutHeight - currentViewportHeight,[\s\S]*stableViewportHeight - currentViewportHeight,[\s\S]*viewport\.offsetTop \+ PROFILE_STUDIO_PROMPT_KEYBOARD_GAP_PX[\s\S]*currentViewportHeight - PROFILE_STUDIO_PROMPT_KEYBOARD_GAP_PX/,
  "Prompt drawer should derive focused keyboard layout from visualViewport bounds and stable baseline",
);
assert.match(
  profileStudio,
  /setPromptDrawerKeyboardStyle\(\{\s*top: `\$\{top\}px`,\s*bottom: "auto",\s*height: `\$\{height\}px`,\s*maxHeight: `\$\{height\}px`,\s*marginTop: 0,\s*\}\);/,
  "Prompt drawer should apply top, bottom, height, maxHeight, and margin reset while the mobile keyboard is open",
);
assert.doesNotMatch(
  profileStudio,
  /Math\.max\(240,\s*viewport\.height/,
  "Prompt drawer keyboard height should not exceed the measured visual viewport on very short screens",
);
assert.doesNotMatch(
  profileStudio,
  /viewport\.height - PROFILE_STUDIO_PROMPT_KEYBOARD_GAP_PX \* 2/,
  "Prompt drawer should not leave a bottom gap that lets the page show above the keyboard",
);
assert.match(
  profileStudio,
  /const promptDrawerKeyboardStyleClearTimeoutRef = useRef<number \| null>\(null\);[\s\S]*const schedulePromptDrawerKeyboardStyleClear = useCallback/,
  "Prompt drawer should delay keyboard-style clearing after blur so Save/Cancel taps do not race layout movement",
);
assert.match(
  profileStudio,
  /onBlur=\{\(\) => \{[\s\S]*clearPromptAnswerNudges\(\);[\s\S]*schedulePromptDrawerKeyboardStyleClear\(\);[\s\S]*\}\}/,
  "Prompt answer blur should schedule keyboard-style cleanup instead of snapping the drawer immediately",
);
assert.match(
  profileStudio,
  /const clearPromptAnswerNudges = useCallback\(\(\) => \{[\s\S]*window\.cancelAnimationFrame\(promptAnswerNudgeRafRef\.current\);[\s\S]*window\.clearTimeout\(timeoutId\);/,
  "Prompt drawer should cancel queued visibility nudges on close/unmount",
);
assert.match(
  profileStudio,
  /const viewportTop = window\.visualViewport\?\.offsetTop \?\? 0;[\s\S]*const viewportBottom = viewportTop \+ \(window\.visualViewport\?\.height \?\? window\.innerHeight\);/,
  "Prompt drawer visibility math should account for shifted mobile visual viewport bounds",
);
assert.match(
  profileStudio,
  /const capturePromptDrawerStableViewportHeight = useCallback\(\(\) => \{[\s\S]*promptDrawerStableViewportHeightRef\.current = Math\.max\([\s\S]*window\.visualViewport\?\.height \?\? 0,[\s\S]*window\.innerHeight \?\? 0,[\s\S]*setActiveDrawer\(type\);[\s\S]*capturePromptDrawerStableViewportHeight\(\);[\s\S]*setActiveDrawer\("prompt"\);/,
  "Prompt drawer should capture the pre-keyboard viewport baseline when the prompt drawer opens",
);
assert.match(
  profileStudio,
  /const nudgePromptAnswerIntoView = useCallback\(\(\) => \{[\s\S]*if \(!body \|\| !answer \|\| document\.activeElement !== answer\) return;[\s\S]*updatePromptDrawerKeyboardStyle\(\);[\s\S]*const alignAnswer = \(\) => \{[\s\S]*updatePromptDrawerKeyboardStyle\(\);[\s\S]*const bodyRect = body\.getBoundingClientRect\(\);/,
  "Prompt drawer should refresh visual-viewport-owned layout during delayed answer nudges without recapturing the baseline",
);
assert.doesNotMatch(
  profileStudio,
  /if \(keyboardOverlap < PROFILE_STUDIO_PROMPT_KEYBOARD_THRESHOLD_PX\) \{[\s\S]*promptDrawerStableViewportHeightRef\.current = Math\.max\(currentViewportHeight, currentLayoutHeight\);/,
  "Prompt drawer keyboard animation must not chase small below-threshold viewport shrink steps while focused",
);
assert.doesNotMatch(
  profileStudio,
  /const nudgePromptAnswerIntoView = useCallback\(\(\) => \{[\s\S]*promptDrawerStableViewportHeightRef\.current = Math\.max\([\s\S]*const alignAnswer = \(\) => \{/,
  "Prompt drawer keyboard resize nudges must not replace the pre-keyboard viewport baseline",
);
assert.match(
  profileStudio,
  /viewport\?\.addEventListener\("resize", handlePromptViewportChange\);[\s\S]*viewport\?\.addEventListener\("scroll", handlePromptViewportChange\);/,
  "Prompt drawer should re-check answer visibility when the mobile visual viewport changes",
);
assert.match(
  profileStudio,
  /ref=\{promptAnswerFieldRef\}[\s\S]*onFocus=\{\(\) => \{[\s\S]*capturePromptDrawerStableViewportHeight\(\);[\s\S]*nudgePromptAnswerIntoView\(\);[\s\S]*\}\}/,
  "Prompt answer textarea should capture the baseline and nudge itself into view on focus",
);
assert.match(
  profileStudio,
  /<DrawerContent className=\{PROFILE_STUDIO_DRAWER_CONTENT_CLASS\} style=\{promptDrawerKeyboardStyle\}>/,
  "Prompt drawer content should receive the keyboard-time visual viewport style",
);

assert.match(
  profileStudio,
  /const \[bioDrawerKeyboardStyle, setBioDrawerKeyboardStyle\] = useState<CSSProperties \| undefined>\(\);/,
  "Bio drawer should keep keyboard-time layout style in React state",
);
assert.match(
  profileStudio,
  /const bioDrawerBodyRef = useRef<HTMLDivElement \| null>\(null\);[\s\S]*const bioFieldRef = useRef<HTMLTextAreaElement \| null>\(null\);/,
  "Bio drawer should keep refs to its local scroll body and focused textarea",
);
assert.match(
  profileStudio,
  /const bioDrawerNudgeRafRef = useRef<number \| null>\(null\);[\s\S]*const bioDrawerNudgeTimeoutsRef = useRef<number\[\]>\(\[\]\);/,
  "Bio drawer visibility nudges should be tracked so they can be cancelled",
);
assert.match(
  profileStudio,
  /const bioDrawerStableViewportHeightRef = useRef<number \| null>\([\s\S]*Math\.max\(window\.visualViewport\?\.height \?\? 0, window\.innerHeight \?\? 0\)/,
  "Bio drawer should keep a stable pre-keyboard viewport baseline",
);
assert.match(
  profileStudio,
  /const updateBioDrawerKeyboardStyle = useCallback\(\(\) => \{[\s\S]*activeDrawer !== "bio"[\s\S]*const currentViewportHeight = viewport\?\.height \?\? 0;[\s\S]*const currentLayoutHeight = window\.innerHeight;[\s\S]*const stableViewportHeight =[\s\S]*bioDrawerStableViewportHeightRef\.current[\s\S]*const keyboardOverlap = Math\.max\([\s\S]*currentLayoutHeight - currentViewportHeight,[\s\S]*stableViewportHeight - currentViewportHeight,[\s\S]*viewport\.offsetTop \+ PROFILE_STUDIO_BIO_KEYBOARD_GAP_PX[\s\S]*currentViewportHeight - PROFILE_STUDIO_BIO_KEYBOARD_GAP_PX/,
  "Bio drawer should derive focused keyboard layout from visualViewport bounds and stable baseline",
);
assert.match(
  profileStudio,
  /setBioDrawerKeyboardStyle\(\{\s*top: `\$\{top\}px`,\s*bottom: "auto",\s*height: `\$\{height\}px`,\s*maxHeight: `\$\{height\}px`,\s*marginTop: 0,\s*\}\);/,
  "Bio drawer should apply top, bottom, height, maxHeight, and margin reset while the mobile keyboard is open",
);
assert.match(
  profileStudio,
  /const bioDrawerKeyboardStyleClearTimeoutRef = useRef<number \| null>\(null\);[\s\S]*const scheduleBioDrawerKeyboardStyleClear = useCallback/,
  "Bio drawer should delay keyboard-style clearing after blur so Save/Cancel taps do not race layout movement",
);
assert.match(
  profileStudio,
  /const clearBioDrawerNudges = useCallback\(\(\) => \{[\s\S]*window\.cancelAnimationFrame\(bioDrawerNudgeRafRef\.current\);[\s\S]*window\.clearTimeout\(timeoutId\);/,
  "Bio drawer should cancel queued visibility nudges on close/unmount",
);
assert.match(
  profileStudio,
  /const nudgeBioFieldIntoView = useCallback\(\(\) => \{[\s\S]*if \(!body \|\| !input \|\| document\.activeElement !== input\) return;[\s\S]*updateBioDrawerKeyboardStyle\(\);[\s\S]*const alignInput = \(\) => \{[\s\S]*updateBioDrawerKeyboardStyle\(\);[\s\S]*const bodyRect = body\.getBoundingClientRect\(\);/,
  "Bio drawer should refresh visual-viewport-owned layout during delayed textarea nudges",
);
assert.match(
  profileStudio,
  /viewport\?\.addEventListener\("resize", handleBioViewportChange\);[\s\S]*viewport\?\.addEventListener\("scroll", handleBioViewportChange\);/,
  "Bio drawer should re-check textarea visibility when the mobile visual viewport changes",
);
assert.match(
  profileStudio,
  /ref=\{bioFieldRef\}[\s\S]*onFocus=\{\(\) => \{[\s\S]*captureBioDrawerStableViewportHeight\(\);[\s\S]*nudgeBioFieldIntoView\(\);[\s\S]*\}\}[\s\S]*onBlur=\{\(\) => \{[\s\S]*clearBioDrawerNudges\(\);[\s\S]*scheduleBioDrawerKeyboardStyleClear\(\);[\s\S]*\}\}/,
  "Bio textarea should capture the baseline on focus and schedule keyboard-style cleanup on blur",
);
assert.match(
  profileStudio,
  /<DrawerContent className=\{PROFILE_STUDIO_DRAWER_CONTENT_CLASS\} style=\{bioDrawerKeyboardStyle\}>/,
  "Bio drawer content should receive the keyboard-time visual viewport style",
);

assert.match(
  vibeScoreDrawer,
  /const VIBE_SCORE_DRAWER_PROPS = \{\s*shouldScaleBackground: false,\s*fixed: true,\s*\} as const;/,
  "Vibe Score drawer should use the same mobile-safe Vaul root props",
);
assert.match(
  vibeScoreDrawer,
  /max-h-\[88dvh\] w-full max-w-full supports-\[width:100dvw\]:max-w-\[100dvw\] overflow-hidden/,
  "Vibe Score drawer content should be viewport bounded",
);
assert.doesNotMatch(
  vibeScoreDrawer,
  /100svw/,
  "Vibe Score drawer should not use small viewport width containment",
);
assert.match(
  vibeScoreDrawer,
  /min-h-0 flex-1 overflow-y-auto overflow-x-hidden/,
  "Vibe Score drawer body should not create horizontal overflow",
);

assert.match(
  photoManageDrawer,
  /PHOTO_VIEWPORT_WIDTH_CLASS =\s*"w-full max-w-full supports-\[width:100dvw\]:w-\[100dvw\] supports-\[width:100dvw\]:max-w-\[100dvw\]";/,
  "Photo drawer overlays should use full-width fallbacks with dynamic viewport enhancement",
);
assert.match(
  photoManageDrawer,
  /relative z-10 flex w-full min-w-0 flex-col overflow-hidden border border-white\/10 bg-\[#0D0B1A\]/,
  "Photo drawer modal shell should stay width-safe without a shared dynamic-viewport max-width",
);
assert.doesNotMatch(
  photoManageDrawer,
  /relative z-10 flex w-full max-w-full supports-\[width:100dvw\]:max-w-\[100dvw\] min-w-0 flex-col overflow-hidden/,
  "Photo drawer modal shell must not let dynamic viewport max-width override the desktop cap",
);
assert.match(
  photoManageDrawer,
  /\? "h-\[92dvh\] max-h-\[92dvh\] max-w-full supports-\[width:100dvw\]:max-w-\[100dvw\] rounded-t-2xl"/,
  "Photo drawer mobile shell should keep dynamic viewport width containment",
);
assert.match(
  photoManageDrawer,
  /: "max-h-\[88dvh\] max-w-\[560px\] rounded-2xl"/,
  "Photo drawer desktop shell should preserve the compact 560px gallery manager",
);
assert.match(
  photoManageDrawer,
  /const \[isMobile, setIsMobile\] = useState\(\(\) => typeof window !== "undefined" && window\.innerWidth < 768\);/,
  "Photo drawer should choose the mobile sheet animation before the first mobile paint",
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
  /fixed inset-0 z-\[9999\] flex items-center justify-center overflow-hidden bg-black\/95/,
  "Photo fullscreen viewer should also stay viewport bounded",
);
assert.match(
  photoManageDrawer,
  /max-w-\[90vw\] supports-\[width:100dvw\]:max-w-\[90dvw\] max-h-\[85dvh\]/,
  "Photo fullscreen image should use viewport-safe units",
);
assert.doesNotMatch(
  photoManageDrawer,
  /100svw|90svw/,
  "Photo management overlays should not use small viewport width containment",
);

assert.match(
  bottomNav,
  /fixed left-1\/2 z-50 flex w-\[min\(32rem,calc\(100%_-_2rem\)\)\] max-w-\[calc\(100dvw_-_2rem\)\] -translate-x-1\/2/,
  "BottomNav should be centered with a compatible width fallback and dynamic-viewport max bound",
);
assert.doesNotMatch(
  bottomNav,
  /bottom-3 left-4 right-4 mx-auto/,
  "BottomNav should not use left/right fixed offsets that can contribute to document width",
);

console.log("profile-studio-mobile-overflow-contract: all assertions passed");
