// Phase-0 privacy hardening contract: ensures private chat media can never be public-mapped by the
// app, that send-message performs sender+match scope binding (fail-soft by default), and that media
// log redaction masks bearer-like provider paths. Source-string contracts + a functional redaction
// check (mirrors the existing media contract-test style).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { maskId, redactMediaPath } from "../supabase/functions/_shared/media-log-redact.ts";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// --- imageUrl public-mapping guard (web + native) ---
for (const p of ["src/utils/imageUrl.ts", "apps/mobile/lib/imageUrl.ts"]) {
  const src = read(p);
  // voice/ and media/ must no longer be public-mapped.
  assert.doesNotMatch(src, /CONFIRMED_BUNNY_STORAGE_PREFIXES\s*=\s*\[[^\]]*voice\//, `${p}: voice/ still public-mapped`);
  assert.doesNotMatch(src, /CONFIRMED_BUNNY_STORAGE_PREFIXES\s*=\s*\[[^\]]*media\//, `${p}: media/ still public-mapped`);
  assert.match(src, /CONFIRMED_BUNNY_STORAGE_PREFIXES\s*=\s*\[\s*['"]photos\/['"]\s*,\s*['"]events\/['"]\s*\]/, `${p}: prefixes not exactly photos/+events/`);
  // chat-scoped paths must be blocked from public mapping.
  assert.match(src, /function isPrivateChatScopedStoragePath/, `${p}: missing private-scope guard`);
  assert.match(src, /p\.startsWith\(['"]photos\/match-['"]\)/, `${p}: photos/match- not guarded`);
  assert.match(src, /isPrivateChatScopedStoragePath\(p\)\)\s*return PLACEHOLDER/, `${p}: guard not enforced before mapping`);
}

// --- send-message sender+match scope binding (fail-soft default) ---
const sendMessage = read("supabase/functions/send-message/index.ts");
assert.match(sendMessage, /CHAT_MEDIA_SENDER_SCOPE_ENFORCE/, "send-message: missing enforce flag");
assert.match(sendMessage, /SENDER_SCOPE_ENFORCE\s*=\s*\(Deno\.env\.get\("CHAT_MEDIA_SENDER_SCOPE_ENFORCE"\)[\s\S]{0,60}===\s*"true"/, "send-message: enforce flag not default-off");
assert.match(sendMessage, /function mediaSenderScopeOk/, "send-message: missing scope check");
assert.match(sendMessage, /mediaSenderScopeOk\(audioUrl, match_id, actorId, "voice"\)/, "send-message: voice scope not checked");
assert.match(sendMessage, /mediaSenderScopeOk\(chatImageMarkerUrl, match_id, actorId, "photos"\)/, "send-message: image scope not checked");
assert.match(sendMessage, /mediaSenderScopeOk\(videoUrl, match_id, actorId, "chat-videos"\)/, "send-message: clip scope not checked");
// mismatch must only block when enforcing (fail-soft otherwise).
assert.match(sendMessage, /return !\(verdict === "mismatch" && SENDER_SCOPE_ENFORCE\)/, "send-message: not fail-soft");

// --- proxy secret warn-once fallback (fail-soft) ---
const getMedia = read("supabase/functions/get-chat-media-url/index.ts");
assert.match(getMedia, /function resolveProxyTokenSecret/, "get-chat-media-url: missing proxy secret resolver");
assert.match(getMedia, /chat_media_proxy_secret_fallback/, "get-chat-media-url: missing fallback warning");
assert.doesNotMatch(getMedia, /Deno\.env\.get\("CHAT_MEDIA_PROXY_SECRET"\)\s*\|\|\s*serviceRoleKey/, "get-chat-media-url: raw fallback still present");

// --- log redaction is applied in upload functions ---
for (const p of ["supabase/functions/upload-image/index.ts", "supabase/functions/upload-chat-video/index.ts"]) {
  const src = read(p);
  assert.match(src, /redactMediaPath\(/, `${p}: path not redacted in logs`);
  assert.match(src, /maskId\(/, `${p}: user id not masked in logs`);
}

// --- functional: redaction actually masks bearer-like material ---
const redacted = redactMediaPath("photos/match-11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/req-DEADBEEFtoken.jpg?token=HS256-x&expires=1");
assert.doesNotMatch(redacted, /DEADBEEFtoken/, "redactMediaPath did not mask the request token");
assert.doesNotMatch(redacted, /11111111-1111/, "redactMediaPath did not mask the uuid");
assert.doesNotMatch(redacted, /token=HS256/, "redactMediaPath did not drop the signed query");
assert.match(redacted, /req-\*\*\*/, "redactMediaPath did not emit req-*** marker");
assert.equal(maskId("22222222-2222-2222-2222-222222222222"), "22222222…");
assert.equal(maskId("short"), "***");

console.log("media-privacy-guard tests passed");
