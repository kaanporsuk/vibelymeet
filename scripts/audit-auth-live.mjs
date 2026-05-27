#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH_SETTINGS_TIMEOUT_MS = 15_000;
const CLI_TIMEOUT_MS = 45_000;

const PUBLIC_ENV_FILES = [
  ".env.local",
  ".env.cursor.local",
  ".env",
  "apps/mobile/.env",
];

const PUBLIC_ENV_KEYS = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PROJECT_REF",
]);

const REQUIRED_EDGE_SECRET_NAMES = [
  "APP_URL",
  "PUBLIC_SITE_URL",
  "RESEND_API_KEY",
  "EMAIL_VERIFICATION_OTP_SECRET",
  "EMAIL_VERIFICATION_FROM_EMAIL",
  "FROM_EMAIL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "TURNSTILE_SECRET_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const EXPECTED_AUTH_FUNCTION_JWT = new Map([
  ["delete-account", true],
  ["email-verification", true],
  ["phone-verify", true],
  ["verify-admin", true],
  ["cancel-deletion", true],
  ["request-account-deletion", false],
  ["send-email", false],
]);

const REQUIRED_EDGE_FUNCTIONS = [
  "delete-account",
  "email-verification",
  "phone-verify",
  "verify-admin",
  "send-email",
  "request-account-deletion",
  "cancel-deletion",
];

const SQL_AUDIT = `
with
roles(role_name) as (
  values ('PUBLIC'), ('anon'), ('authenticated')
),
blocked_columns(column_name) as (
  values
    ('phone_number'),
    ('verified_email'),
    ('phone_verified'),
    ('phone_verified_at'),
    ('email_verified'),
    ('photo_verified'),
    ('photo_verified_at'),
    ('photo_verification_expires_at'),
    ('proof_selfie_url'),
    ('is_premium'),
    ('premium_until'),
    ('premium_granted_at'),
    ('premium_granted_by'),
    ('subscription_tier'),
    ('is_suspended'),
    ('suspension_reason'),
    ('onboarding_complete'),
    ('onboarding_stage'),
    ('location'),
    ('location_data'),
    ('bunny_video_uid'),
    ('bunny_video_status'),
    ('vibe_video_status'),
    ('vibe_video_playback_ref'),
    ('vibe_video_captions'),
    ('vibe_score'),
    ('vibe_score_label'),
    ('events_attended'),
    ('total_matches'),
    ('total_conversations'),
    ('last_seen_at'),
    ('referred_by')
),
sensitive_fn as (
  select p.oid, pg_get_functiondef(p.oid) as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'protect_sensitive_profile_columns'
  limit 1
),
sanitize_name_fn as (
  select p.oid, pg_get_functiondef(p.oid) as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sanitize_profile_display_name'
  limit 1
),
bootstrap_fn as (
  select p.oid, pg_get_functiondef(p.oid) as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'bootstrap_profile_from_auth_user'
  limit 1
),
verification_writer_functions(routine_name) as (
  values
    ('mark_profile_email_verified_from_server'),
    ('mark_profile_phone_verified_from_server')
),
verification_writer_fn as (
  select p.proname as routine_name, pg_get_functiondef(p.oid) as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'mark_profile_email_verified_from_server',
      'mark_profile_phone_verified_from_server'
    )
),
verification_writer_grants as (
  select
    f.routine_name,
    coalesce(bool_or(rp.grantee = 'service_role' and rp.privilege_type = 'EXECUTE'), false) as service_role_execute,
    count(*) filter (where rp.grantee in ('PUBLIC', 'anon', 'authenticated')) as public_client_grants,
    coalesce(
      jsonb_agg(jsonb_build_object('grantee', rp.grantee, 'privilege', rp.privilege_type))
        filter (where rp.grantee is not null),
      '[]'::jsonb
    ) as grants
  from verification_writer_functions f
  left join information_schema.routine_privileges rp
    on rp.specific_schema = 'public'
    and rp.routine_name = f.routine_name
  group by f.routine_name
),
routine_grant_violations as (
  select routine_name, grantee, privilege_type
  from information_schema.routine_privileges
  where specific_schema = 'public'
    and routine_name in ('bootstrap_profile_from_auth_user', 'resolve_entry_state')
    and (
      (routine_name = 'bootstrap_profile_from_auth_user' and grantee in ('PUBLIC', 'anon', 'authenticated'))
      or (routine_name = 'resolve_entry_state' and grantee in ('PUBLIC', 'anon'))
    )
)
select
  'profiles_rls' as check_key,
  'public.profiles' as subject,
  case when coalesce(c.relrowsecurity, false) then 'pass' else 'fail' end as status,
  jsonb_build_object(
    'rls_enabled', coalesce(c.relrowsecurity, false),
    'force_rls', coalesce(c.relforcerowsecurity, false)
  )::text as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'profiles'

union all

select
  'profiles_table_grants' as check_key,
  r.role_name as subject,
  case
    when count(g.privilege_type) filter (
      where g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
    ) = 0 then 'pass'
    else 'fail'
  end as status,
  coalesce(
    jsonb_agg(distinct g.privilege_type) filter (where g.privilege_type is not null),
    '[]'::jsonb
  )::text as detail
from roles r
left join information_schema.role_table_grants g
  on g.table_schema = 'public'
  and g.table_name = 'profiles'
  and g.grantee = r.role_name
group by r.role_name

union all

select
  'profiles_blocked_column_writes' as check_key,
  r.role_name as subject,
  case
    when count(cp.column_name) filter (where cp.privilege_type in ('INSERT', 'UPDATE')) = 0 then 'pass'
    else 'fail'
  end as status,
  coalesce(
    jsonb_agg(distinct jsonb_build_object('column', cp.column_name, 'privilege', cp.privilege_type))
      filter (where cp.column_name is not null),
    '[]'::jsonb
  )::text as detail
from roles r
cross join blocked_columns b
left join information_schema.column_privileges cp
  on cp.table_schema = 'public'
  and cp.table_name = 'profiles'
  and cp.grantee = r.role_name
  and cp.column_name = b.column_name
  and cp.privilege_type in ('INSERT', 'UPDATE')
group by r.role_name

union all

select
  'protect_sensitive_profile_columns_body' as check_key,
  'public.protect_sensitive_profile_columns' as subject,
  case
    when exists (
      select 1
      from sensitive_fn
      where lower(body) like '%phone_number%'
        and lower(body) like '%verified_email%'
        and lower(body) like '%phone_verified%'
        and lower(body) like '%email_verified%'
        and lower(body) like '%photo_verified%'
        and lower(body) like '%photo_verification_expires_at%'
        and lower(body) like '%proof_selfie_url%'
    ) then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'function_exists', exists(select 1 from sensitive_fn),
    'mentions_phone_number', exists(select 1 from sensitive_fn where lower(body) like '%phone_number%'),
    'mentions_verified_email', exists(select 1 from sensitive_fn where lower(body) like '%verified_email%'),
    'mentions_photo_verified', exists(select 1 from sensitive_fn where lower(body) like '%photo_verified%'),
    'mentions_photo_verification_expires_at', exists(select 1 from sensitive_fn where lower(body) like '%photo_verification_expires_at%'),
    'mentions_proof_selfie_url', exists(select 1 from sensitive_fn where lower(body) like '%proof_selfie_url%')
  )::text as detail

union all

select
  'protect_sensitive_profile_columns_trigger' as check_key,
  'public.profiles' as subject,
  case
    when exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public'
        and c.relname = 'profiles'
        and p.proname = 'protect_sensitive_profile_columns'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ) then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'trigger_enabled', exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public'
        and c.relname = 'profiles'
        and p.proname = 'protect_sensitive_profile_columns'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ),
    'trigger_names', coalesce((
      select jsonb_agg(t.tgname order by t.tgname)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public'
        and c.relname = 'profiles'
        and p.proname = 'protect_sensitive_profile_columns'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ), '[]'::jsonb)
  )::text as detail

union all

select
  'auth_users_bootstrap_trigger' as check_key,
  'auth.users' as subject,
  case
    when exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'auth'
        and c.relname = 'users'
        and p.proname = 'bootstrap_profile_from_auth_user'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ) then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'trigger_enabled', exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'auth'
        and c.relname = 'users'
        and p.proname = 'bootstrap_profile_from_auth_user'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ),
    'trigger_names', coalesce((
      select jsonb_agg(t.tgname order by t.tgname)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'auth'
        and c.relname = 'users'
        and p.proname = 'bootstrap_profile_from_auth_user'
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ), '[]'::jsonb)
  )::text as detail

union all

select
  'routine_execute_grants' as check_key,
  'public bootstrap/entry-state routines' as subject,
  case when count(*) = 0 then 'pass' else 'fail' end as status,
  coalesce(
    jsonb_agg(jsonb_build_object('routine', routine_name, 'grantee', grantee, 'privilege', privilege_type))
      filter (where routine_name is not null),
    '[]'::jsonb
  )::text as detail
from routine_grant_violations

union all

select
  'sanitize_profile_display_name_body' as check_key,
  'public.sanitize_profile_display_name' as subject,
  case
    when exists (
      select 1
      from sanitize_name_fn
      where lower(body) like '%pg_catalog%'
        and lower(body) like '%chr(8203)%'
        and lower(body) like '%chr(65279)%'
        and lower(body) like '%[[:cntrl:]]%'
        and lower(body) like '%[[:space:]]+%'
        and lower(body) like '%left(value, 80)%'
        and lower(body) like '%btrim(left(value, 80))%'
    ) then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'function_exists', exists(select 1 from sanitize_name_fn),
    'uses_pg_catalog_search_path', exists(select 1 from sanitize_name_fn where lower(body) like '%pg_catalog%'),
    'removes_zero_width', exists(select 1 from sanitize_name_fn where lower(body) like '%chr(8203)%' and lower(body) like '%chr(65279)%'),
    'removes_control_chars', exists(select 1 from sanitize_name_fn where lower(body) like '%[[:cntrl:]]%'),
    'collapses_whitespace', exists(select 1 from sanitize_name_fn where lower(body) like '%[[:space:]]+%'),
    'caps_length', exists(select 1 from sanitize_name_fn where lower(body) like '%left(value, 80)%'),
    'trims_after_cap', exists(select 1 from sanitize_name_fn where lower(body) like '%btrim(left(value, 80))%')
  )::text as detail

union all

select
  'bootstrap_profile_display_name_sanitizer' as check_key,
  'public.bootstrap_profile_from_auth_user' as subject,
  case
    when exists (
      select 1
      from bootstrap_fn
      where lower(body) like '%sanitize_profile_display_name%'
        and lower(body) like '%raw_user_meta_data%'
        and lower(body) like '%full_name%'
        and lower(body) like '%name%'
        and lower(body) like '%display_name%'
        and lower(body) like '%vibely.verification_server_update%'
        and lower(body) like '%pg_catalog%'
    ) then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'function_exists', exists(select 1 from bootstrap_fn),
    'uses_sanitizer', exists(select 1 from bootstrap_fn where lower(body) like '%sanitize_profile_display_name%'),
    'uses_display_name_fallback', exists(select 1 from bootstrap_fn where lower(body) like '%raw_user_meta_data%' and lower(body) like '%display_name%'),
    'sets_verification_context', exists(select 1 from bootstrap_fn where lower(body) like '%vibely.verification_server_update%'),
    'uses_pg_catalog_search_path', exists(select 1 from bootstrap_fn where lower(body) like '%pg_catalog%')
  )::text as detail

union all

select
  'verification_attempts_flow_column' as check_key,
  'public.verification_attempts' as subject,
  case
    when exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'verification_attempts'
        and c.column_name = 'flow'
        and c.is_nullable = 'NO'
        and c.column_default like '%legacy%'
    )
    and exists (
      select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public'
        and rel.relname = 'verification_attempts'
        and con.conname = 'verification_attempts_flow_format'
        and pg_get_constraintdef(con.oid) like '%flow%'
    )
    then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'flow_column_exists', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'verification_attempts'
        and c.column_name = 'flow'
    ),
    'flow_not_null_default_legacy', exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'verification_attempts'
        and c.column_name = 'flow'
        and c.is_nullable = 'NO'
        and c.column_default like '%legacy%'
    ),
    'flow_check_exists', exists (
      select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public'
        and rel.relname = 'verification_attempts'
        and con.conname = 'verification_attempts_flow_format'
    )
  )::text as detail

union all

select
  'verification_attempts_flow_index' as check_key,
  'public.verification_attempts' as subject,
  case
    when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'verification_attempts'
        and indexname = 'idx_verification_attempts_user_flow_time'
        and indexdef like '%user_id%'
        and indexdef like '%flow%'
        and indexdef like '%attempt_at%'
    ) then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'index_exists', exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'verification_attempts'
        and indexname = 'idx_verification_attempts_user_flow_time'
    )
  )::text as detail

union all

select
  'verification_attempts_client_grants' as check_key,
  r.role_name as subject,
  case
    when count(g.privilege_type) filter (
      where g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
    ) = 0 then 'pass'
    else 'fail'
  end as status,
  coalesce(
    jsonb_agg(distinct g.privilege_type) filter (where g.privilege_type is not null),
    '[]'::jsonb
  )::text as detail
from roles r
left join information_schema.role_table_grants g
  on g.table_schema = 'public'
  and g.table_name = 'verification_attempts'
  and g.grantee = r.role_name
group by r.role_name

union all

select
  'verification_writer_routine_grants' as check_key,
  'public verified-contact writer routines' as subject,
  case
    when count(*) = 2
      and count(*) filter (where service_role_execute and public_client_grants = 0) = 2 then 'pass'
    else 'fail'
  end as status,
  jsonb_agg(
    jsonb_build_object(
      'routine', routine_name,
      'service_role_execute', service_role_execute,
      'public_client_grants', public_client_grants,
      'grants', grants
    )
    order by routine_name
  )::text as detail
from verification_writer_grants

union all

select
  'verification_writer_routine_bodies' as check_key,
  'public verified-contact writer routines' as subject,
  case
    when count(*) = 2
      and bool_and(lower(body) like '%vibely.verification_server_update%')
      and bool_and(lower(body) like '%server verification context required%')
      and bool_or(routine_name = 'mark_profile_email_verified_from_server' and lower(body) like '%verified_email%' and lower(body) like '%email_verified%')
      and bool_or(routine_name = 'mark_profile_phone_verified_from_server' and lower(body) like '%phone_number%' and lower(body) like '%phone_verified%' and lower(body) like '%phone_verified_at%')
      then 'pass'
    else 'fail'
  end as status,
  jsonb_build_object(
    'function_count', count(*),
    'functions', coalesce(jsonb_agg(routine_name order by routine_name), '[]'::jsonb)
  )::text as detail
from verification_writer_fn
order by check_key, subject;
`;

const results = [];

function addResult(status, check, detail = "") {
  results.push({ status, check, detail });
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "");
  }
  return { key: match[1], value };
}

