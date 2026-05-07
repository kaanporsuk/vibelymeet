import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("native video-date partner avatar fallback resolves CDN-safe URLs before Image render", () => {
  const api = read("apps/mobile/lib/videoDateApi.ts");
  const route = read("apps/mobile/app/date/[id].tsx");

  assert.match(api, /import \{ avatarUrl \} from '@\/lib\/imageUrl'/);
  assert.match(api, /const rawAvatarUrl = typeof row\.avatar_url === 'string' \? row\.avatar_url : null/);
  assert.match(api, /avatar_url: rawAvatarUrl \? avatarUrl\(rawAvatarUrl, 'avatar'\) : null/);
  assert.match(route, /partnerAvatarUri = fullPartner\?\.avatarUrl \?\? fullPartner\?\.photos\?\.\[0\] \?\? basicPartner\?\.avatar_url \?\? null/);
});

test("native Supabase auth installs SHA-256 WebCrypto before client creation", async () => {
  const supabase = read("apps/mobile/lib/supabase.ts");
  const shim = read("apps/mobile/lib/webCryptoSha256.ts");
  const imported = await import("../../apps/mobile/lib/webCryptoSha256.ts");
  const moduleShape = imported as unknown as {
    digestSha256ForPkce?: (data: Uint8Array) => ArrayBuffer;
    default?: { digestSha256ForPkce?: (data: Uint8Array) => ArrayBuffer };
  };
  const digestSha256ForPkce = moduleShape.digestSha256ForPkce ?? moduleShape.default?.digestSha256ForPkce;

  assert.ok(supabase.indexOf("import '@/lib/webCryptoSha256'") < supabase.indexOf("createClient"));
  assert.match(shim, /installNativeSha256SubtleCrypto\(\)/);
  assert.equal(typeof digestSha256ForPkce, "function");
  assert.equal(
    Buffer.from(digestSha256ForPkce(new TextEncoder().encode("vibely-pkce"))).toString("hex"),
    "a49d295958e8563b85c37a9933657de366b2a2288f6453585c302c16053cab52",
  );
});

test("native Apple Sign-In treats ASAuthorization 1001 as cancellation with diagnostics", () => {
  const signIn = read("apps/mobile/app/(auth)/sign-in.tsx");

  assert.match(signIn, /function isAppleAuthCancelled/);
  assert.match(signIn, /AuthorizationError\(\?:\\s\+error\)\?\\s\+1001/);
  assert.match(signIn, /addAppleAuthDiagnostic\('Authorization cancelled'/);
  assert.match(signIn, /auth_social_cancelled/);
  assert.match(signIn, /addAppleAuthDiagnostic\('Authorization failed'/);
});

test("native handshake CTA emits visibility, final-ten, and timeout context telemetry", () => {
  const route = read("apps/mobile/app/date/[id].tsx");

  assert.match(route, /handshakeCtaImpressionRef/);
  assert.match(route, /handshake_cta_visible/);
  assert.match(route, /video_date_handshake_cta_visible/);
  assert.match(route, /handshake_cta_hidden/);
  assert.match(route, /video_date_handshake_cta_hidden/);
  assert.match(route, /handshake_final_10s_nudge/);
  assert.match(route, /const hasHandshakePeerEvidence = hasRemotePartner \|\| \(peerServerJoinedAt != null && !isPartnerDisconnected\)/);
  assert.match(route, /hasHandshakePeerEvidence &&/);
  assert.match(route, /peer_server_joined: peerServerJoinedAt != null/);
  assert.match(route, /Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Warning\)/);
  assert.match(route, /ctaTelemetry: handshakeCtaLatestRef\.current/);
});

test("OneSignal app group is explicit in source config and native preflight", () => {
  const appBase = read("apps/mobile/app.base.json");
  const preflight = read("scripts/native-launch-preflight.mjs");

  assert.match(appBase, /"com\.apple\.security\.application-groups"/);
  assert.match(appBase, /"group\.com\.vibelymeet\.vibely\.onesignal"/);
  assert.match(preflight, /"expo", "config", "--json"/);
  assert.match(preflight, /Production OneSignal plugin mode expected production/);
  assert.match(preflight, /exactly one OneSignal extension/);
  assert.match(preflight, /const ONESIGNAL_APP_GROUP = "group\.com\.vibelymeet\.vibely\.onesignal"/);
  assert.match(preflight, /Generated Vibely\.entitlements is missing/);
  assert.match(preflight, /Generated OneSignal extension entitlements is missing/);
});
