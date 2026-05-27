import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("web and native Supabase clients use explicit PKCE without automatic URL parsing", () => {
  const webClient = read("src/integrations/supabase/client.ts");
  const nativeClient = read("apps/mobile/lib/supabase.ts");

  for (const client of [webClient, nativeClient]) {
    assert.match(client, /autoRefreshToken:\s*false/);
    assert.match(client, /detectSessionInUrl:\s*false/);
    assert.match(client, /flowType:\s*'pkce'/);
  }
});

test("web OAuth callbacks carry provider context and avoid fixed-delay session polling", () => {
  const authPage = read("src/pages/Auth.tsx");

  assert.match(authPage, /function getWebOAuthRedirectUrl\(provider: WebOAuthProvider\): string/);
  assert.match(authPage, /redirectUrl\.searchParams\.set\("provider_callback", "true"\)/);
  assert.match(authPage, /redirectUrl\.searchParams\.set\("provider", provider\)/);
  assert.match(authPage, /redirectTo: getWebOAuthRedirectUrl\("google"\)/);
  assert.match(authPage, /redirectTo: getWebOAuthRedirectUrl\("apple"\)/);
  assert.match(authPage, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(authPage, /supabase\.auth\.onAuthStateChange/);
  assert.match(authPage, /WEB_OAUTH_CALLBACK_TIMEOUT_MS = 5_000/);
  assert.match(authPage, /parseOAuthCallbackErrorDescription\(search, hash\)/);
  assert.doesNotMatch(authPage, /setTimeout\(r,\s*100\)/);
});

test("web PKCE handles generic email confirmation auth returns outside OAuth/recovery", () => {
  const app = read("src/App.tsx");
  const webAuthReturn = read("src/lib/webAuthReturn.ts");
  const webAuthReturnHandler = read("src/components/WebAuthReturnHandler.tsx");
  const webAuthReturnBootstrap = read("src/lib/webAuthReturnBootstrap.ts");
  const webPasswordRecoveryHandler = read("src/components/WebPasswordRecoveryHandler.tsx");
  const authPage = read("src/pages/Auth.tsx");

  assert.match(app, /<WebAuthReturnHandler \/>[\s\S]*<WebPasswordRecoveryHandler \/>/);
  assert.match(webAuthReturn, /hasPasswordRecoveryIntent/);
  assert.match(webAuthReturn, /provider_callback/);
  assert.match(webAuthReturn, /linking/);
  assert.match(webAuthReturn, /supabase\.auth\.exchangeCodeForSession\(parsed\.code\)/);
  assert.match(webAuthReturn, /normalizeAuthReturnTokenHashOtpType\(parsed\.type, false\)/);
  assert.match(webAuthReturn, /supabase\.auth\.verifyOtp\(\{\s*token_hash: parsed\.tokenHash,\s*type: otpType,/);
  assert.match(webAuthReturn, /supabase\.auth\.setSession/);
  assert.match(webAuthReturnHandler, /getPendingBrowserAuthReturnUrl\(currentUrl\)/);
  assert.match(webAuthReturnHandler, /scrubCurrentAuthReturnUrl\(pendingAuthReturnUrl\)/);
  assert.match(webAuthReturnHandler, /clearCapturedInitialAuthReturnUrl\(\)/);
  assert.match(webAuthReturnBootstrap, /window\.history\.replaceState/);
  assert.match(webPasswordRecoveryHandler, /scrubCurrentAuthReturnUrl\(pendingRecoveryUrl\)/);
  assert.match(authPage, /searchParams\.get\("auth_error"\)/);
  assert.match(authPage, /nextParams\.delete\("auth_error"\)/);
});

test("email-change flows use explicit web and native auth-return redirects", () => {
  const webRedirectUrls = read("src/lib/webAuthRedirectUrls.ts");
  const webOnboardingEmail = read("src/pages/onboarding/steps/EmailCollectionStep.tsx");
  const webIdentityLinking = read("src/hooks/useIdentityLinking.ts");
  const webAccountSettings = read("src/components/settings/AccountSettingsDrawer.tsx");
  const nativeAuthRedirect = read("apps/mobile/lib/nativeAuthRedirect.ts");
  const nativeOnboardingEmail = read("apps/mobile/components/onboarding/steps/EmailCollectionStep.tsx");
  const nativeIdentityLinking = read("apps/mobile/hooks/useIdentityLinking.ts");
  const nativeAccountSettings = read("apps/mobile/app/settings/account.tsx");

  assert.match(webRedirectUrls, /getWebEmailChangeRedirectUrl/);
  assert.match(webOnboardingEmail, /emailRedirectTo: getWebEmailChangeRedirectUrl\(\)/);
  assert.match(webIdentityLinking, /emailRedirectTo: getWebEmailChangeRedirectUrl\(\)/);
  assert.match(webAccountSettings, /emailRedirectTo: getWebEmailChangeRedirectUrl\(\)/);

  assert.match(nativeAuthRedirect, /function getNativeEmailChangeRedirectUrl\(\): string/);
  assert.match(nativeOnboardingEmail, /emailRedirectTo: getNativeEmailChangeRedirectUrl\(\)/);
  assert.match(nativeIdentityLinking, /emailRedirectTo: getNativeEmailChangeRedirectUrl\(\)/);
  assert.match(nativeAccountSettings, /emailRedirectTo: getNativeEmailChangeRedirectUrl\(\)/);
});

test("bootstrap refresh runs before entry-state resolution on web and native", () => {
  const webAuth = read("src/contexts/AuthContext.tsx");
  const nativeAuth = read("apps/mobile/context/AuthContext.tsx");

  for (const authContext of [webAuth, nativeAuth]) {
    assert.match(authContext, /refreshBootstrapSessionIfNeeded/);
    assert.match(authContext, /shouldRefreshSessionSoon/);
    assert.match(authContext, /requestManagedAuthRefresh/);
    assert.match(authContext, /applyManagedAuthRefreshSession/);
    assert.match(authContext, /classifyAuthRefreshError/);
  }

  assert.match(webAuth, /const readySession = await refreshBootstrapSessionIfNeeded\(session\)[\s\S]*setSession\(readySession\)/);
  assert.match(nativeAuth, /const readySession = await refreshBootstrapSessionIfNeeded\(s\)[\s\S]*applyAuthSession\(readySession\)/);
});

test("expired-session redirects explain the auth bounce on web and native", () => {
  const webAuth = read("src/contexts/AuthContext.tsx");
  const protectedRoute = read("src/components/ProtectedRoute.tsx");
  const authPage = read("src/pages/Auth.tsx");
  const nativeAuth = read("apps/mobile/context/AuthContext.tsx");
  const nativeLayout = read("apps/mobile/app/_layout.tsx");

  assert.match(webAuth, /authRedirectReason: "session_expired" \| null/);
  assert.match(webAuth, /setAuthRedirectReason\("session_expired"\)/);
  assert.match(protectedRoute, /authSearch\.set\("reason", "session_expired"\)/);
  assert.match(authPage, /searchParams\.get\("reason"\) === "session_expired"/);
  assert.match(authPage, /Your session expired\. Sign in again to continue\./);

  assert.match(nativeAuth, /type AuthRedirectReason = 'session_expired' \| null/);
  assert.match(nativeAuth, /markSessionExpired/);
  assert.match(nativeAuth, /removeAllRealtimeChannels\(supabase, redirectReason === 'session_expired'/);
  assert.match(nativeLayout, /authRedirectReason === 'session_expired'/);
  assert.match(nativeLayout, /Your session expired\. Sign in again to continue\./);
});

test("identity-linking distinguishes confirmed methods from pending session contact fields", () => {
  const webHook = read("src/hooks/useIdentityLinking.ts");
  const nativeHook = read("apps/mobile/hooks/useIdentityLinking.ts");
  const webUi = read("src/components/settings/LinkedSignInMethods.tsx");
  const nativeUi = read("apps/mobile/components/settings/LinkedSignInMethods.tsx");

  for (const hook of [webHook, nativeHook]) {
    assert.match(hook, /export type LinkedIdentityStatus = 'confirmed' \| 'pending_confirmation'/);
    assert.match(hook, /status: 'confirmed'/);
    assert.match(hook, /status: 'pending_confirmation'/);
    assert.match(hook, /confirmedLinkedCount = state\.identities\.filter\(i => i\.status === 'confirmed'\)\.length/);
    assert.match(hook, /i\.provider === provider && i\.status === 'confirmed'/);
    assert.match(hook, /const linkedCount = confirmedLinkedCount/);
  }

  assert.match(webUi, /identity\?\.status === 'pending_confirmation'/);
  assert.match(webUi, /Awaiting confirmation/);
  assert.match(webUi, /Add password to enable email sign-in/);
  assert.match(nativeUi, /identity\?\.status === 'pending_confirmation'/);
  assert.match(nativeUi, /Awaiting confirmation/);
  assert.match(nativeUi, /Add password to enable email sign-in/);
});

test("native Apple auth remains iOS-only for sign-in and linking", () => {
  const nativeSignIn = read("apps/mobile/app/(auth)/sign-in.tsx");
  const nativeLinkedMethods = read("apps/mobile/components/settings/LinkedSignInMethods.tsx");

  assert.match(nativeSignIn, /if \(Platform\.OS !== 'ios'\) return null/);
  assert.match(nativeSignIn, /Continue with Apple/);
  assert.match(nativeLinkedMethods, /id: 'apple'[\s\S]*isAvailable: Platform\.OS === 'ios'/);
  assert.match(nativeLinkedMethods, /const availableProviders = PROVIDERS\.filter\(p => p\.isAvailable\)/);
});

test("native generic auth-return handling covers PKCE codes and token_hash verification", () => {
  const nativeAuthRedirect = read("apps/mobile/lib/nativeAuthRedirect.ts");
  const nativeIndex = read("apps/mobile/app/index.tsx");

  assert.match(nativeAuthRedirect, /supabase\.auth\.exchangeCodeForSession\(authReturn\.code\)/);
  assert.match(nativeAuthRedirect, /normalizeAuthReturnTokenHashOtpType\(authReturn\.type, recovery\)/);
  assert.match(nativeAuthRedirect, /const tokenHashFallback = recovery/);
  assert.match(nativeAuthRedirect, /That sign-in link is invalid or expired\. Please request a fresh link\./);
  assert.match(nativeAuthRedirect, /supabase\.auth\.verifyOtp\(\{\s*token_hash: authReturn\.tokenHash,\s*type: otpType,/);
  assert.match(nativeAuthRedirect, /recoveryStatus: recovery \? \(error \? 'invalid' : 'ready'\) : 'none'/);
  assert.match(nativeIndex, /authRedirectReason === 'session_expired'/);
  assert.match(nativeIndex, /Your session expired\. Sign in again to continue\./);
});
