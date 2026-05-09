import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("web chat exits replace the chat route with matches", () => {
  const webChatPage = readRepoFile("src/pages/Chat.tsx");
  const webChatHeader = readRepoFile("src/components/chat/ChatHeader.tsx");

  assert.match(webChatPage, /const returnToMatches = useCallback\(\(\) => \{\s*navigate\("\/matches", \{ replace: true \}\);\s*\}, \[navigate\]\);/s);
  assert.ok(webChatPage.includes("onBack={returnToMatches}"));

  assert.doesNotMatch(webChatHeader, /useNavigate|navigate\("\/matches"/);
  assert.ok((webChatHeader.match(/onBack\(\)/g)?.length ?? 0) >= 4);
});

test("native chat exits replace the stack with the Vibe matches tab", () => {
  const nativeChat = readRepoFile("apps/mobile/app/chat/[id].tsx");
  const nativeLayout = readRepoFile("apps/mobile/app/_layout.tsx");

  assert.match(nativeChat, /const goToMatches = useCallback\(\(\) => \{\s*router\.replace\('\/\(tabs\)\/matches'\);\s*\}, \[\]\);/s);
  assert.ok(nativeChat.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.doesNotMatch(nativeChat, /router\.back\(\)/);
  assert.ok((nativeChat.match(/goToMatches/g)?.length ?? 0) >= 5);
  assert.match(nativeLayout, /<Stack\.Screen name="chat\/\[id\]" options=\{\{[^}]*gestureEnabled: false[^}]*\}\} \/>/);
});
