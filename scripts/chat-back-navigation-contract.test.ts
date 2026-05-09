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
  assert.ok(webChatPage.includes("normalizeWebPathname"));
  assert.ok(webChatPage.includes("flushSync"));
  assert.ok(webChatPage.includes("recoverIfAddressBarMatchesButRouterOnChat"));
  assert.ok(webChatPage.includes("clearChatBackNavWatchdogs"));
  assert.match(
    webChatPage,
    /const returnToMatches = useCallback\(\(\) => \{\s*clearChatBackNavWatchdogs\(\);\s*flushSync\(\(\) => \{\s*navigate\(MATCHES_ROUTE, \{ replace: true \}\);\s*\}\);/s,
  );
  assert.ok(webChatPage.includes("window.location.replace(MATCHES_ROUTE);"));
  assert.ok(webChatPage.includes("queueMicrotask(forceMatchesIfStillThisChat);"));
  assert.ok(webChatPage.includes("window.requestAnimationFrame("));
  assert.ok(webChatPage.includes("forceMatchesIfStillThisChat"));
  assert.ok(webChatPage.includes("window.setTimeout(forceMatchesIfStillThisChat, 400)"));
  assert.ok(webChatPage.includes("onBack={returnToMatches}"));

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
  const goIdx = nativeChat.indexOf("const goToMatches = useCallback");
  assert.ok(goIdx >= 0, "goToMatches callback present");
  const goChunk = nativeChat.slice(goIdx, goIdx + 2800);
  assertSubstringsInOrder(
    goChunk,
    [
      "router.dismissTo(MATCHES_TAB_HREF)",
      "router.replace(MATCHES_TAB_HREF)",
      "clearGoToMatchesScheduled()",
      "const guardedReplace",
      "setTimeout(guardedReplace, 150)",
      "setTimeout(guardedReplace, 400)",
      "InteractionManager.runAfterInteractions(() => {",
      "guardedReplace();",
      "}, [otherUserId, clearGoToMatchesScheduled]);",
    ],
    "native goToMatches",
  );
  assert.ok(nativeChat.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.doesNotMatch(nativeChat, /router\.back\(\)/);
  assert.ok((nativeChat.match(/goToMatches/g)?.length ?? 0) >= 5);
  assert.match(nativeLayout, /<Stack\.Screen name="chat\/\[id\]" options=\{\{[^}]*gestureEnabled: false[^}]*\}\} \/>/);
});
