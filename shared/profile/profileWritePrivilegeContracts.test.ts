import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migrationPath = "supabase/migrations/20260527120000_auth_profile_write_privilege_hardening.sql";
const migration = read(migrationPath);

const backendOwnedProfileColumns = [
  "phone_number",
  "verified_email",
  "phone_verified",
  "phone_verified_at",
  "email_verified",
  "photo_verified",
  "photo_verified_at",
  "photo_verification_expires_at",
  "proof_selfie_url",
  "is_premium",
  "premium_until",
  "premium_granted_at",
  "premium_granted_by",
  "subscription_tier",
  "is_suspended",
  "suspension_reason",
  "onboarding_complete",
  "onboarding_stage",
  "location",
  "location_data",
  "bunny_video_uid",
  "bunny_video_status",
  "vibe_video_status",
  "vibe_video_playback_ref",
  "vibe_video_captions",
  "vibe_score",
  "vibe_score_label",
  "events_attended",
  "total_matches",
  "total_conversations",
  "last_seen_at",
  "referred_by",
];

const ownerEditableProfileColumns = [
  "name",
  "birth_date",
  "age",
  "gender",
  "interested_in",
  "tagline",
  "height_cm",
  "job",
  "company",
  "about_me",
  "bio",
  "looking_for",
  "relationship_intent",
  "lifestyle",
  "prompts",
  "photos",
  "avatar_url",
  "vibe_caption",
  "preferred_age_min",
  "preferred_age_max",
  "event_discovery_prefs",
  "account_paused",
  "account_paused_until",
  "is_paused",
  "paused_until",
  "paused_at",
  "pause_reason",
  "discoverable",
  "discovery_mode",
  "discovery_snooze_until",
  "discovery_audience",
  "activity_status_visibility",
  "distance_visibility",
  "event_attendance_visibility",
  "show_online_status",
  "email_unsubscribed",
  "community_agreed_at",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const path = join(dir, entry);
    const full = join(root, path);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
      out.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function directProfileUpdateBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /\.from\(['"]profiles['"]\)\s*\.update\(([\s\S]*?)\)\s*\.eq\(['"]id['"]/g;
  for (const match of source.matchAll(pattern)) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

test("profile write hardening revokes broad client table and column writes", () => {
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.profiles\s+FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(migration, /REVOKE INSERT \(%I\) ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE UPDATE \(%I\) ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /information_schema\.columns[\s\S]*table_name = 'profiles'/);
});

test("only owner-editable profile columns are re-granted to authenticated clients", () => {
  const safeArrayStart = migration.indexOf("v_safe_update_columns text[] := ARRAY[");
  assert.notEqual(safeArrayStart, -1);
  const safeArray = migration.slice(safeArrayStart, migration.indexOf("];", safeArrayStart));

  for (const column of ownerEditableProfileColumns) {
    assert.match(safeArray, new RegExp(`'${column}'`), `${column} should be in safe owner update grants`);
  }

  for (const column of backendOwnedProfileColumns) {
    assert.doesNotMatch(safeArray, new RegExp(`'${column}'`), `${column} must not be client update-granted`);
  }

  assert.match(migration, /GRANT UPDATE \(%s\) ON TABLE public\.profiles TO authenticated/);
  assert.doesNotMatch(migration, /GRANT INSERT[\s\S]*public\.profiles[\s\S]*authenticated/i);
});

test("sensitive profile trigger protects verification destination fields", () => {
  for (const column of [
    "phone_number",
    "verified_email",
    "phone_verified",
    "phone_verified_at",
    "email_verified",
    "photo_verified",
    "photo_verified_at",
    "photo_verification_expires_at",
    "proof_selfie_url",
  ]) {
    assert.match(migration, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`));
    assert.match(migration, new RegExp(`Cannot modify ${column}`));
  }

  assert.match(migration, /v_verification_writer boolean :=\s+current_setting\('vibely\.verification_server_update', true\) = '1'/);
  assert.match(migration, /current_setting\('role', true\) = 'service_role'/);
  assert.match(migration, /public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/);
  assert.doesNotMatch(migration, /current_user::regrole::text IN \('postgres', 'supabase_admin'\)/);
  assert.match(migration, /IF TG_OP = 'INSERT' THEN\s+IF NOT v_verification_writer THEN\s+RAISE EXCEPTION 'Cannot insert profiles directly';/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.profiles/);
});

test("auth bootstrap carries trusted insert context explicitly", () => {
  const bootstrapStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.bootstrap_profile_from_auth_user()");
  assert.notEqual(bootstrapStart, -1);
  const bootstrap = migration.slice(
    bootstrapStart,
    migration.indexOf("REVOKE ALL ON FUNCTION public.bootstrap_profile_from_auth_user()", bootstrapStart),
  );

  assert.match(bootstrap, /PERFORM set_config\('vibely\.verification_server_update', '1', true\);/);
  assert.match(bootstrap, /INSERT INTO public\.profiles/);
  assert.match(bootstrap, /phone_number,\s+phone_verified,\s+phone_verified_at/);
  assert.match(bootstrap, /EXCEPTION WHEN OTHERS THEN\s+PERFORM set_config\('vibely\.verification_server_update', NULL, true\);\s+RAISE;/);
  assert.match(bootstrap, /PERFORM set_config\('vibely\.verification_server_update', NULL, true\);\s+RETURN NEW;/);
});

test("routine execute grants are tightened for bootstrap and entry state", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.bootstrap_profile_from_auth_user\(\)\s+FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.resolve_entry_state\(\)\s+FROM PUBLIC, anon;/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.resolve_entry_state\(\)\s+TO authenticated, service_role;/,
  );
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);
});

test("client profile flows no longer self-insert profiles or write backend-owned verification references", () => {
  const webProfileService = read("src/services/profileService.ts");
  const webPhotoVerification = read("src/components/verification/SimplePhotoVerification.tsx");
  const nativePhotoVerification = read("apps/mobile/components/verification/PhotoVerificationFlow.tsx");

  const createProfileSection = webProfileService.slice(
    webProfileService.indexOf("export const createProfile"),
    webProfileService.indexOf("// Location auto-detect utilities"),
  );
  assert.match(createProfileSection, /\.from\("profiles"\)\s+\.update\(updateData\)/);
  assert.doesNotMatch(createProfileSection, /\.upsert\(/);
  assert.match(createProfileSection, /Profile setup is not ready/);

  for (const source of [webPhotoVerification, nativePhotoVerification]) {
    assert.match(source, /photo_verifications/);
    assert.doesNotMatch(source, /update\(\{\s*proof_selfie_url/);
    assert.doesNotMatch(source, /photo_verified\s*:\s*true/);
  }
});

test("web and native direct profile updates avoid backend-owned columns", () => {
  const files = [...walk("src"), ...walk("apps/mobile")].filter((path) =>
    !path.endsWith("src/integrations/supabase/types.ts"),
  );

  for (const file of files) {
    const source = read(file);
    for (const updateBlock of directProfileUpdateBlocks(source)) {
      for (const column of backendOwnedProfileColumns) {
        assert.doesNotMatch(
          updateBlock,
          new RegExp(`\\b${column}\\b`),
          `${file} directly updates backend-owned profiles.${column}`,
        );
      }
    }
  }
});

test("live audit harness checks the same root-cause surfaces", () => {
  const audit = read("scripts/audit-auth-live.mjs");

  for (const check of [
    "profiles_table_grants",
    "profiles_blocked_column_writes",
    "protect_sensitive_profile_columns_body",
    "routine_execute_grants",
  ]) {
    assert.match(audit, new RegExp(check));
  }

  for (const column of backendOwnedProfileColumns) {
    assert.match(audit, new RegExp(`\\('${column}'\\)`), `${column} should be included in live blocked-column audit`);
  }

  assert.match(audit, /values \('PUBLIC'\), \('anon'\), \('authenticated'\)/);
  assert.match(audit, /mentions_photo_verification_expires_at/);
  assert.match(audit, /mentions_proof_selfie_url/);
  assert.doesNotMatch(audit, /"\.env\.example"/);
  assert.match(audit, /"\.env\.cursor\.local"/);
  assert.match(audit, /Secret values and provider token digests are never printed/);
  assert.doesNotMatch(audit, /console\.log\([^)]*(RESEND_API_KEY|TWILIO_AUTH_TOKEN|SUPABASE_SERVICE_ROLE_KEY)/);
});
