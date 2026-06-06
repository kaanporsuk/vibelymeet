import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function walkFiles(dir: string, predicate: (path: string) => boolean, files: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    if (["node_modules", ".expo", "ios", "android", "dist", "build"].includes(entry)) continue;

    const relative = join(dir, entry);
    const absolute = join(root, relative);
    const stat = statSync(absolute);

    if (stat.isDirectory()) {
      walkFiles(relative, predicate, files);
      continue;
    }

    if (predicate(relative)) files.push(relative);
  }

  return files;
}

const migration = read("supabase/migrations/20260606164737_event_registration_rpc_owned_dml_lockdown.sql");
const validation = read("supabase/validation/event_registration_rpc_owned_dml_lockdown.sql");
const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const runtimeEnvGuard = read("scripts/require-event-lobby-runtime-rls-env.mjs");
const runtimeRlsTest = read("shared/matching/eventLobbyDirectWriteRlsRuntime.test.ts");
const eventLobbyRegressionRunner = read("scripts/run_event_lobby_regression.sh");
const clientFiles = [
  ...walkFiles("src", (path) => /\.(?:ts|tsx|js|jsx)$/.test(path)),
  ...walkFiles("apps/mobile", (path) => /\.(?:ts|tsx|js|jsx)$/.test(path)),
];

test("event_registrations authenticated DML is locked to RPC and service-role paths", () => {
  for (const policyName of [
    "Users can register for events",
    "Users cannot insert event_registrations directly",
    "Users can update own queue status",
    "Users can unregister from events",
    "Admins can delete event registrations",
  ]) {
    assert.match(
      migration,
      new RegExp(`DROP POLICY IF EXISTS "${policyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]+ON public\\.event_registrations`),
      `${policyName} should be dropped`,
    );
  }

  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+ON TABLE public\.event_registrations[\s\S]+FROM PUBLIC, anon, authenticated/,
  );
  assert.match(migration, /GRANT SELECT ON TABLE public\.event_registrations TO authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.event_registrations TO service_role/);
  assert.doesNotMatch(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.event_registrations TO authenticated/);
});

test("event registration RPC execute grants remain available to authenticated clients", () => {
  for (const fn of ["update_participant_status", "register_for_event", "cancel_event_registration"]) {
    assert.match(migration, new RegExp(`COMMENT ON FUNCTION public\\.${fn}\\(`));
  }

  assert.match(validation, /event_registration_rpc_execute_preserved/);
  assert.match(validation, /has_function_privilege\('authenticated', 'public\.register_for_event\(uuid\)', 'EXECUTE'\)/);
  assert.match(validation, /has_function_privilege\('authenticated', 'public\.cancel_event_registration\(uuid\)', 'EXECUTE'\)/);
  assert.match(validation, /has_function_privilege\('authenticated', 'public\.update_participant_status\(uuid,text\)', 'EXECUTE'\)/);
});

test("live validation pack proves final Event Lobby authority table posture", () => {
  for (const check of [
    "event_registrations_auth_select_only",
    "event_registrations_no_direct_dml_policies",
    "event_swipes_auth_select_only",
    "video_sessions_auth_select_only",
    "event_deck_card_reservations_service_only",
    "event_impression_tables_auth_own_select_only",
  ]) {
    assert.match(validation, new RegExp(check));
  }

  assert.match(validation, /not has_table_privilege\('authenticated', 'public\.event_registrations', 'INSERT'\)/);
  assert.match(validation, /not has_table_privilege\('authenticated', 'public\.event_registrations', 'UPDATE'\)/);
  assert.match(validation, /not has_table_privilege\('authenticated', 'public\.event_registrations', 'DELETE'\)/);
});

test("web, mobile web, and native clients do not directly mutate event_registrations", () => {
  const fromPattern = /\.from\(\s*['"]event_registrations['"]\s*\)/g;
  const mutationPattern = /\.(?:insert|update|upsert|delete)\s*\(/m;

  for (const path of clientFiles) {
    const source = read(path);
    for (const match of source.matchAll(fromPattern)) {
      const chainStart = match.index ?? 0;
      const chainEnd = source.indexOf(";", chainStart);
      const chain = source.slice(chainStart, chainEnd === -1 ? chainStart + 1200 : chainEnd);
      assert.doesNotMatch(chain, mutationPattern, `${path} must use registration/status RPCs instead of direct table DML`);
    }
  }
});

test("runtime RLS direct-write proof is required-mode addressable", () => {
  const command = packageJson.scripts["test:event-lobby-runtime-rls:required"];
  assert.ok(command, "required Event Lobby runtime RLS script should exist");
  assert.match(command, /require-event-lobby-runtime-rls-env\.mjs/);
  assert.match(command, /eventLobbyDirectWriteRlsRuntime\.test\.ts/);

  for (const envName of [
    "EVENT_LOBBY_RLS_SUPABASE_URL",
    "EVENT_LOBBY_RLS_SUPABASE_ANON_KEY",
    "EVENT_LOBBY_RLS_EVENT_ID",
    "EVENT_LOBBY_RLS_USER_ID",
    "EVENT_LOBBY_RLS_PARTICIPANT_JWT",
  ]) {
    assert.match(runtimeEnvGuard, new RegExp(envName));
    assert.match(runtimeRlsTest, new RegExp(envName));
  }

  for (const table of [
    "event_registrations",
    "event_swipes",
    "video_sessions",
    "event_deck_card_reservations",
    "event_profile_impressions",
    "event_profile_impression_events",
  ]) {
    assert.match(runtimeRlsTest, new RegExp(`from\\("${table}"\\)|from\\('${table}'\\)`));
  }
});

test("Event Lobby regression harness runs registration RLS authority contracts", () => {
  assert.match(eventLobbyRegressionRunner, /eventRegistrationRlsAuthority\.test\.ts/);
});
