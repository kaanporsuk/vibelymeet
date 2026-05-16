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
const nativeChatApi = read("apps/mobile/lib/chatApi.ts");

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

test("web chat gates mobile keyboard viewport styling to focused mobile composer", () => {
  assert.match(webChat, /const composerChromeRef = useRef<HTMLDivElement>\(null\)/);
  assert.doesNotMatch(webChat, /visualViewportHeight/);
  assert.match(webChat, /type CSSProperties/);
  assert.match(webChat, /const CHAT_DESKTOP_VIEWPORT_QUERY = "\(min-width: 1024px\)";/);
  assert.match(webChat, /const CHAT_MOBILE_KEYBOARD_THRESHOLD_PX = 96;/);
  assert.match(webChat, /const CHAT_MOBILE_KEYBOARD_STYLE_CLEAR_DELAY_MS = 240;/);
  assert.match(
    webChat,
    /const \[mobileKeyboardViewportStyle, setMobileKeyboardViewportStyle\] = useState<CSSProperties \| undefined>\(\);/,
  );
  assert.match(
    webChat,
    /const mobileKeyboardStableViewportHeightRef = useRef<number \| null>\([\s\S]*Math\.max\(window\.visualViewport\?\.height \?\? 0, window\.innerHeight \?\? 0\)/,
  );
  assert.match(
    webChat,
    /const updateMobileKeyboardViewportStyle = useCallback\(\(\) => \{[\s\S]*const textarea = inputRef\.current;[\s\S]*const viewport = window\.visualViewport;[\s\S]*window\.matchMedia\(CHAT_DESKTOP_VIEWPORT_QUERY\)[\s\S]*const currentViewportHeight = viewport\?\.height \?\? 0;[\s\S]*const currentLayoutHeight = window\.innerHeight;[\s\S]*document\.activeElement !== textarea[\s\S]*mobileKeyboardStableViewportHeightRef\.current = Math\.max\(currentViewportHeight, currentLayoutHeight\);[\s\S]*const stableViewportHeight =[\s\S]*mobileKeyboardStableViewportHeightRef\.current[\s\S]*const keyboardOverlap = Math\.max\([\s\S]*currentLayoutHeight - currentViewportHeight,[\s\S]*stableViewportHeight - currentViewportHeight,[\s\S]*keyboardOverlap < CHAT_MOBILE_KEYBOARD_THRESHOLD_PX/,
  );
  assert.match(
    webChat,
    /setMobileKeyboardViewportStyle\(\{\s*position: "fixed",\s*top: `\$\{Math\.max\(0, viewport\.offsetTop\)\}px`,\s*bottom: "auto",\s*left: "0px",\s*right: "0px",\s*height: `\$\{Math\.max\(1, viewport\.height\)\}px`,\s*width: "100vw",\s*\}\);/,
  );
  assert.match(
    webChat,
    /const scheduleStickyBottomSnap = useCallback\(\(opts\?: \{ instant\?: boolean \}\) => \{[\s\S]*if \(!stickToBottomRef\.current\) return;[\s\S]*if \(isUserScrollIntentActive\(\)\) return;[\s\S]*window\.requestAnimationFrame/,
  );
  assert.match(webChat, /const viewport = window\.visualViewport/);
  assert.match(webChat, /viewport\.addEventListener\("resize", handleMobileViewportChange\)/);
  assert.match(webChat, /viewport\.addEventListener\("scroll", handleMobileViewportChange\)/);
  assert.match(
    webChat,
    /className="fixed inset-0 h-\[100dvh\] w-screen[\s\S]*lg:relative lg:inset-auto lg:w-auto/,
  );
  assert.match(webChat, /style=\{mobileKeyboardViewportStyle\}/);
  assert.match(webChat, /<div ref=\{composerChromeRef\} className="relative z-40 shrink-0">/);
  assert.match(
    webChat,
    /const handleComposerFocus = useCallback\(\(\) => \{[\s\S]*mobileKeyboardStableViewportHeightRef\.current = Math\.max\([\s\S]*window\.visualViewport\?\.height \?\? 0,[\s\S]*window\.innerHeight \?\? 0,[\s\S]*updateMobileKeyboardViewportStyle\(\);/,
  );
  assert.match(
    webChat,
    /const returnToMatches = useCallback\(\(\) => \{[\s\S]*inputRef\.current\?\.blur\(\);[\s\S]*clearMobileKeyboardViewportStyle\(\);[\s\S]*setExiting\(true\);/,
  );
  assert.match(webChat, /onFocus=\{handleComposerFocus\}/);
  assert.match(webChat, /onBlur=\{handleComposerBlur\}/);
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
    /const settleListUserScrollIntent = useCallback[\s\S]*const dist = Math\.max\(0, e\.nativeEvent\.contentOffset\.y\);[\s\S]*const atBottom = dist < 100;[\s\S]*stickToBottomRef\.current = atBottom;/,
  );
  assert.match(
    nativeChat,
    /const listOnContentSizeChange = useCallback[\s\S]*if \(!stickToBottomRef\.current\) return;[\s\S]*if \(isListUserScrollIntentActive\(\)\) return;[\s\S]*scrollListToLatest\(false\);/,
  );
  assert.match(nativeChat, /listRef\.current\?\.scrollToOffset\(\{ offset: 0, animated \}\)/);
  assert.doesNotMatch(nativeChat, /scrollToEnd/);
  assert.match(nativeChat, /\binverted\b/);
  assert.match(nativeChat, /maintainVisibleContentPosition=\{\{ minIndexForVisible: 0 \}\}/);
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
    /scrollListToLatest\(animated, \(\) => stickToBottomRef\.current && !isListUserScrollIntentActive\(\)\);/,
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
    /const armVoiceReply = \(\) => \{[\s\S]*stickToBottomRef\.current = true;[\s\S]*userScrollIntentUntilRef\.current = 0;[\s\S]*scrollListToLatest\(true\);/,
  );
  assert.match(
    nativeChat,
    /onPress=\{\(\) => \{[\s\S]*stickToBottomRef\.current = true;[\s\S]*userScrollIntentUntilRef\.current = 0;[\s\S]*scrollListToLatest\(true\);/,
  );
});

test("native chat hydrates the latest page instead of fetching full history", () => {
  assert.match(nativeChatApi, /const CHAT_THREAD_PAGE_SIZE = 28/);
  assert.match(nativeChatApi, /useInfiniteQuery/);
  assert.match(nativeChatApi, /supabase\.functions\.invoke\('chat-thread-page'/);
  assert.match(nativeChatApi, /getNextPageParam: \(lastPage: ChatThreadPage\) => lastPage\.nextCursor/);
  assert.doesNotMatch(nativeChatApi, /\.order\('created_at', \{ ascending: true \}\)/);
  assert.match(nativeChatApi, /\.order\('created_at', \{ ascending: false \}\)[\s\S]{0,120}\.order\('id', \{ ascending: false \}\)/);
  assert.match(nativeChatApi, /function parseThreadPageCursor/);
  assert.match(nativeChatApi, /created_at\.lt\.\$\{cursor\.createdAt\},and\(created_at\.eq\.\$\{cursor\.createdAt\},id\.lt\.\$\{cursor\.id\}\)/);
  assert.match(nativeChatApi, /function encodeThreadPageCursor/);
  assert.match(nativeChat, /queryClient\.getQueryData<MatchListItem\[]>/);
  assert.doesNotMatch(nativeChat, /\buseMatches\(/);
  assert.match(nativeChat, /data=\{flatListRows\}/);
  assert.match(nativeChat, /const allowOlderPageFetchRef = useRef\(false\)/);
  assert.match(nativeChat, /allowOlderPageFetchRef\.current = true/);
  assert.match(nativeChat, /onEndReached=\{\(\) => \{[\s\S]*if \(!allowOlderPageFetchRef\.current\) return;[\s\S]*fetchNextPage\(\)/);
});

test("native chat lazy-mounts heavy clip players by viewability", () => {
  assert.match(nativeChat, /const \[visibleRowKeys, setVisibleRowKeys\] = useState<Set<string>>/);
  assert.match(nativeChat, /onViewableItemsChanged=\{onViewableItemsChangedRef\.current\}/);
  assert.match(nativeChat, /viewabilityConfig=\{viewabilityConfigRef\.current\}/);
  assert.match(nativeChat, /shouldMountPlayer=\{shouldMountPlayer\}/);
});
