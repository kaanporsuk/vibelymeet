import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  SLOW_TEXT_SEND_LABEL_AFTER_MS,
  outboxPhaseStatusPresentation,
} from "../shared/chat/outgoingStatusLabels";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const webChat = read("src/pages/Chat.tsx");
const dateSuggestionChip = read("src/components/chat/DateSuggestionChip.tsx");
const webMatches = read("src/hooks/useMatches.ts");
const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const nativeChatApi = read("apps/mobile/lib/chatApi.ts");
const webMessagesHook = read("src/hooks/useMessages.ts");
const webMediaResolver = read("src/lib/mediaAssetResolver.ts");
const nativeMediaResolver = read("apps/mobile/lib/mediaAssetResolver.ts");
const webApp = read("src/App.tsx");
const webRealtimeMessages = read("src/hooks/useRealtimeMessages.ts");
const outgoingStatusLabels = read("shared/chat/outgoingStatusLabels.ts");
const webMessageStatus = read("src/components/chat/MessageStatus.tsx");
const nativeMessageStatus = read("apps/mobile/components/chat/MessageStatus.tsx");
const webOutboxContext = read("src/contexts/WebChatOutboxContext.tsx");
const nativeOutboxContext = read("apps/mobile/lib/chatOutbox/ChatOutboxContext.tsx");
const nativeOutboxRunner = read("apps/mobile/lib/chatOutbox/ChatOutboxRunner.tsx");
const webOutboxExecute = read("src/lib/webChatOutbox/execute.ts");
const webOutboxRows = read("src/lib/webChatOutbox/toChatMessages.ts");
const nativeOutboxExecute = read("apps/mobile/lib/chatOutbox/execute.ts");
const sendMessageTransport = read("shared/chat/sendMessageTransport.ts");
const sendMessageFunction = read("supabase/functions/send-message/index.ts");
const productIntelligence = read("shared/analytics/productIntelligence.ts");

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
  assert.match(webChat, /<span[\s\S]{0,80}className="block aspect-\[4\/5\] w-60 max-w-full overflow-hidden/);
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
  assert.match(nativeChat, /initialNumToRender=\{18\}/);
  assert.match(nativeChat, /maxToRenderPerBatch=\{8\}/);
  assert.match(nativeChat, /updateCellsBatchingPeriod=\{16\}/);
  assert.match(nativeChat, /windowSize=\{7\}/);
  assert.doesNotMatch(nativeChat, /removeClippedSubviews/);
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

test("native chat keeps clip browsing poster-first and mounts players only by intent", () => {
  assert.doesNotMatch(nativeChat, /visibleRowKeys\.has\(rowKey\)/);
  assert.doesNotMatch(nativeChat, /onViewableItemsChanged=\{onViewableItemsChangedRef\.current\}/);
  assert.doesNotMatch(nativeChat, /viewabilityConfig=\{viewabilityConfigRef\.current\}/);
  assert.match(nativeChat, /function vibeClipPosterCacheKey/);
  assert.match(nativeChat, /vibeClipPosterPreviewByKey/);
  assert.match(nativeChat, /const shouldMountPlayer = videoViewer\?\.uri === displayClipMeta\.videoUrl/);
  assert.match(nativeChat, /shouldMountPlayer=\{shouldMountPlayer\}/);
});

test("outgoing text status uses silent ticks while preserving meaningful visible states", () => {
  const queued = outboxPhaseStatusPresentation("queued", "text", { ageMs: 0 });
  const sending = outboxPhaseStatusPresentation("sending", "text", { ageMs: 0 });
  const awaiting = outboxPhaseStatusPresentation("awaiting_hydration", "text", { ageMs: 0 });
  assert.equal(queued.visibleLabel, null);
  assert.equal(sending.visibleLabel, null);
  assert.equal(awaiting.visibleLabel, null);
  assert.equal(sending.showSpinner, false);

  const slow = outboxPhaseStatusPresentation("sending", "text", {
    ageMs: SLOW_TEXT_SEND_LABEL_AFTER_MS,
  });
  assert.equal(slow.visibleLabel, "Still sending…");

  const offline = outboxPhaseStatusPresentation("waiting_for_network", "text");
  assert.equal(offline.visibleLabel, "Offline - sends when back");
  assert.equal(offline.assistiveLabel, "Offline - sends when back");

  const media = outboxPhaseStatusPresentation("sending", "image", { uploadPercent: 42 });
  assert.equal(media.visibleLabel, "Uploading 42%");
  assert.equal(media.showSpinner, true);

  const failed = outboxPhaseStatusPresentation("failed", "text");
  assert.match(failed.visibleLabel ?? "", /Retry/);
  assert.match(failed.assistiveLabel, /couldn't send/i);

  assert.doesNotMatch(outgoingStatusLabels, /return ['"]Queued['"]/);
  assert.doesNotMatch(outgoingStatusLabels, /return ['"]Sending…['"]/);
  assert.match(webMessageStatus, /suppressSendingIndicator/);
  assert.match(nativeMessageStatus, /suppressSendingIndicator/);
  assert.doesNotMatch(webMessageStatus, />Sending…</);
  assert.doesNotMatch(nativeMessageStatus, />Sending…</);
  assert.match(webChat, /const \[outboxStatusNowMs, setOutboxStatusNowMs\] = useState/);
  assert.match(webChat, /setInterval\(\(\) => setOutboxStatusNowMs\(Date\.now\(\)\), 500\)/);
  assert.match(webChat, /webOutboxItemsToRows\(outboxMatchItems, outboxPreviews, outboxStatusNowMs\)/);
  assert.match(webChat, /onRemoveFailedSend/);
  assert.match(webChat, /groupedMessage\.statusSubtext/);
  assert.match(webOutboxRows, /it\.payload\.kind !== "text"[\s\S]{0,120}uploadProgress/);
  assert.match(nativeChat, /const \[outboxStatusNowMs, setOutboxStatusNowMs\] = useState/);
  assert.match(nativeChat, /setInterval\(\(\) => setOutboxStatusNowMs\(Date\.now\(\)\), 500\)/);
  assert.match(nativeChat, /outboxPayloadKind !== 'text'[\s\S]{0,120}uploadProgress/);
});

test("web and native outbox wake immediately and keep interval fallback", () => {
  for (const source of [webOutboxContext, nativeOutboxContext]) {
    assert.match(source, /const requestProcessTick = useCallback/);
    assert.match(source, /queueMicrotask\(run\)/);
    assert.match(source, /const prev = itemsRef\.current;[\s\S]{0,120}itemsRef\.current = next;[\s\S]{0,80}setItems\(next\)/);
    assert.match(source, /updateItems\(\(prev\) => \[\.\.\.prev, item\]\.sort/);
    assert.match(source, /requestProcessTick\(\);[\s\S]{0,120}if \(isMediaOutboxItem\(item\)\)/);
    assert.match(source, /list\.some\(\(it\) => it\.state === ['"]sending['"] \|\| processingRef\.current\.has\(it\.id\)\)/);
    assert.match(source, /finally \{[\s\S]*requestProcessTick\(\);[\s\S]*\}/);
    assert.match(source, /processTick: \(\) => Promise<void>/);
  }
  assert.match(webOutboxContext, /setInterval\(\(\) => \{[\s\S]*void tick\(\);[\s\S]*\}, 4000\)/);
  assert.match(nativeOutboxRunner, /setInterval\(\(\) => \{[\s\S]*void tick\(\);[\s\S]*\}, 4000\)/);
  assert.doesNotMatch(nativeOutboxRunner, /useQueryClient/);
});

test("successful text image and voice sends can patch thread cache from send-message response", () => {
  assert.match(webOutboxExecute, /patchThreadCacheFromRawMessage/);
  assert.match(nativeOutboxExecute, /patchThreadCacheFromRawMessage/);
  assert.match(
    webOutboxContext,
    /completeImmediately =[\s\S]{0,220}next\.payload\.kind !== "video"[\s\S]{0,160}patchedThreadCache === true[\s\S]{0,160}next\.payload\.kind !== "image" \|\| displayReady === true/,
  );
  assert.match(
    nativeOutboxContext,
    /completeImmediately =[\s\S]{0,220}next\.payload\.kind !== 'video'[\s\S]{0,160}patchedThreadCache === true[\s\S]{0,160}next\.payload\.kind !== 'image' \|\| displayReady === true/,
  );
  assert.match(sendMessageTransport, /SEND_MESSAGE_RESPONSE_TIMEOUT_MS = 20_000/);
  assert.match(webOutboxExecute, /shared\/chat\/sendMessageTransport/);
  assert.match(webOutboxExecute, /supabase\.functions\.invoke\("send-message", \{[\s\S]{0,80}timeout: SEND_MESSAGE_RESPONSE_TIMEOUT_MS/);
  assert.match(nativeChatApi, /shared\/chat\/sendMessageTransport/);
  assert.match(nativeChatApi, /supabase\.functions\.invoke\('send-message', \{[\s\S]{0,80}timeout: SEND_MESSAGE_RESPONSE_TIMEOUT_MS/);
});

test("photo outbox handoff waits for renderable server images", () => {
  assert.match(webChat, /function shouldPreferLocalImageUntilServerRenderable/);
  assert.match(webChat, /const localClientIdsToPrefer = new Set<string>\(\)/);
  assert.match(webChat, /extractRenderableChatImageUrl/);
  assert.match(webChat, /outboxPreviewSourceKeysRef/);
  assert.match(webChat, /threadLayoutAnchorKey/);
  assert.match(webChat, /reconcileWebOutboxWithServerIds/);
  assert.match(webChat, /photoUrlOverridesById\[message\.id\] \?\?[\s\S]{0,120}extractRenderableChatImageUrl/);
  assert.doesNotMatch(webChat, /photoUrlOverridesById\[message\.id\] \?\?[\s\S]{0,160}allowPrivateMediaRefs: true/);

  assert.match(nativeChat, /function shouldPreferLocalImageUntilServerRenderable/);
  assert.match(nativeChat, /const localClientIdsToPrefer = new Set<string>\(\)/);
  assert.match(nativeChat, /extractRenderableChatImageUrl/);
  assert.match(nativeChat, /Preparing photo\.\.\./);
  assert.match(nativeChat, /photoUriOverridesById\[message\.id\] \?\? extractRenderableChatImageUrl/);
  assert.doesNotMatch(nativeChat, /photoUriOverridesById\[message\.id\] \?\?[\s\S]{0,160}allowPrivateMediaRefs: true/);

  assert.match(webMessagesHook, /type ThreadCachePatchResult = \{[\s\S]{0,80}displayReady: boolean/);
  assert.match(webMessagesHook, /function isMessageDisplayReadyForOutboxCompletion/);
  assert.match(webMessagesHook, /extractRenderableChatImageUrl/);
  assert.match(webMessagesHook, /return \{ patched, displayReady: patched && displayReady \}/);
  assert.match(nativeChatApi, /type ThreadCachePatchResult = \{[\s\S]{0,80}displayReady: boolean/);
  assert.match(nativeChatApi, /function isMessageDisplayReadyForOutboxCompletion/);
  assert.match(nativeChatApi, /extractRenderableChatImageUrl/);
  assert.match(nativeChatApi, /return \{ patched, displayReady: patched && displayReady \}/);

  for (const source of [webOutboxContext, nativeOutboxContext]) {
    assert.match(source, /let changed = false;[\s\S]{0,500}return changed \? next : prev/);
    assert.match(source, /select\(CHAT_MESSAGE_SELECT\)/);
    assert.match(source, /patchResult\.patched && !patchResult\.displayReady/);
  }
  assert.doesNotMatch(webMediaResolver, /formatChatImageMessageContent\(""\)/);
  assert.doesNotMatch(nativeMediaResolver, /formatChatImageMessageContent\(''\)/);
});

test("send-message backgrounds push notifications after durable insert", () => {
  assert.match(sendMessageFunction, /runtime\.waitUntil\(promise\)/);
  assert.match(sendMessageFunction, /runBackgroundTask\("send-message vibe_clip notification"/);
  assert.match(sendMessageFunction, /runBackgroundTask\("send-message voice notification"/);
  assert.match(sendMessageFunction, /runBackgroundTask\("send-message notification"/);
  assert.doesNotMatch(sendMessageFunction, /await serviceClient\.functions\.invoke\("send-notification"/);
});

test("chat send latency telemetry is sanitized and content-free", () => {
  assert.match(productIntelligence, /CHAT_SEND_LATENCY_OBSERVED: "quality\.chat_send_latency_observed"/);
  assert.match(productIntelligence, /"payload_kind"/);
  assert.match(productIntelligence, /"latency_phase"/);
  assert.match(productIntelligence, /"thread_bucket"/);
  assert.match(webOutboxContext, /quality\.chat_send_latency_observed/);
  assert.match(nativeOutboxContext, /quality\.chat_send_latency_observed/);
  assert.match(sendMessageTransport, /type ChatSendThreadBucket = 'cold' \| 'warm' \| 'unknown'/);
  assert.match(webChat, /const sendThreadBucket = useMemo/);
  assert.match(webChat, /threadBucket: sendThreadBucket/);
  assert.match(nativeChat, /const sendThreadBucket = useMemo/);
  assert.match(nativeChat, /threadBucket: sendThreadBucket/);
  assert.match(webOutboxContext, /thread_bucket: next\.threadBucket \?\? "unknown"/);
  assert.match(nativeOutboxContext, /thread_bucket: next\.threadBucket \?\? 'unknown'/);
  assert.doesNotMatch(webOutboxContext, /message_content|content:/);
  assert.doesNotMatch(nativeOutboxContext, /message_content|content:/);
});

test("focused thread realtime self-heals on drops and foreground resume", () => {
  assert.match(webRealtimeMessages, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/);
  assert.match(webRealtimeMessages, /setRetryNonce\(\(value\) => value \+ 1\)/);
  assert.match(webRealtimeMessages, /status === "SUBSCRIBED"[\s\S]*invalidateMessages\(\)/);
  assert.match(webRealtimeMessages, /window\.addEventListener\("online", reconcile\)/);
  assert.match(webRealtimeMessages, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(webRealtimeMessages, /let disposed = false/);
  assert.match(webRealtimeMessages, /if \(disposed\) return/);
  assert.match(webRealtimeMessages, /disposed = true;[\s\S]{0,80}clearRetryTimer\(\)/);
  assert.match(webRealtimeMessages, /if \(matchId && row\.match_id !== matchId\) return;/);

  assert.match(nativeChatApi, /import \{ AppState, type AppStateStatus \} from 'react-native'/);
  assert.match(nativeChatApi, /const \[retryNonce, setRetryNonce\] = useState\(0\)/);
  assert.match(nativeChatApi, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED'/);
  assert.match(nativeChatApi, /setRetryNonce\(\(value\) => value \+ 1\)/);
  assert.match(nativeChatApi, /status === 'SUBSCRIBED'[\s\S]*invalidateThread\(\)/);
  assert.match(nativeChatApi, /let disposed = false/);
  assert.match(nativeChatApi, /if \(disposed\) return/);
  assert.match(nativeChatApi, /disposed = true;[\s\S]{0,80}clearRetryTimer\(\)/);
  assert.match(nativeChatApi, /AppState\.addEventListener\('change', onAppState\)/);
});

test("inbox subscriptions keep conversation lists immediate on message changes", () => {
  assert.doesNotMatch(webApp, /\{\s*event: "\*", schema: "public", table: "messages"\s*\}/);
  assert.doesNotMatch(webApp, /\{\s*event: "DELETE", schema: "public", table: "messages"\s*\}/);
  assert.match(webApp, /\{\s*event: "INSERT", schema: "public", table: "messages"\s*\}/);
  assert.match(webApp, /\{\s*event: "UPDATE", schema: "public", table: "messages"\s*\}/);
  assert.match(webMatches, /Surface-scoped message realtime/);
  assert.match(webMatches, /event: "INSERT"[\s\S]*table: "messages"/);
  assert.match(webMatches, /event: "UPDATE"[\s\S]*table: "messages"/);
  assert.match(webMatches, /dashboard-message-realtime/);
  assert.match(webMatches, /immediate unread rail updates/);
  assert.match(webMatches, /queryKey: \["dashboard-matches"\]/);
  assert.match(webMatches, /queryKey: \["matches"\]/);
  assert.match(webMatches, /queryKey: \["profile-live-counts"\]/);

  assert.match(nativeChatApi, /\.channel\('global-messages-inbox'\)/);
  assert.match(nativeChatApi, /\{ event: 'INSERT', schema: 'public', table: 'messages' \}/);
  assert.match(nativeChatApi, /\{ event: 'UPDATE', schema: 'public', table: 'messages' \}/);
  assert.match(nativeChatApi, /queryKey: \['matches'\]/);
  assert.match(nativeChatApi, /queryKey: \['profile-live-counts'\]/);
});
