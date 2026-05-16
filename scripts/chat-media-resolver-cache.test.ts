import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __chatMediaUrlCacheSizeForTests,
  __clearChatMediaUrlCacheForTests,
  __setChatMediaUrlIssuerForTests,
  getCachedChatMediaUrl,
  refreshCachedChatMediaUrl,
} from "../src/lib/chatMediaResolver";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

__clearChatMediaUrlCacheForTests();

assert.equal(
  await getCachedChatMediaUrl("local-preview", "image", "blob:https://vibely.test/photo"),
  "blob:https://vibely.test/photo",
);
assert.equal(__chatMediaUrlCacheSizeForTests(), 0);

assert.equal(
  await getCachedChatMediaUrl(
    "550e8400-e29b-41d4-a716-446655440010",
    "video",
    "https://cdn.example.com/already-signed.mp4",
  ),
  "https://cdn.example.com/already-signed.mp4",
);
assert.equal(__chatMediaUrlCacheSizeForTests(), 0);

let invokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  invokeCount += 1;
  return {
    success: true,
    url: `https://signed.example.com/media-${invokeCount}`,
    expiresInSeconds: 300,
  };
});

try {
  const messageId = "550e8400-e29b-41d4-a716-446655440000";
  const first = await getCachedChatMediaUrl(messageId, "voice", "voice/test.webm");
  const second = await getCachedChatMediaUrl(messageId, "voice", "voice/test.webm");
  const refreshed = await refreshCachedChatMediaUrl(messageId, "voice", "voice/test.webm");

  assert.equal(first, "https://signed.example.com/media-1");
  assert.equal(second, first);
  assert.equal(refreshed, "https://signed.example.com/media-2");
  assert.equal(invokeCount, 2);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let shortTtlInvokeCount = 0;
const originalDateNow = Date.now;
__setChatMediaUrlIssuerForTests(async () => {
  shortTtlInvokeCount += 1;
  return {
    success: true,
    url: `https://signed.example.com/short-${shortTtlInvokeCount}`,
    expiresInSeconds: 10,
  };
});

try {
  const messageId = "650e8400-e29b-41d4-a716-446655440000";
  const first = await getCachedChatMediaUrl(messageId, "image", "image/short.jpg");
  Date.now = () => originalDateNow() + 2_000;
  const second = await getCachedChatMediaUrl(messageId, "image", "image/short.jpg");

  assert.equal(first, "https://signed.example.com/short-1");
  assert.equal(second, "https://signed.example.com/short-2");
  assert.equal(shortTtlInvokeCount, 2);
} finally {
  Date.now = originalDateNow;
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

const resolver = read("supabase/functions/get-chat-media-url/index.ts");
const webBubble = read("src/components/chat/VoiceMessageBubble.tsx");
const nativeBubble = read("apps/mobile/components/chat/VoiceMessagePlayer.tsx");
const webMessagesHook = read("src/hooks/useMessages.ts");
const nativeChat = read("apps/mobile/lib/chatApi.ts");
const threadPage = read("supabase/functions/chat-thread-page/index.ts");

assert.match(resolver, /syncChatMessageMedia/);
assert.match(
  resolver,
  /let asset = await resolveMessageAsset[\s\S]*syncChatMessageMedia[\s\S]*asset = await resolveMessageAsset/,
);
assert.match(webBubble, /refreshCachedChatMediaUrl/);
assert.match(webBubble, /await audioRef\.current\.play\(\);[\s\S]{0,500}refreshAudioUrl/);
assert.doesNotMatch(webBubble, /console\.error\("Audio failed to load:/);
assert.match(nativeBubble, /refreshCachedChatMediaUrl/);
assert.match(nativeBubble, /player\.play\(\)[\s\S]{0,600}refreshAndQueuePlay/);
assert.match(nativeChat, /extras:\s*\{\s*httpSend:\s*true\s*\}/);
assert.match(threadPage, /\.from\("media_assets"\)/);
assert.match(threadPage, /date_suggestions/);
assert.doesNotMatch(threadPage, /syncChatMessageMedia/);
assert.match(threadPage, /function parseThreadPageCursor/);
assert.match(threadPage, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,120}\.order\("id", \{ ascending: false \}\)/);
assert.match(threadPage, /created_at\.lt\.\$\{beforeCursor\.createdAt\},and\(created_at\.eq\.\$\{beforeCursor\.createdAt\},id\.lt\.\$\{beforeCursor\.id\}\)/);
assert.match(threadPage, /next_cursor: rowsDesc\.length >= limit \? encodeThreadPageCursor/);
assert.match(webMessagesHook, /function parseThreadPageCursor/);
assert.match(webMessagesHook, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,120}\.order\("id", \{ ascending: false \}\)/);
assert.match(webMessagesHook, /for \(const page of chronologicalPages\) \{[\s\S]*page\.dateSuggestions/);
assert.match(nativeChat, /for \(const page of chronologicalPages\) \{[\s\S]*page\.dateSuggestions/);
assert.match(webMessagesHook, /query\.data\.dateSuggestions[\s\S]*byId\.set\(suggestion\.id, suggestion\)/);
assert.match(nativeChat, /query\.data\.dateSuggestions[\s\S]*byId\.set\(suggestion\.id, suggestion\)/);

console.log("chat-media-resolver-cache tests passed");
