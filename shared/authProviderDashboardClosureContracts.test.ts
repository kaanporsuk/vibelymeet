import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const liveCheck = read("docs/auth/provider-live-check-2026-05-27.md");
const checklist = read("docs/auth/provider-dashboard-checklist.md");
const closure = read("docs/auth/auth-investigation-closure-2026-05-27.md");
const viteConfig = read("vite.config.ts");
const webIdentityLinking = read("src/hooks/useIdentityLinking.ts");
const webSettings = read("src/pages/Settings.tsx");
const nativeAuthRedirect = read("apps/mobile/lib/nativeAuthRedirect.ts");
const sharedCors = read("supabase/functions/_shared/cors.ts");

test("Sprint 2 live provider check records live-confirmed auth settings and audit scope", () => {
  assert.match(liveCheck, /production Supabase project `schdyxcunwcvddlcshwd`/);
  assert.match(liveCheck, /npm run audit:auth-live/);
  assert.match(liveCheck, /Result: `0 fail, 0 warn, 41 checks`/);

  for (const setting of [
    "Signup enabled",
    "Email provider",
    "Phone provider",
    "Google provider",
    "Apple provider",
    "Email autoconfirm",
    "Phone autoconfirm",
    "SMS provider",
  ]) {
    assert.match(liveCheck, new RegExp(`\\| ${setting} \\|[\\s\\S]*?\\| \`LIVE-CONFIRMED\` \\|`));
  }

  assert.match(liveCheck, /Manual identity linking[\s\S]*`DASHBOARD-MANUAL`/);
  assert.match(liveCheck, /Same-email account behavior[\s\S]*`DASHBOARD-MANUAL`/);
});

test("Sprint 2 live provider check records exact redirect shapes from current repo", () => {
  assert.match(viteConfig, /port:\s*8080/);

  for (const url of [
    "https://www.vibelymeet.com",
    "https://vibelymeet.com",
    "https://www.vibelymeet.com/",
    "https://vibelymeet.com/",
    "https://www.vibelymeet.com/auth?provider_callback=true",
    "https://www.vibelymeet.com/auth?provider_callback=true&provider=google",
    "https://www.vibelymeet.com/auth?provider_callback=true&provider=apple",
    "https://vibelymeet.com/auth?provider_callback=true",
    "https://vibelymeet.com/auth?provider_callback=true&provider=google",
    "https://vibelymeet.com/auth?provider_callback=true&provider=apple",
    "https://www.vibelymeet.com/reset-password",
    "https://vibelymeet.com/reset-password",
    "https://www.vibelymeet.com/settings?drawer=account&linking=true&provider=google",
    "https://www.vibelymeet.com/settings?drawer=account&linking=true&provider=apple",
    "https://vibelymeet.com/settings?drawer=account&linking=true&provider=google",
    "https://vibelymeet.com/settings?drawer=account&linking=true&provider=apple",
    "http://localhost:8080",
    "http://localhost:8080/",
    "http://localhost:8080/auth?provider_callback=true",
    "http://localhost:8080/auth?provider_callback=true&provider=google",
    "http://localhost:8080/auth?provider_callback=true&provider=apple",
    "http://localhost:8080/reset-password",
    "http://localhost:8080/settings?drawer=account&linking=true&provider=google",
    "http://localhost:8080/settings?drawer=account&linking=true&provider=apple",
    "com.vibelymeet.vibely:///",
    "com.vibelymeet.vibely://",
    "com.vibelymeet.vibely://auth/callback",
    "com.vibelymeet.vibely://auth/callback?linking=true&provider=google",
    "com.vibelymeet.vibely://reset-password",
  ]) {
    assert.match(liveCheck, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(liveCheck, /Vite local dev port is `8080`/);
  assert.match(liveCheck, /Playwright E2E uses `127\.0\.0\.1:5173`/);
  assert.match(checklist, /localhost:8080/);
  assert.match(checklist, /localhost:5173/);
  assert.match(sharedCors, /http:\/\/localhost:8080/);
  assert.match(sharedCors, /http:\/\/127\.0\.0\.1:8080/);
  assert.match(sharedCors, /http:\/\/localhost:5173/);
  assert.match(sharedCors, /http:\/\/127\.0\.0\.1:5173/);
  assert.match(webIdentityLinking, /const redirectUrl = new URL\('\/settings', window\.location\.origin\)/);
  assert.match(webIdentityLinking, /redirectUrl\.searchParams\.set\('drawer', 'account'\)/);
  assert.match(webSettings, /drawer === "account"[\s\S]+setActiveDrawer\("account"\)/);
  assert.match(nativeAuthRedirect, /const ROOT_PATH = '\/'/);
  assert.match(nativeAuthRedirect, /Linking\.createURL\(ROOT_PATH\)/);
  assert.match(liveCheck, /standalone builds can represent that root as `com\.vibelymeet\.vibely:\/\/\/`/);
  assert.match(checklist, /Playwright E2E keeps `localhost:5173`/);
});

test("Sprint 2 live provider check covers provider dashboards without recording secrets", () => {
  for (const section of [
    "## Google OAuth",
    "## Apple Auth",
    "## Twilio Verify",
    "## Resend And Supabase Auth SMTP",
    "## CAPTCHA And Rate Limits",
    "## Required Manual Dashboard Checklist",
  ]) {
    assert.match(liveCheck, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const marker of [
    "Google Cloud Console",
    "Apple Developer",
    "Services ID",
    "Supabase Auth SMTP",
    "Resend domain verification",
    "Twilio Verify Service SID",
    "CODE-WIRED-SPRINT-4",
  ]) {
    assert.match(liveCheck, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(liveCheck, /client_secret\s*[:=]/i);
  assert.doesNotMatch(liveCheck, /TWILIO_AUTH_TOKEN\s*[:=]/);
  assert.doesNotMatch(liveCheck, /RESEND_API_KEY\s*[:=]/);
  assert.doesNotMatch(liveCheck, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]/);
  assert.doesNotMatch(liveCheck, /-----BEGIN PRIVATE KEY-----/);
});

test("closure ledger points to Sprint 2 and no longer says Sprint 1 is pending live migration", () => {
  assert.match(closure, /Production Supabase project `schdyxcunwcvddlcshwd` passes the current live auth audit with `0 fail, 0 warn, 41 checks`/);
  assert.match(closure, /Certification record: `docs\/auth\/auth-release-certification-2026-05-27\.md`/);
  assert.match(closure, /Sprint 2 dated provider closure exists at `docs\/auth\/provider-live-check-2026-05-27\.md`/);
  assert.doesNotMatch(closure, /pending live migration/);
});
