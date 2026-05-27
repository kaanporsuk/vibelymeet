import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const migration = read("supabase/migrations/20260527130000_auth_sprint6_data_quality_observability.sql");
const profileBootstrap = read("shared/profileBootstrap.ts");
const bootstrapDocs = read("docs/auth-bootstrap-ownership.md");
const closure = read("docs/auth/auth-investigation-closure-2026-05-27.md");
const nativeLayout = read("apps/mobile/app/_layout.tsx");
const emailVerification = read("supabase/functions/email-verification/index.ts");
const phoneVerify = read("supabase/functions/phone-verify/index.ts");
const generatedTypes = read("src/integrations/supabase/types.ts");
const liveAudit = read("scripts/audit-auth-live.mjs");

test("Sprint 6 migration sanitizes auth provider display names before profile bootstrap", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.sanitize_profile_display_name\(p_input text\)/);
  assert.match(migration, /SET search_path TO pg_catalog, public/);
  assert.match(migration, /regexp_replace\(value, '\[\[:cntrl:\]\]', '', 'g'\)/);
  assert.match(migration, /regexp_replace\([\s\S]{0,120}'\[\[:space:\]\]\+'/);
  for (const codepoint of ["chr(173)", "chr(8203)", "chr(8204)", "chr(8205)", "chr(8206)", "chr(8207)", "chr(8288)", "chr(65279)"]) {
    assert.match(migration, new RegExp(codepoint.replace(/[()]/g, "\\$&")));
  }
  assert.match(migration, /left\(value, 80\)/);
  assert.match(migration, /NULLIF\(btrim\(left\(value, 80\)\), ''\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.sanitize_profile_display_name\(text\)[\s\S]{0,80}FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bootstrap_profile_from_auth_user\(\)/);
  assert.match(migration, /public\.sanitize_profile_display_name\([\s\S]{0,220}raw_user_meta_data ->> 'full_name'/);
  assert.match(migration, /raw_user_meta_data ->> 'name'/);
  assert.match(migration, /raw_user_meta_data ->> 'display_name'/);
  assert.match(migration, /set_config\('vibely\.verification_server_update', '1', true\)/);
  assert.match(migration, /ON CONFLICT \(id\) DO NOTHING/);
});

test("verification_attempts is namespaced by flow in schema, email, and phone writers", () => {
  assert.match(migration, /ALTER TABLE public\.verification_attempts[\s\S]{0,80}ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'legacy'/);
  assert.match(migration, /verification_attempts_flow_format[\s\S]{0,120}flow ~ '\^\[a-z\]\[a-z0-9_:-\]\{0,63\}\$'/);
  assert.match(migration, /idx_verification_attempts_user_flow_time[\s\S]{0,100}\(user_id, flow, attempt_at DESC\)/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can view own verification attempts"/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.verification_attempts[\s\S]{0,80}FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.verification_attempts[\s\S]{0,80}TO service_role/);

  assert.match(emailVerification, /const EMAIL_OTP_VERIFY_FLOW = "email_otp_verify"/);
  assert.match(emailVerification, /\.eq\("flow", EMAIL_OTP_VERIFY_FLOW\)[\s\S]{0,120}\.gte\("attempt_at", oneHourAgo\)/);
  assert.match(emailVerification, /\.insert\(\{ user_id: user\.id, flow: EMAIL_OTP_VERIFY_FLOW \}\)/);
  assert.match(emailVerification, /\.delete\(\)[\s\S]{0,120}\.eq\("flow", EMAIL_OTP_VERIFY_FLOW\)/);

  assert.match(phoneVerify, /const PHONE_VERIFY_SEND_FLOW = "phone_verify_send"/);
  assert.match(phoneVerify, /\.eq\("flow", PHONE_VERIFY_SEND_FLOW\)[\s\S]{0,120}\.gte\("attempt_at", oneHourAgo\)/);
  assert.match(phoneVerify, /flow:\s*PHONE_VERIFY_SEND_FLOW/);

  assert.match(generatedTypes, /verification_attempts: \{[\s\S]{0,160}flow: string/);
  assert.match(generatedTypes, /Insert: \{[\s\S]{0,120}flow\?: string/);
  assert.match(generatedTypes, /Update: \{[\s\S]{0,120}flow\?: string/);
  assert.match(generatedTypes, /sanitize_profile_display_name:\s*\{\s*Args:\s*\{\s*p_input: string\s*\}\s*Returns: string \| null\s*\}/);
  assert.match(read("scripts/regen-supabase-types.sh"), /Expected sanitize_profile_display_name to return string \| null/);
});

test("live audit harness proves Sprint 6 database posture after migration", () => {
  for (const check of [
    "sanitize_profile_display_name_body",
    "bootstrap_profile_display_name_sanitizer",
    "verification_attempts_flow_column",
    "verification_attempts_flow_index",
    "verification_attempts_client_grants",
  ]) {
    assert.match(liveAudit, new RegExp(check));
  }

  assert.match(liveAudit, /sanitize_profile_display_name/);
  assert.match(liveAudit, /idx_verification_attempts_user_flow_time/);
  assert.match(liveAudit, /trims_after_cap/);
  assert.match(liveAudit, /c\.column_default like '%legacy%'/);
  assert.match(liveAudit, /g\.privilege_type in \('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'\)/);
});

test("ensureProfileReady remains a documented read-only trigger readiness check", () => {
  assert.match(profileBootstrap, /Defensive, read-only readiness check/);
  assert.match(profileBootstrap, /must never insert\/upsert profiles/);
  assert.match(profileBootstrap, /\.from\("profiles"\)[\s\S]{0,80}\.select\("id"\)/);
  assert.doesNotMatch(profileBootstrap, /\.(?:insert|upsert)\(/);
  assert.match(bootstrapDocs, /`ensureProfileReady\(\.\.\.\)` is a defensive, read-only check/);
  assert.match(bootstrapDocs, /must not insert, upsert, or repair `profiles` client-side/);
});

test("phone-verify health_check is removed from callable web and Edge surfaces", () => {
  assert.match(phoneVerify, /if \(action !== "send_otp" && action !== "verify_otp"\)/);
  assert.doesNotMatch(phoneVerify, /health_check|hasSid|hasToken|hasVerify/);
  assert.doesNotMatch(read("src/components/PhoneVerification.tsx"), /health_check|phoneVerifyDiagEnabled/);
});

test("provider failure copy does not expose provider response bodies to clients", () => {
  assert.match(emailVerification, /Unable to send verification email\. Please try again later\./);
  assert.doesNotMatch(emailVerification, /Unable to send verification email: \$\{errorMessage\}|resendMessage/);
  assert.doesNotMatch(emailVerification, /responseObject\.message|responseObject\.error/);

  assert.match(phoneVerify, /SMS service is temporarily unavailable\. Please try again later\./);
  assert.match(phoneVerify, /Verification service is temporarily unavailable\. Please try again later\./);
  assert.doesNotMatch(phoneVerify, /Twilio error: \$\{msg\}|data\?\.message \|\| "Verification failed\."/);
  assert.doesNotMatch(read("src/components/PhoneVerification.tsx"), /twilioCode/);
});

test("native profile-preview remains root-gated", () => {
  assert.match(nativeLayout, /const PROTECTED_ROOT_SEGMENTS = new Set\(\[/);
  assert.match(nativeLayout, /'profile-preview'/);
});

test("Sprint 6 closure ledger is current", () => {
  assert.match(closure, /Sprint 6 implemented: metadata display names/);
  assert.match(closure, /Sprint 6 implemented: `ensureProfileReady\(\)` is documented/);
  assert.match(closure, /Sprint 6 implemented: `email-verification` logs no longer emit recipient\/user email values/);
  assert.match(closure, /Sprint 6 implemented: `phone-verify` `health_check` has been removed/);
  assert.match(closure, /Sprint 6 implemented: `verification_attempts` throttling is namespaced by flow/);
  assert.match(closure, /Current Live Alignment Note/);
  assert.match(closure, /Production Supabase is aligned with the current repo for Sprints 0-6/);
  assert.match(closure, /Post-deploy `npm run audit:auth-live` passes with `0 fail, 0 warn, 40 checks`/);
  assert.match(closure, /Release-order invariant for future environments: apply the Sprint 6 migration first, then deploy the changed `email-verification` and `phone-verify` Edge Functions/);
  assert.match(closure, /Do not deploy the current Edge Function code ahead of the migration/);
});