function loadPublicEnv() {
  const env = new Map();
  const source = new Map();

  for (const key of PUBLIC_ENV_KEYS) {
    if (process.env[key]) {
      env.set(key, process.env[key]);
      source.set(key, "process.env");
    }
  }

  for (const relativePath of PUBLIC_ENV_FILES) {
    const fullPath = join(ROOT, relativePath);
    if (!existsSync(fullPath)) continue;
    const lines = readFileSync(fullPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed || !PUBLIC_ENV_KEYS.has(parsed.key) || env.has(parsed.key)) continue;
      env.set(parsed.key, parsed.value);
      source.set(parsed.key, relativePath);
    }
  }

  return { env, source };
}

function firstEnv(env, source, keys) {
  for (const key of keys) {
    const value = env.get(key);
    if (value) {
      return { key, value, source: source.get(key) ?? "unknown" };
    }
  }
  return null;
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).host;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return value;
}

function providerEnabled(settings, provider) {
  if (settings?.external && typeof settings.external === "object" && provider in settings.external) {
    return normalizeBoolean(settings.external[provider]);
  }
  const candidates = [
    `external_${provider}_enabled`,
    `external_${provider}`,
    `${provider}_enabled`,
  ];
  for (const key of candidates) {
    if (key in (settings ?? {})) return normalizeBoolean(settings[key]);
  }
  return undefined;
}

