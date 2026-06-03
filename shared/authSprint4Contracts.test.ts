import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  authOtpCooldownForAttempt,
  authProviderRetryAfterSeconds,
  nextAuthOtpCooldownSeconds,
} from "./authOtpCooldown";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Sprint 4 cooldown policy is shared and honors provider retry hints", () => {
  assert.equal(authOtpCooldownForAttempt(1), 60);
  assert.equal(authOtpCooldownForAttempt(2), 180);
  assert.equal(authOtpCooldownForAttempt(3), 900);
  assert.equal(authOtpCooldownForAttempt(50), 900);
  assert.equal(authProviderRetryAfterSeconds({ retry_after: "72" }), 72);
  assert.equal(authProviderRetryAfterSeconds({ retryAfter: 91.2 }), 92);
  assert.equal(authProviderRetryAfterSeconds({ message: "Please try again after 43 seconds." }), 43);
  assert.equal(nextAuthOtpCooldownSeconds(2, { retry_after: "75" }), 75);
  assert.equal(nextAuthOtpCooldownSeconds(2, {}), 180);
});

test("web auth collects and forwards Turnstile tokens for auth entry flows", () => {
  const authPage = read("src/pages/Auth.tsx");
  const resetPage = read("src/pages/ResetPassword.tsx");
  const turnstile = read("src/components/auth/AuthTurnstile.tsx");
  const turnstileLib = read("src/lib/authTurnstile.ts");
  const challenge = read("src/pages/AuthChallenge.tsx");
  const app = read("src/App.tsx");
  const routes = read("src/lib/routePreload.ts");
  const adminLogin = read("src/pages/admin/AdminLogin.tsx");
  const accountSettings = read("src/components/settings/AccountSettingsDrawer.tsx");
  const authContext = read("src/contexts/AuthContext.tsx");
  const publicDelete = read("src/pages/legal/DeleteAccountWeb.tsx");

  assert.match(turnstileLib, /VITE_TURNSTILE_SITE_KEY/);
  assert.match(turnstileLib, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(turnstileLib, /function loadTurnstileScript/);
  assert.match(turnstile, /from "@\/lib\/authTurnstile"/);
  assert.match(publicDelete, /loadTurnstileScript/);
  assert.match(publicDelete, /removeTurnstile/);
  assert.match(challenge, /safeNativeReturnUrl/);
  assert.match(challenge, /safeTurnstileAction/);
  assert.match(challenge, /replace\(\/\[\^a-z0-9_-\]\/g, "_"\)/);
  assert.match(challenge, /com\.vibelymeet\.vibely:/);
  assert.match(challenge, /captchaToken/);
  assert.match(app, /<Route path="\/auth\/challenge" element={<AuthChallenge \/>} \/>/);
  assert.match(routes, /authChallenge: \(\) => import\("@\/pages\/AuthChallenge"\)/);

  for (const action of [
    "web_phone_otp_send",
    "web_phone_otp_resend",
    "web_email_signin",
    "web_email_signup",
    "web_email_signup_resend",
  ]) {
    assert.match(authPage, new RegExp(action));
  }
  assert.match(resetPage, /web_password_reset/);

  assert.match(authPage, /supabase\.auth\.signInWithOtp\(\{\s*phone: fullPhone,[\s\S]*options: \{ captchaToken \}/);
  assert.match(authPage, /supabase\.auth\.signInWithOtp\(\{\s*phone: phoneForOtp,[\s\S]*options: \{ captchaToken \}/);
  assert.match(authPage, /supabase\.auth\.signInWithPassword\(\{[\s\S]*options: \{ captchaToken \}/);
  assert.match(authPage, /supabase\.auth\.signUp\(\{[\s\S]*captchaToken/);
  assert.match(authPage, /supabase\.auth\.resend\(\{[\s\S]*captchaToken/);
  assert.match(resetPage, /resetPasswordForEmail\(email\.trim\(\), \{[\s\S]*captchaToken: requestCaptchaToken/);
  assert.match(adminLogin, /web_admin_signin/);
  assert.match(adminLogin, /supabase\.auth\.signInWithPassword\(\{[\s\S]*options: \{ captchaToken: requestCaptchaToken \}/);
  assert.match(accountSettings, /web_settings_password_reauth/);
  assert.match(accountSettings, /web_settings_phone_reauth/);
  assert.match(accountSettings, /supabase\.auth\.signInWithPassword\(\{[\s\S]*options: \{ captchaToken: requestCaptchaToken \}/);
  assert.match(authContext, /captchaToken\?: string \| null/);
  assert.match(authContext, /supabase\.auth\.signInWithPassword\(\{[\s\S]*options: \{ captchaToken \}/);
});

test("native auth uses browser challenge tokens for Supabase auth calls", () => {
  const nativeCaptcha = read("apps/mobile/lib/nativeAuthCaptcha.ts");
  const nativeSignIn = read("apps/mobile/app/(auth)/sign-in.tsx");
  const appleAuth = read("apps/mobile/lib/appleAuth.ts");
  const nativeReset = read("apps/mobile/app/(auth)/reset-password.tsx");
  const nativeAuthApi = read("apps/mobile/lib/authApi.ts");
  const nativeAccount = read("apps/mobile/app/settings/account.tsx");
  const nativeContext = read("apps/mobile/context/AuthContext.tsx");

  assert.match(nativeCaptcha, /Linking\.createURL\(AUTH_CAPTCHA_CALLBACK_PATH\)/);
  assert.match(nativeCaptcha, /new URL\('\/auth\/challenge', WEB_APP_ORIGIN\)/);
  assert.match(nativeCaptcha, /isExpoDevReturnUrl\(returnUrl\) && !isLocalChallengeOrigin\(\)/);
  assert.match(nativeCaptcha, /if \(!__DEV__\)/);
  assert.match(nativeCaptcha, /Verification is not available in this build/);
  assert.match(nativeCaptcha, /return \{ ok: true, token: null \}/);
  assert.match(nativeCaptcha, /WebBrowser\.openAuthSessionAsync\(challengeUrl, returnUrl\)/);
  assert.match(nativeCaptcha, /DEFAULT_NATIVE_AUTH_CAPTCHA_TIMEOUT_MS = 30_000/);
  assert.match(nativeCaptcha, /openAuthSessionWithTimeout/);
  assert.match(nativeCaptcha, /WebBrowser\.dismissAuthSession\(\)/);
  assert.match(nativeCaptcha, /Verification timed out\. Please try again\./);
  assert.match(nativeCaptcha, /captchaToken/);

  assert.match(appleAuth, /function summarizeAppleCredentialSecret/);
  assert.match(appleAuth, /export function buildAppleSupabaseIdTokenCredentials/);
  assert.match(appleAuth, /access_token: input\.credential\.authorizationCode \?\? undefined/);
  assert.match(appleAuth, /\.\.\.\(captchaToken \? \{ options: \{ captchaToken \} \} : \{\}\)/);
  assert.doesNotMatch(appleAuth, /prefix: value\.length/);

  for (const action of [
    "native_phone_otp_send",
    "native_phone_otp_resend",
    "native_email_signin",
    "native_email_signup",
    "native_email_signup_resend",
    "native_apple_signin",
  ]) {
    assert.match(nativeSignIn, new RegExp(action));
  }
  assert.match(nativeReset, /native_password_reset/);

  assert.match(nativeSignIn, /supabase\.auth\.signInWithOtp\(\{[\s\S]*options: \{ captchaToken: captcha\.token \}/);
  assert.match(nativeSignIn, /supabase\.auth\.signInWithPassword\(\{[\s\S]*options: \{ captchaToken: captcha\.token \}/);
  assert.match(nativeSignIn, /supabase\.auth\.signUp\(\{[\s\S]*captchaToken: captcha\.token/);
  assert.match(nativeSignIn, /supabase\.auth\.resend\(\{[\s\S]*captchaToken: captcha\.token/);
  const appleCaptchaIndex = nativeSignIn.indexOf("requestNativeAuthCaptchaToken('native_apple_signin'");
  const appleAuthorizeIndex = nativeSignIn.indexOf("AppleAuthentication.signInAsync");
  assert.ok(appleCaptchaIndex > -1, "native Apple sign-in must request CAPTCHA");
  assert.ok(appleAuthorizeIndex > appleCaptchaIndex, "native Apple CAPTCHA must run before Apple authorization");
  assert.match(nativeSignIn, /NATIVE_APPLE_AUTH_CAPTCHA_TIMEOUT_MS = 30_000/);
  assert.match(nativeSignIn, /NATIVE_APPLE_AUTH_SUPABASE_TIMEOUT_MS = 25_000/);
  assert.match(nativeSignIn, /NATIVE_APPLE_AUTH_METADATA_TIMEOUT_MS = 5_000/);
  assert.match(nativeSignIn, /addAppleAuthStageDiagnostic/);
  assert.match(nativeSignIn, /withAppleAuthStageTimeout/);
  assert.match(nativeSignIn, /runAppleAuthStage\([\s\S]*'supabase_exchange'[\s\S]*timeoutMs: NATIVE_APPLE_AUTH_SUPABASE_TIMEOUT_MS/);
  assert.match(nativeSignIn, /const appleIdTokenCredentials = buildAppleSupabaseIdTokenCredentials\(\{[\s\S]*credential,[\s\S]*rawNonce,[\s\S]*captchaToken: captcha\.token/);
  assert.match(nativeSignIn, /supabase\.auth\.signInWithIdToken\(appleIdTokenCredentials\)/);
  assert.match(nativeSignIn, /primeCachedSession\(data\.session\)/);
  assert.match(nativeAccount, /native_settings_password_reauth/);
  assert.match(nativeAccount, /supabase\.auth\.signInWithPassword\(\{[\s\S]*options: \{ captchaToken: captcha\.token \}/);
  assert.match(nativeAuthApi, /signInWithEmail\([\s\S]*captchaToken\?: string \| null/);
  assert.match(nativeContext, /captchaToken\?: string \| null/);
  assert.match(nativeAuthApi, /resetPasswordForEmail\(email, \{[\s\S]*captchaToken/);
});

test("Sprint 4 auth UX exposes forgot-password from welcome and applies cooldowns on failures", () => {
  const webAuth = read("src/pages/Auth.tsx");
  const webReset = read("src/pages/ResetPassword.tsx");
  const nativeSignIn = read("apps/mobile/app/(auth)/sign-in.tsx");
  const nativeReset = read("apps/mobile/app/(auth)/reset-password.tsx");
  const hardeningRunner = read("scripts/run_auth_hardening_tests.sh");

  assert.match(webAuth, /Forgot password\?/);
  assert.match(webAuth, /navigate\("\/reset-password"\)/);
  assert.match(nativeSignIn, /Forgot password\?/);
  assert.match(nativeSignIn, /router\.push\('\/\(auth\)\/reset-password'\)/);

  for (const source of [webAuth, nativeSignIn]) {
    assert.match(source, /phoneSendCooldownRemaining/);
    assert.match(source, /nextAuthOtpCooldownSeconds/);
    assert.match(source, /emailResendAttempts/);
    assert.match(source, /Could not resend\. Try again in/);
  }

  assert.match(webReset, /resetRequestCooldown/);
  assert.match(nativeReset, /resetRequestCooldown/);
  assert.match(hardeningRunner, /shared\/authSprint4Contracts\.test\.ts/);
});
