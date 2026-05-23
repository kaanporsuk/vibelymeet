import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const edgeFunction = read("supabase/functions/delete-account/index.ts");
const migration = read("supabase/migrations/20260523183000_account_deletion_reauth_challenges.sql");
const webHook = read("src/hooks/useDeleteAccount.ts");
const webModal = read("src/components/settings/DeleteAccountModal.tsx");
const nativeDelete = read("apps/mobile/app/delete-account.tsx");
const publicDelete = read("src/pages/legal/DeleteAccountWeb.tsx");

test("authenticated delete-account requires server-verified reauth proof", () => {
  assert.match(edgeFunction, /"request_reauth"/);
  assert.match(edgeFunction, /"schedule_deletion"/);
  assert.match(edgeFunction, /reauth_required/);
  assert.match(edgeFunction, /verifyDeletionReauth/);
  assert.match(edgeFunction, /reauthCode/);
  assert.match(edgeFunction, /reauthChannel/);
  assert.match(edgeFunction, /account_deletion_reauth_challenges/);
  assert.match(edgeFunction, /sendDeletionReauthEmail/);
  assert.match(edgeFunction, /sendDeletionReauthSms/);
  assert.match(edgeFunction, /resolveAvailableReauthTargets/);
  assert.match(edgeFunction, /consumeOtherReauthChallenges/);
  assert.doesNotMatch(edgeFunction, /auth\.admin\.signOut\(userId\)/);
  assert.match(edgeFunction, /\.update\(\{ verified_at: now, consumed_at: now \}\)[\s\S]*\.select\("id"\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(edgeFunction, /if \(updateError \|\| !consumedChallenge\?\.id\)/);
  assert.match(edgeFunction, /ACCOUNT_DELETION_RATE_LIMIT_PEPPER/);
  assert.doesNotMatch(edgeFunction, /turnstile|captchaToken|siteverify/i);
});

test("reauth challenge storage is service-role only and short-lived", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.account_deletion_reauth_challenges/);
  assert.match(migration, /ALTER TABLE public\.account_deletion_reauth_challenges ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.account_deletion_reauth_challenges FROM anon, authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.account_deletion_reauth_challenges TO service_role/);
  assert.match(migration, /expires_at timestamptz NOT NULL/);
  assert.match(migration, /code_hash text/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("web Settings delete requests OTP before scheduling deletion", () => {
  assert.match(webHook, /requestDeleteAccountVerification/);
  assert.match(webHook, /action: "request_reauth"/);
  assert.match(webHook, /action: "schedule_deletion"/);
  assert.match(webHook, /reauthCode: reauth\.code/);
  assert.match(webHook, /reauthChannel: reauth\.channel/);
  assert.match(webModal, /onRequestVerification/);
  assert.match(webModal, /Verify it’s you/);
  assert.match(webModal, /one-time-code/);
  assert.match(webModal, /overflow-y-auto/);
  assert.match(webModal, /verificationCode\.length === 6/);
  assert.doesNotMatch(webModal, /turnstile|captchaToken/i);
});

test("native Settings delete requests OTP before scheduling deletion", () => {
  assert.match(nativeDelete, /requestDeletionVerification/);
  assert.match(nativeDelete, /action: 'request_reauth'/);
  assert.match(nativeDelete, /action: 'schedule_deletion'/);
  assert.match(nativeDelete, /reauthCode: code/);
  assert.match(nativeDelete, /reauthChannel: challenge\.channel/);
  assert.match(nativeDelete, /Verify it’s you/);
  assert.match(nativeDelete, /textContentType="oneTimeCode"/);
  assert.match(nativeDelete, /keep using Vibely during the grace window/);
  assert.doesNotMatch(nativeDelete, /turnstile|captchaToken/i);
});

test("public delete-account remains the only Turnstile-gated delete flow", () => {
  assert.match(publicDelete, /VITE_TURNSTILE_SITE_KEY/);
  assert.match(publicDelete, /window\.turnstile\.render/);
  assert.match(publicDelete, /captchaToken/);
  assert.doesNotMatch(publicDelete, /turnstile\.execute|invisible/i);
});