async function fetchAuthSettings(supabaseUrl, publicKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_SETTINGS_TIMEOUT_MS);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${publicKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function commandExists(command) {
  const check = spawnSync(command, ["--version"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
  });
  return check.status === 0;
}

function runSupabase(args) {
  return spawnSync("supabase", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function parseJsonRows(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.result)) return parsed.result;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  return [];
}

function parseSecretNames(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];
    return rows
      .map((row) => row.name ?? row.Name ?? row.key ?? row.Key)
      .filter((value) => typeof value === "string" && /^[A-Z0-9_]+$/.test(value));
  } catch {
    return Array.from(new Set(trimmed.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []));
  }
}

function parseFunctionNames(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];
    return rows
      .map((row) => row.name ?? row.slug ?? row.Name ?? row.Slug)
      .filter((value) => typeof value === "string" && value.length > 0);
  } catch {
    return Array.from(new Set(
      trimmed
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((value) => /^[a-z0-9][a-z0-9-]+$/i.test(value)),
    ));
  }
}

function parseFunctionJwtConfig() {
  const configPath = join(ROOT, "supabase", "config.toml");
  if (!existsSync(configPath)) {
    addResult("fail", "local function JWT config", "Missing supabase/config.toml");
    return new Map();
  }

  const config = new Map();
  let currentFunction = null;
  const lines = readFileSync(configPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const section = line.match(/^\s*\[functions\.([^\]]+)\]\s*$/);
    if (section) {
      currentFunction = section[1].replace(/^"|"$/g, "");
      continue;
    }
    if (!currentFunction) continue;
    const verifyJwt = line.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/);
    if (verifyJwt) {
      config.set(currentFunction, verifyJwt[1] === "true");
    }
  }
  return config;
}

