// Contract + functional coverage for Tier 1 (token-aligned proxy cache header) and
// Tier 2 (flag-gated signed direct Bunny Storage CDN delivery) in get-chat-media-url.
// Guards the egress wins and the "no reliability reduction" invariants: direct CDN is
// default-off and the byte-streaming Edge proxy remains the fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signBunnyStorageUrl } from "../supabase/functions/_shared/bunny-stream-tokens.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

// --- Functional: signBunnyStorageUrl produces an Advanced (HS256) token-auth URL ---
const signArgs = {
  hostname: "chat-media.example.b-cdn.net",
  securityKey: "test-security-key",
  path: "photos/match-abc/user-1/req-DEADBEEF12345678.jpg",
  expires: 1893456000,
};
const signed = await signBunnyStorageUrl(signArgs);
assert.match(
  signed,
  /^https:\/\/chat-media\.example\.b-cdn\.net\/photos\/match-abc\/user-1\/req-DEADBEEF12345678\.jpg\?/,
  "signed URL targets the provided hostname + object path",
);
assert.match(signed, /token=HS256-/, "uses the Advanced HMAC-SHA256 token scheme");
assert.match(signed, /[?&]expires=1893456000(&|$)/, "carries the expires query param");
assert.match(signed, /[?&]token_path=/, "scopes the token to the object path");

// Deterministic for identical inputs; sensitive to expiry (so each issue re-signs).
const signedAgain = await signBunnyStorageUrl(signArgs);
assert.equal(signed, signedAgain, "deterministic for identical inputs");
const signedLater = await signBunnyStorageUrl({ ...signArgs, expires: signArgs.expires + 1 });
assert.notEqual(signed, signedLater, "different expiry yields a different token (cache-busting per issue)");

// Tolerates a leading slash in the path without doubling it.
const signedSlash = await signBunnyStorageUrl({ ...signArgs, path: `/${signArgs.path}` });
assert.equal(signedSlash, signed, "leading slash in path is normalized");

// --- Source contract: shared signer export ---
const tokens = read("supabase/functions/_shared/bunny-stream-tokens.ts");
assert.match(tokens, /export async function signBunnyStorageUrl/);

// --- Source contract: get-chat-media-url Tier 1 + Tier 2 ---
const issuer = read("supabase/functions/get-chat-media-url/index.ts");

// Tier 1: token-aligned dynamic proxy cache header replaced the fixed max-age=60.
assert.match(issuer, /private, max-age=\$\{proxyMaxAgeSeconds\}, immutable/);
assert.match(issuer, /PROXY_CACHE_SAFETY_SECONDS/);
assert.doesNotMatch(issuer, /"private, max-age=60"/, "the fixed 60s header must be gone");

// Tier 2: signed direct CDN is flag-gated and falls back to the proxy by default.
assert.match(issuer, /CHAT_MEDIA_DIRECT_CDN_ENABLED/);
assert.match(issuer, /function directChatStorageCdnConfigForTier/);
assert.match(issuer, /if \(enabled !== "true" && enabled !== "1"\) return null/);
assert.match(issuer, /signBunnyStorageUrl\(/);
// Dedicated token-auth hostname — never the public profile/event CDN host.
assert.match(issuer, /BUNNY_CHAT_STORAGE_CDN_HOSTNAME/);
assert.doesNotMatch(issuer, /BUNNY_CDN_HOSTNAME"\)/, "must not reuse the public BUNNY_CDN_HOSTNAME for chat media");

// Reliability invariant: the byte-streaming proxy fallback is retained.
assert.match(issuer, /storage\.bunnycdn\.com/);
assert.match(issuer, /functions\/v1\/get-chat-media-url\?token=/);

console.log("chat-media-direct-cdn-contract tests passed");
