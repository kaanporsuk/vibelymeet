import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const webChat = read("src/pages/Chat.tsx");
const dateSuggestionChip = read("src/components/chat/DateSuggestionChip.tsx");
const nativeChat = read("apps/mobile/app/chat/[id].tsx");

test("web chat scrolling owns the real scroller and preserves user intent", () => {
  assert.match(
    webChat,
    /const scrollToBottom = useCallback[\s\S]*const el = mainScrollRef\.current[\s\S]*el\.scrollTo\(\{[\s\S]*top: el\.scrollHeight/,
  );
  assert.match(
    webChat,
    /const suspendAutoStickForUserScroll = useCallback\(\(\) => \{[\s\S]*userScrollIntentUntilRef\.current = Date\.now\(\) \+ 900;[\s\S]*stickToBottomRef\.current = false;/,
  );
  assert.match(webChat, /onWheel=\{onMainWheel\}/);
  assert.match(webChat, /onTouchStart=\{onMainTouchStart\}/);
  assert.match(webChat, /onTouchMove=\{onMainTouchMove\}/);
  assert.match(webChat, /onTouchCancel=\{onMainTouchEnd\}/);
  assert.match(webChat, /className="[^"]*overflow-y-auto[^"]*overscroll-contain/);
  assert.match(webChat, /style=\{\{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" \}\}/);
});

test("web chat avoids jumpy rich-content reflow and older-message prepend snaps", () => {
  assert.match(
    webChat,
    /const ro = new ResizeObserver\(\(\) => \{[\s\S]*if \(!stickToBottomRef\.current\) return;[\s\S]*if \(isUserScrollIntentActive\(\)\) return;[\s\S]*scheduleStickyBottomSnap\(\{ instant: true \}\);/,
  );
  assert.match(webChat, /if \(!node \|\| typeof ResizeObserver === "undefined"\) return;/);
  assert.match(
    webChat,
    /olderPageScrollSnapshotRef\.current = null;[\s\S]*userScrollIntentUntilRef\.current = Date\.now\(\) \+ 900;[\s\S]*el\.scrollTop = el\.scrollHeight - snapshot\.scrollHeight \+ snapshot\.scrollTop;/,
  );
  assert.match(webChat, /setNewBelowCue\(true\)/);
  assert.match(webChat, /<span className="block aspect-\[4\/5\] w-60 max-w-full overflow-hidden/);
});

test("web chat tracks visual viewport and composer layout before sticky keyboard snaps", () => {
  assert.match(webChat, /const composerChromeRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(webChat, /const \[visualViewportHeight, setVisualViewportHeight\] = useState<number \| null>/);
  assert.match(
    webChat,
    /const scheduleStickyBottomSnap = useCallback\(\(opts\?: \{ instant\?: boolean \}\) => \{[\s\S]*if \(!stickToBottomRef\.current\) return;[\s\S]*if \(isUserScrollIntentActive\(\)\) return;[\s\S]*window\.requestAnimationFrame/,
  );
  assert.match(webChat, /const viewport = window\.visualViewport/);
  assert.match(webChat, /viewport\.addEventListener\("resize", updateViewportHeight\)/);
  assert.match(webChat, /viewport\.addEventListener\("scroll", updateViewportHeight\)/);
  assert.match(webChat, /const chatViewportStyle = useMemo\(/);
  assert.match(webChat, /style=\{chatViewportStyle\}/);
  assert.match(webChat, /<div ref=\{composerChromeRef\} className="relative z-40 shrink-0">/);
  assert.match(webChat, /onFocus=\{\(\) => scheduleStickyBottomSnap\(\{ instant: false \}\)\}/);
});

test("web floating chat controls do not block scroll gestures outside their real controls", () => {
  assert.match(dateSuggestionChip, /className="pointer-events-none absolute bottom-full/);
  assert.match(dateSuggestionChip, /className="pointer-events-auto glass-card/);
  assert.match(webChat, /<div className="pointer-events-none absolute inset-x-0 bottom-3/);
  assert.match(webChat, /className="pointer-events-auto inline-flex/);
});

test("native chat FlatList separates user drag intent from automatic bottom stickiness", () => {
  assert.match(nativeChat, /const userScrollIntentUntilRef = useRef\(0\)/);
  assert.match(
    nativeChat,
    /const markListUserScrollIntent = useCallback\(\(\) => \{[\s\S]*userScrollIntentUntilRef\.current = Date\.now\(\) \+ 1000;[\s\S]*stickToBottomRef\.current = false;/,
  );
  assert.match(
    nativeChat,
    /const settleListUserScrollIntent = useCallback[\s\S]*const atBottom = dist < 100;[\s\S]*stickToBottomRef\.current = atBottom;/,
  );
  assert.match(
    nativeChat,
    /const listOnContentSizeChange = useCallback[\s\S]*if \(!stickToBottomRef\.current\) return;[\s\S]*if \(isListUserScrollIntentActive\(\)\) return;[\s\S]*scrollListToEnd\(false\);/,
  );
  assert.match(nativeChat, /onScrollBeginDrag=\{markListUserScrollIntent\}/);
  assert.match(nativeChat, /onScrollEndDrag=\{settleListUserScrollIntent\}/);
  assert.match(nativeChat, /onMomentumScrollBegin=\{markListUserScrollIntent\}/);
  assert.match(nativeChat, /onMomentumScrollEnd=\{settleListUserScrollIntent\}/);
  assert.match(nativeChat, /keyboardDismissMode=\{Platform\.OS === 'ios' \? 'interactive' : 'on-drag'\}/);
  assert.match(nativeChat, /nestedScrollEnabled/);
});

test("native chat tracks keyboard and layout transitions before sticky keyboard snaps", () => {
  assert.match(nativeChat, /\bKeyboard,\s*[\s\S]*KeyboardAvoidingView,/);
  assert.match(nativeChat, /type KeyboardEvent/);
  assert.match(nativeChat, /type LayoutChangeEvent/);
  assert.match(
    nativeChat,
    /const scheduleStickyListSnap = useCallback\(\(animated = false\) => \{[\s\S]*if \(!stickToBottomRef\.current\) return;[\s\S]*if \(isListUserScrollIntentActive\(\)\) return;[\s\S]*requestAnimationFrame/,
  );
  assert.match(
    nativeChat,
    /scrollListToEnd\(animated, \(\) => stickToBottomRef\.current && !isListUserScrollIntentActive\(\)\);/,
  );
  assert.match(nativeChat, /Keyboard\.scheduleLayoutAnimation\?\.\(event\)/);
  assert.match(nativeChat, /Platform\.OS === 'ios' \? 'keyboardWillChangeFrame' : 'keyboardDidShow'/);
  assert.match(nativeChat, /Platform\.OS === 'ios' \? 'keyboardWillHide' : 'keyboardDidHide'/);
  assert.match(nativeChat, /<View style=\{styles\.listAndJumpWrap\} onLayout=\{handleStickyLayoutChange\}>/);
  assert.match(nativeChat, /onLayout=\{handleStickyLayoutChange\}[\s\S]*styles\.contextualRow/);
  assert.match(nativeChat, /onLayout=\{handleStickyLayoutChange\}[\s\S]*styles\.composerDockCol/);
  assert.match(nativeChat, /onFocus=\{handleComposerFocus\}/);
});

test("native explicit jump-to-latest actions deliberately restore bottom stickiness", () => {
  assert.match(
    nativeChat,
    /const armVoiceReply = \(\) => \{[\s\S]*stickToBottomRef\.current = true;[\s\S]*userScrollIntentUntilRef\.current = 0;[\s\S]*scrollListToEnd\(true\);/,
  );
  assert.match(
    nativeChat,
    /onPress=\{\(\) => \{[\s\S]*stickToBottomRef\.current = true;[\s\S]*userScrollIntentUntilRef\.current = 0;[\s\S]*scrollListToEnd\(true\);/,
  );
});