function auditLocalFunctionJwtConfig() {
  const config = parseFunctionJwtConfig();
  for (const [functionName, expected] of EXPECTED_AUTH_FUNCTION_JWT.entries()) {
    if (!config.has(functionName)) {
      addResult("fail", `function JWT: ${functionName}`, `missing [functions.${functionName}] in supabase/config.toml`);
      continue;
    }
    const actual = config.get(functionName);
    addResult(
      actual === expected ? "pass" : "fail",
      `function JWT: ${functionName}`,
      `expected verify_jwt=${expected}, actual verify_jwt=${actual}`,
    );
  }
}

function auditSqlWithSupabaseCli() {
  if (!commandExists("supabase")) {
    addResult("warn", "live SQL audit", "Supabase CLI not found; skipped optional linked SQL checks.");
    return;
  }

  const query = runSupabase(["db", "query", "--linked", "--output", "json", SQL_AUDIT]);
  if (query.status !== 0) {
    addResult(
      "warn",
      "live SQL audit",
      "Supabase CLI SQL query was unavailable; skipped profile grant, trigger, RLS, and routine grant checks.",
    );
    return;
  }

  let rows;
  try {
    rows = parseJsonRows(query.stdout);
  } catch {
    addResult("warn", "live SQL audit", "Could not parse Supabase CLI SQL JSON output.");
    return;
  }

  if (rows.length === 0) {
    addResult("warn", "live SQL audit", "Supabase CLI SQL returned no rows.");
    return;
  }

  for (const row of rows) {
    const status = row.status === "pass" ? "pass" : row.status === "fail" ? "fail" : "warn";
    addResult(status, `SQL: ${row.check_key} (${row.subject})`, row.detail ?? "");
  }
}

