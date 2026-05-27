import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("web OAuth callback is deterministic across full-page redirects", () => {
  const authPage = read("src/pages/Auth.tsx");

  assert.match(authPage, /WEB_OAUTH_PROVIDER_STORAGE_KEY/);
  assert.match(authPage, /WEB_OAUTH_PROVIDER_COOKIE/);
  assert.match(authPage, /WEB_OAUTH_PROVIDER_CONTEXT_TTL_SECONDS = 5 \* 60/);
  assert.match(authPage, /return readOAuthProviderCookie\(\)/);
  assert.match(authPage, /writeOAuthProviderCookie\(provider\)/);
  assert.match(authPage, /clearOAuthProviderCookie\(\)/);
  assert.match(authPage, /SameSite=Lax/);
  assert.match(authPage, /storeOAuthProvider\("google"\)/);
  assert.match(authPage, /storeOAuthProvider\("apple"\)/);
  assert.match(authPage, /redirectTo: `\$\{window\.location\.origin\}\/auth\?provider_callback=true`/);
  assert.doesNotMatch(authPage, /provider_callback=true&provider=(google|apple)/);
  assert.match(authPage, /getCallbackProvider\(search\) \?\? readStoredOAuthProvider\(\) \?\? pendingOAuthProviderRef\.current/);
  assert.match(authPage, /WEB_OAUTH_CALLBACK_TIMEOUT_MS = 5_000/);
  assert.match(authPage, /supabase\.auth\.onAuthStateChange/);
  assert.match(authPage, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(authPage, /clearStoredOAuthProvider\(\)/);
  assert.doesNotMatch(authPage, /setTimeout\(r,\s*100\)/);
});

test("web identity-linking callback surfaces provider errors before clearing URL params", () => {
  const identityLinking = read("src/hooks/useIdentityLinking.ts");

  assert.match(identityLinking, /parseOAuthCallbackErrorDescription\(url\.search, url\.hash\)/);
  assert.match(identityLinking, /const provider: OAuthLinkProvider = providerParam === 'apple' \? 'apple' : 'google'/);
  assert.match(identityLinking, /safeIdentityLinkingErrorMessage\(\s*\{ message: oauthError \}/);
  assert.match(identityLinking, /const \{ error \} = await supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(identityLinking, /const \{ data: identityData \} = await supabase\.auth\.getUserIdentities\(\)/);
  assert.match(identityLinking, /const alreadyLinked = \(identityData\?\.identities \?\? \[\]\)\.some\(i => i\.provider === provider\)/);
  assert.match(identityLinking, /if \(error\) \{[\s\S]*setState\(prev => \(\{/);
  assert.match(identityLinking, /function clearIdentityLinkingCallbackUrl\(url: URL\)/);
  assert.match(identityLinking, /url\.hash = ''/);
  assert.match(identityLinking, /window\.history\.replaceState\(\{\}, document\.title, url\.toString\(\)\)/);
  assert.doesNotMatch(identityLinking, /if \(!data\.session\)/);
});

test("native profile preview is protected at the root route gate", () => {
  const nativeLayout = read("apps/mobile/app/_layout.tsx");
  const protectedSegments = nativeLayout.slice(
    nativeLayout.indexOf("const PROTECTED_ROOT_SEGMENTS = new Set(["),
    nativeLayout.indexOf("]);", nativeLayout.indexOf("const PROTECTED_ROOT_SEGMENTS = new Set([")),
  );

  assert.match(protectedSegments, /'profile-preview'/);
});
