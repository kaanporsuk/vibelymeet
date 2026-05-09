import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("web chat exits replace the chat route with matches", () => {
  const webChatPage = readRepoFile("src/pages/Chat.tsx");
  const webChatHeader = readRepoFile("src/components/chat/ChatHeader.tsx");

  assert.ok(webChatPage.includes('const MATCHES_ROUTE = "/matches";'));
  assert.ok(webChatPage.includes("const CHAT_ROUTE_RE = /^\\/chat\\/[^/]+\\/?$/;"));
  assert.match(webChatPage, /const returnToMatches = useCallback\(\(\) => \{\s*navigate\(MATCHES_ROUTE, \{ replace: true \}\);/s);
  assert.ok(webChatPage.includes("window.location.replace(MATCHES_ROUTE);"));
  assert.ok(webChatPage.includes("window.requestAnimationFrame(forceMatchesIfStillInChat);"));
  assert.ok(webChatPage.includes("onBack={returnToMatches}"));

  assert.ok(webChatHeader.includes('href="/matches"'));
  assert.ok(webChatHeader.includes("event.preventDefault();"));
  assert.ok(webChatHeader.includes("event.stopPropagation();"));
  assert.doesNotMatch(webChatHeader, /useNavigate|navigate\("\/matches"/);
  assert.ok((webChatHeader.match(/onBack\(\)/g)?.length ?? 0) >= 4);
});

test("native chat exits replace the stack with the Vibe matches tab", () => {
  const nativeChat = readRepoFile("apps/mobile/app/chat/[id].tsx");
  const nativeLayout = readRepoFile("apps/mobile/app/_layout.tsx");

  assert.ok(nativeChat.includes("const MATCHES_TAB_HREF = '/(tabs)/matches' as const;"));
  assert.match(nativeChat, /const goToMatches = useCallback\(\(\) => \{\s*router\.dismissTo\(MATCHES_TAB_HREF\);\s*requestAnimationFrame\(\(\) => router\.replace\(MATCHES_TAB_HREF\)\);\s*setTimeout\(\(\) => router\.replace\(MATCHES_TAB_HREF\), 150\);\s*\}, \[\]\);/s);
  assert.ok(nativeChat.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.doesNotMatch(nativeChat, /router\.back\(\)/);
  assert.ok((nativeChat.match(/goToMatches/g)?.length ?? 0) >= 5);
  assert.match(nativeLayout, /<Stack\.Screen name="chat\/\[id\]" options=\{\{[^}]*gestureEnabled: false[^}]*\}\} \/>/);
});