function auditSupabaseFunctionList(projectRef) {
  if (!commandExists("supabase")) {
    addResult("warn", "Edge function list", "Supabase CLI not found; skipped remote function list.");
    return;
  }
  if (!projectRef) {
    addResult("warn", "Edge function list", "Project ref unavailable; skipped remote function list.");
    return;
  }

  const list = runSupabase(["functions", "list", "--project-ref", projectRef, "--output", "json"]);
  if (list.status !== 0) {
    addResult("warn", "Edge function list", "Supabase CLI could not list remote functions.");
    return;
  }

  const names = new Set(parseFunctionNames(list.stdout));
  const missing = REQUIRED_EDGE_FUNCTIONS.filter((name) => !names.has(name));
  addResult(
    missing.length === 0 ? "pass" : "fail",
    "Edge function presence",
    missing.length === 0
      ? `found required auth functions: ${REQUIRED_EDGE_FUNCTIONS.join(", ")}`
      : `missing required auth functions: ${missing.join(", ")}`,
  );
}

function auditSupabaseSecretNames(projectRef) {
  if (!commandExists("supabase")) {
    addResult("warn", "Edge secret names", "Supabase CLI not found; skipped remote secret-name check.");
    return;
  }
  if (!projectRef) {
    addResult("warn", "Edge secret names", "Project ref unavailable; skipped remote secret-name check.");
    return;
  }

  const list = runSupabase(["secrets", "list", "--project-ref", projectRef, "--output", "json"]);
  if (list.status !== 0) {
    addResult("warn", "Edge secret names", "Supabase CLI could not list remote secret names.");
    return;
  }

  const names = new Set(parseSecretNames(list.stdout));
  const missing = REQUIRED_EDGE_SECRET_NAMES.filter((name) => !names.has(name));
  addResult(
    missing.length === 0 ? "pass" : "fail",
    "Edge secret names",
    missing.length === 0
      ? `all required secret names are present (${REQUIRED_EDGE_SECRET_NAMES.length} checked)`
      : `missing required secret names: ${missing.join(", ")}`,
  );
}

