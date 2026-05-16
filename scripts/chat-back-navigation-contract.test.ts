import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/** Ensures each fragment appears after the previous (readable contract vs one giant regex). */
function assertSubstringsInOrder(haystack: string, parts: string[], label: string): void {
  let pos = 0;
  for (const part of parts) {
    const idx = haystack.indexOf(part, pos);
    assert.ok(idx >= 0, `${label}: missing or out of order: ${JSON.stringify(part)}`);
    pos = idx + part.length;
  }
}

test("web chat exits replace the chat route with matches", () => {
  const webChatPage = readRepoFile("src/pages/Chat.tsx");
  const webChatHeader = readRepoFile("src/components/chat/ChatHeader.tsx");

  assert.ok(webChatPage.includes('const MATCHES_ROUTE = "/matches";'));
  assert.ok(webChatPage.includes("flushSync"));
  assert.ok(webChatPage.includes("clearChatBackNavWatchdogs"));
  // Render-null exit guard: panel disappears the moment back is tapped, regardless of router.
  assert.ok(webChatPage.includes("const [exiting, setExiting] = useState(false);"));
  assert.ok(webChatPage.includes("if (exiting) return null;"));
  // Still-mounted watchdog: replace (not assign) so the broken /chat entry is not left in history.
  assert.ok(webChatPage.includes("window.location.replace(MATCHES_ROUTE)"));
  const returnIdx = webChatPage.indexOf("const returnToMatches = useCallback");
  assert.ok(returnIdx >= 0, "returnToMatches callback present");
  const returnChunk = webChatPage.slice(returnIdx, returnIdx + 1400);
  assertSubstringsInOrder(
    returnChunk,
    [
      "clearChatBackNavWatchdogs();",
      "inputRef.current?.blur();",
      "clearMobileKeyboardViewportStyle();",
      "setExiting(true);",
      "flushSync(() => {",
      "navigate(MATCHES_ROUTE, { replace: true });",
      "window.location.replace(MATCHES_ROUTE);",
      "}, [navigate, clearChatBackNavWatchdogs, clearMobileKeyboardViewportStyle]);",
    ],
    "web returnToMatches",
  );
  assert.ok(webChatPage.includes("onBack={returnToMatches}"));

  // The pathname-based watchdogs were the broken layer — they short-circuited
  // when the URL had already updated to /matches, which is exactly the bug state.
  assert.ok(!webChatPage.includes("recoverIfAddressBarMatchesButRouterOnChat"));
  assert.ok(!webChatPage.includes("forceMatchesIfStillThisChat"));

  assert.ok(webChatHeader.includes('type="button"'));
  assert.ok(webChatHeader.includes("event.stopPropagation();"));
  assert.ok(webChatHeader.includes('aria-label="Back to matches"'));
  assert.doesNotMatch(webChatHeader, /useNavigate|navigate\("\/matches"/);
  assert.ok((webChatHeader.match(/onBack\(\)/g)?.length ?? 0) >= 4);
});

test("native chat exits replace the stack with the Vibe matches tab", () => {
  const nativeChat = readRepoFile("apps/mobile/app/chat/[id].tsx");
  const nativeLayout = readRepoFile("apps/mobile/app/_layout.tsx");

  assert.ok(nativeChat.includes("const MATCHES_TAB_HREF = '/(tabs)/matches' as const;"));
  assert.ok(nativeChat.includes("InteractionManager.runAfterInteractions"));
  // Render-null exit guard mirrors the web contract.
  assert.ok(nativeChat.includes("const [exiting, setExiting] = useState(false);"));
  assert.ok(nativeChat.includes("if (exiting) return null;"));
  const goIdx = nativeChat.indexOf("const goToMatches = useCallback");
  assert.ok(goIdx >= 0, "goToMatches callback present");
  const goChunk = nativeChat.slice(goIdx, goIdx + 2800);
  assertSubstringsInOrder(
    goChunk,
    [
      "cancelRecordingForExit();",
      "setExiting(true);",
      "clearGoToMatchesScheduled();",
      "router.dismissAll()",
      "router.dismissTo(MATCHES_TAB_HREF)",
      "router.replace(MATCHES_TAB_HREF)",
      "const repeatExit",
      "setTimeout(repeatExit, 150)",
      "setTimeout(repeatExit, 300)",
      "InteractionManager.runAfterInteractions(() => {",
      "repeatExit();",
      "}, [cancelRecordingForExit, clearGoToMatchesScheduled]);",
    ],
    "native goToMatches",
  );
  // The expected-path guard short-circuited the very repair it was meant to perform.
  assert.ok(!nativeChat.includes("expectedPath"));
  assert.ok(!nativeChat.includes("pathnameRef"));

  assert.ok(nativeChat.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.doesNotMatch(nativeChat, /router\.back\(\)/);
  assert.ok((nativeChat.match(/goToMatches/g)?.length ?? 0) >= 5);
  assert.match(nativeLayout, /<Stack\.Screen name="chat\/\[id\]" options=\{\{[^}]*gestureEnabled: false[^}]*\}\} \/>/);
});