async function auditAuthSettings(supabaseUrl, publicKey) {
  let settings;
  try {
    settings = await fetchAuthSettings(supabaseUrl, publicKey);
  } catch (error) {
    addResult("fail", "Supabase Auth settings", `could not fetch /auth/v1/settings: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const checks = [
    ["disable_signup", settings.disable_signup, false],
    ["mailer_autoconfirm", settings.mailer_autoconfirm, false],
    ["phone_autoconfirm", settings.phone_autoconfirm, false],
    ["sms_provider", settings.sms_provider, "twilio_verify"],
    ["external.email", providerEnabled(settings, "email"), true],
    ["external.phone", providerEnabled(settings, "phone"), true],
    ["external.google", providerEnabled(settings, "google"), true],
    ["external.apple", providerEnabled(settings, "apple"), true],
  ];

  for (const [key, rawActual, expected] of checks) {
    const actual = normalizeBoolean(rawActual);
    addResult(
      actual === expected ? "pass" : "fail",
      `Auth settings: ${key}`,
      `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`,
    );
  }
}

function printResults() {
  const icon = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
    info: "INFO",
  };

  console.log("Vibely live auth audit");
  console.log("Read-only. Secret values and provider token digests are never printed.");
  console.log("");

  for (const result of results) {
    const detail = result.detail ? ` - ${result.detail}` : "";
    console.log(`${icon[result.status] ?? "INFO"} ${result.check}${detail}`);
  }

  const failCount = results.filter((result) => result.status === "fail").length;
  const warnCount = results.filter((result) => result.status === "warn").length;
  console.log("");
  console.log(`Summary: ${failCount} fail, ${warnCount} warn, ${results.length} checks`);
  if (failCount > 0) {
    console.log("Audit failed. Review FAIL lines before release.");
  }
  process.exitCode = failCount > 0 ? 1 : 0;
}

async function main() {
  const { env, source } = loadPublicEnv();
  const url = firstEnv(env, source, [
    "VITE_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
    "SUPABASE_URL",
  ]);
  const key = firstEnv(env, source, [
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ]);

  if (!url?.value) {
    addResult("fail", "public Supabase URL", "missing VITE_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL");
  } else {
    addResult("pass", "public Supabase URL", `found via ${url.key} (${url.source})`);
  }

  if (!key?.value) {
    addResult("fail", "public Supabase key", "missing publishable/anon public key");
  } else {
    addResult("pass", "public Supabase key", `found via ${key.key} (${key.source}); value redacted`);
  }

  const projectRef = env.get("SUPABASE_PROJECT_REF") || (url?.value ? projectRefFromUrl(url.value) : null);
  if (projectRef) {
    addResult("pass", "Supabase project ref", projectRef);
  } else {
    addResult("warn", "Supabase project ref", "could not derive project ref from public URL");
  }

  if (url?.value && key?.value) {
    await auditAuthSettings(url.value, key.value);
  }

  auditLocalFunctionJwtConfig();
  auditSqlWithSupabaseCli();
  auditSupabaseFunctionList(projectRef);
  auditSupabaseSecretNames(projectRef);
  printResults();
}

main().catch((error) => {
  console.error("Unexpected audit failure:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
