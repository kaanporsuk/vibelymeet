import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migrationPath = "supabase/migrations/20260517123000_profile_direct_select_self_only.sql";
const ownerRpcArityFixMigrationPath = "supabase/migrations/20260517170000_fix_get_my_profile_settings_jsonb_arity.sql";
const validationPath = "supabase/validation/profile_direct_select_privacy.sql";
const migration = read(migrationPath);
const ownerRpcArityFixMigration = read(ownerRpcArityFixMigrationPath);
const validation = read(validationPath);

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

function profileSelectBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /\.from\(['"]profiles['"]\)\s*\.select\(([\s\S]*?)\)/g;
  for (const match of source.matchAll(pattern)) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

function jsonbBuildObjectBodies(source: string): string[] {
  const bodies: string[] = [];
  const needle = "jsonb_build_object(";
  let searchIndex = 0;

  while (true) {
    const start = source.indexOf(needle, searchIndex);
    if (start === -1) return bodies;

    let depth = 1;
    let index = start + needle.length;
    const bodyStart = index;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      index += 1;
    }

    bodies.push(source.slice(bodyStart, index - 1));
    searchIndex = index;
  }
}

function objectKeysFromJsonbBuildObjects(source: string): string[] {
  return jsonbBuildObjectBodies(source).flatMap((body) =>
    Array.from(body.matchAll(/'([a-z0-9_]+)'/g), (match) => match[1]),
  );
}

test("profile privacy migration makes direct non-admin profile reads self-only", () => {
  for (const policyName of [
    "Anyone can view profiles",
    "Authenticated users can view profiles",
    "Require authentication for profiles",
    "Users can view matched profiles",
    "Users can view event participant profiles",
    "Users can view potential matches for Daily Drop",
  ]) {
    assert.match(migration, new RegExp(`DROP POLICY IF EXISTS "${policyName}" ON public\\.profiles;`));
  }

  assert.match(migration, /CREATE POLICY "Users can view own profile"[\s\S]*USING \(auth\.uid\(\) = id\)/);
  assert.doesNotMatch(migration, /auth\.uid\(\) IS NOT NULL/);
  assert.match(migration, /COMMENT ON FUNCTION public\.get_profile_for_viewer\(uuid\)[\s\S]*Direct public\.profiles reads are self-only/);
});

test("profile column grants revoke PII/backend fields while preserving safe owner columns and service role", () => {
  assert.match(migration, /REVOKE SELECT ON TABLE public\.profiles FROM anon, authenticated;/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.profiles TO service_role;/);
  assert.doesNotMatch(migration, /GRANT SELECT \([\s\S]*\) ON TABLE public\.profiles TO anon/);

  const forbiddenDirectColumns = [
    "birth_date",
    "location_data",
    "phone_number",
    "verified_email",
    "photo_verification_expires_at",
    "proof_selfie_url",
    "referred_by",
    "premium_until",
    "premium_granted_at",
    "premium_granted_by",
    "is_suspended",
    "suspension_reason",
    "last_seen_at",
    "phone_verified_at",
    "photo_verified_at",
    "community_agreed_at",
    "email_unsubscribed",
  ];

  const grantStart = migration.indexOf("-- Safe direct owner projection.");
  assert.notEqual(grantStart, -1);
  const grantBodyStart = migration.indexOf("GRANT SELECT (", grantStart);
  const safeGrant = migration.slice(grantBodyStart, migration.indexOf("CREATE OR REPLACE FUNCTION public.get_my_profile_settings"));

  for (const column of forbiddenDirectColumns) {
    assert.match(migration, new RegExp(`\\b${column}\\b`), `${column} should be explicitly handled`);
    assert.doesNotMatch(safeGrant, new RegExp(`\\b${column}\\b`), `${column} must not be directly granted`);
  }

  for (const safeColumn of ["id", "name", "photos", "phone_verified", "event_discovery_prefs", "account_paused"]) {
    assert.match(safeGrant, new RegExp(`\\b${safeColumn}\\b`));
  }
});

test("owner profile settings RPC is security-definer, self-scoped, and not executable by anon", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_profile_settings\(\)/);
  assert.match(migration, /RETURNS jsonb/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/);
  assert.match(migration, /WHERE p\.id = v_uid/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_my_profile_settings\(\) FROM PUBLIC;/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_my_profile_settings\(\) FROM anon;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_profile_settings\(\) TO authenticated, service_role;/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);
});

test("owner profile settings RPC arity fix chunks the same owner JSON contract", () => {
  assert.match(ownerRpcArityFixMigration, /CREATE OR REPLACE FUNCTION public\.get_my_profile_settings\(\)/);
  assert.match(ownerRpcArityFixMigration, /RETURNS jsonb/);
  assert.match(ownerRpcArityFixMigration, /SECURITY DEFINER/);
  assert.match(ownerRpcArityFixMigration, /v_uid uuid := auth\.uid\(\)/);
  assert.match(ownerRpcArityFixMigration, /WHERE p\.id = v_uid/);
  assert.match(ownerRpcArityFixMigration, /\|\|\s+jsonb_build_object/);
  assert.match(ownerRpcArityFixMigration, /REVOKE ALL ON FUNCTION public\.get_my_profile_settings\(\) FROM PUBLIC;/);
  assert.match(ownerRpcArityFixMigration, /REVOKE ALL ON FUNCTION public\.get_my_profile_settings\(\) FROM anon;/);
  assert.match(ownerRpcArityFixMigration, /GRANT EXECUTE ON FUNCTION public\.get_my_profile_settings\(\) TO authenticated, service_role;/);
  assert.match(ownerRpcArityFixMigration, /NOTIFY pgrst, 'reload schema';/);

  const originalOwnerRpc = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.get_my_profile_settings()"),
    migration.indexOf("COMMENT ON FUNCTION public.get_my_profile_settings()"),
  );
  const fixedOwnerRpc = ownerRpcArityFixMigration.slice(
    ownerRpcArityFixMigration.indexOf("CREATE OR REPLACE FUNCTION public.get_my_profile_settings()"),
    ownerRpcArityFixMigration.indexOf("COMMENT ON FUNCTION public.get_my_profile_settings()"),
  );
  const fixedBodies = jsonbBuildObjectBodies(fixedOwnerRpc);

  assert.equal(fixedBodies.length, 3);
  assert.deepEqual(objectKeysFromJsonbBuildObjects(fixedOwnerRpc), objectKeysFromJsonbBuildObjects(originalOwnerRpc));

  for (const body of fixedBodies) {
    const keyCount = Array.from(body.matchAll(/'([a-z0-9_]+)'/g)).length;
    assert.ok(keyCount < 50, `jsonb_build_object chunk has ${keyCount} key/value pairs`);
  }
});

test("canonical other-user RPC remains the only display profile bypass and excludes private fields", () => {
  const rpcMigration = migration;
  const functionStart = rpcMigration.indexOf("CREATE OR REPLACE FUNCTION public.get_profile_for_viewer");
  const selectBlock = rpcMigration.slice(
    rpcMigration.indexOf("SELECT\n    p.id", functionStart),
    rpcMigration.indexOf("INTO v_profile", functionStart),
  );
  const returnBlock = rpcMigration.slice(
    rpcMigration.indexOf("RETURN jsonb_build_object", functionStart),
    rpcMigration.indexOf(");\nEND;", rpcMigration.indexOf("RETURN jsonb_build_object", functionStart)),
  );

  assert.match(rpcMigration, /CREATE OR REPLACE FUNCTION public\.get_profile_for_viewer\(p_target_id uuid\)/);
  assert.match(rpcMigration, /profile_has_established_access/);
  assert.match(rpcMigration, /profiles_have_safety_block/);
  assert.match(rpcMigration, /GRANT EXECUTE ON FUNCTION public\.get_profile_for_viewer\(uuid\) TO authenticated, service_role;/);
  assert.match(rpcMigration, /REVOKE ALL ON FUNCTION public\.get_profile_for_viewer\(uuid\) FROM anon;/);
  assert.match(selectBlock, /p\.subscription_tier/);
  assert.match(returnBlock, /'subscription_tier', v_profile\.subscription_tier/);

  for (const privateField of ["phone_number", "verified_email", "proof_selfie_url", "location_data", "'birth_date'"]) {
    assert.doesNotMatch(returnBlock, new RegExp(privateField));
  }
});

test("batch canonical profile RPC preserves list UX without broad table reads", () => {
  const webFetcher = read("src/services/fetchUserProfile.ts");
  const nativeFetcher = read("apps/mobile/lib/fetchUserProfile.ts");

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_profiles_for_viewer\(p_target_ids uuid\[\]\)/);
  assert.match(migration, /public\.get_profile_for_viewer\(ids\.target_id\)/);
  assert.match(migration, /v_count > 100/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_profiles_for_viewer\(uuid\[\]\) FROM anon;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_profiles_for_viewer\(uuid\[\]\) TO authenticated, service_role;/);

  for (const source of [webFetcher, nativeFetcher]) {
    assert.match(source, /fetchUserProfiles/);
    assert.match(source, /get_profiles_for_viewer/);
    assert.match(source, /PROFILE_BATCH_SIZE = 100/);
    assert.match(source, /PROFILE_BATCH_FALLBACK_CONCURRENCY = 8/);
    assert.match(source, /fetchUserProfilesChunk/);
    assert.match(source, /isMissingBatchProfileRpcError/);
    assert.match(source, /fetchUserProfilesMissingBatchFallback/);
    assert.match(source, /Promise\.all\(slice\.map\(\(id\) => fetchUserProfile\(id\)\)\)/);
  }

  for (const listSurface of [
    "src/hooks/useMatches.ts",
    "apps/mobile/lib/chatApi.ts",
    "src/hooks/useScheduleHub.ts",
    "apps/mobile/lib/useScheduleHub.ts",
    "src/components/safety/ReportWizard.tsx",
  ]) {
    assert.match(read(listSurface), /fetchUserProfiles/, `${listSurface} should batch canonical profile reads`);
  }
});

test("event deck, Ready Gate, and Video Date keep safe profile access after direct profile privacy hardening", () => {
  const establishedAccessMigration = read("supabase/migrations/20260430190000_enforce_discovery_audience_in_discovery_surfaces.sql");
  const latestEventDeckMigration = read("supabase/migrations/20260507190000_tier_config_backend_authority.sql");
  const webEventDeck = read("src/hooks/useEventDeck.ts");
  const webLobby = read("src/pages/EventLobby.tsx");
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const webVideoDate = read("src/pages/VideoDate.tsx");
  const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
  const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
  const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");

  assert.match(latestEventDeckMigration, /CREATE OR REPLACE FUNCTION public\.get_event_deck/);
  assert.match(latestEventDeckMigration, /SECURITY DEFINER/);
  assert.match(latestEventDeckMigration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\) TO authenticated, service_role;/);
  assert.match(latestEventDeckMigration, /JOIN public\.profiles p ON p\.id = deck\.profile_id/);
  assert.match(webEventDeck, /supabase\.rpc\("get_event_deck"/);
  assert.doesNotMatch(webEventDeck, /\.from\(["']profiles["']\)/);
  assert.match(nativeEventsApi, /rpc\('get_event_deck'/);

  const establishedAccessFunction = establishedAccessMigration.slice(
    establishedAccessMigration.indexOf("CREATE OR REPLACE FUNCTION public.profile_has_established_access"),
    establishedAccessMigration.indexOf("CREATE OR REPLACE FUNCTION public.viewer_shares_event_with_profile"),
  );
  assert.match(establishedAccessFunction, /FROM public\.video_sessions vs/);
  assert.match(establishedAccessFunction, /vs\.ended_at IS NULL/);
  assert.match(establishedAccessFunction, /vs\.ended_at >= now\(\) - interval '14 days'/);
  assert.match(establishedAccessFunction, /vs\.participant_1_id = p_viewer_id AND vs\.participant_2_id = p_target_id/);
  assert.match(establishedAccessFunction, /vs\.participant_2_id = p_viewer_id AND vs\.participant_1_id = p_target_id/);

  assert.match(webReadyGate, /get_profile_for_viewer/);
  assert.match(webVideoDate, /setVideoDateAccess\("allowed"\);[\s\S]*get_profile_for_viewer/);
  assert.match(nativeLobby, /get_profile_for_viewer/);
  assert.match(nativeVideoDateApi, /get_profile_for_viewer/);
  assert.doesNotMatch(webLobby, /\.from\(["']profiles["']\)\s*\.select\(/);
  assert.doesNotMatch(nativeLobby, /\.from\(['"]profiles['"]\)\s*\.select\(/);
});

test("admin dashboard attendee roster is isolated from direct browser profile embeds", () => {
  const attendeesModal = read("src/components/admin/AdminEventAttendeesModal.tsx");
  const pushTelemetry = read("src/hooks/usePushNotificationEvents.ts");

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_list_event_attendees\(/);
  assert.match(migration, /IF NOT public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(migration, /LEFT JOIN public\.profiles p ON p\.id = er\.profile_id/);
  assert.match(migration, /'profiles', CASE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_list_event_attendees\(uuid, text\) FROM anon;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_list_event_attendees\(uuid, text\) TO authenticated, service_role;/);

  assert.match(attendeesModal, /callAdminRpc<AdminEventAttendeesPayload>\("admin_list_event_attendees"/);
  assert.doesNotMatch(attendeesModal, /\.from\(['"]event_registrations['"]\)/);
  assert.doesNotMatch(attendeesModal, /profiles:profile_id/);

  assert.match(pushTelemetry, /fetchUserProfiles\(userIds\)/);
  assert.doesNotMatch(pushTelemetry, /\.from\(["']profiles["']\)/);
});

test("web chat preserves partner tier badges through the canonical profile RPC", () => {
  const fetcher = read("src/services/fetchUserProfile.ts");
  const chatHook = read("src/hooks/useMessages.ts");

  assert.match(fetcher, /subscription_tier: string \| null/);
  assert.match(fetcher, /row\.subscription_tier/);
  assert.match(chatHook, /subscription_tier: otherUserRes\.subscription_tier/);
  assert.doesNotMatch(chatHook, /subscription_tier: null/);
});

test("client direct profile selects do not request revoked private/backend columns", () => {
  const forbidden = [
    "birth_date",
    "location_data",
    "phone_number",
    "verified_email",
    "photo_verification_expires_at",
    "proof_selfie_url",
    "referred_by",
    "premium_until",
    "premium_granted_at",
    "premium_granted_by",
    "is_suspended",
    "suspension_reason",
    "last_seen_at",
    "phone_verified_at",
    "photo_verified_at",
    "community_agreed_at",
    "email_unsubscribed",
  ];
  const files = [...walk("src"), ...walk("apps/mobile")].filter((path) => !path.endsWith("src/integrations/supabase/types.ts"));

  for (const file of files) {
    const source = read(file);
    for (const selectBlock of profileSelectBlocks(source)) {
      for (const column of forbidden) {
        assert.doesNotMatch(selectBlock, new RegExp(`\\b${column}\\b`), `${file} directly selects ${column}`);
      }
    }
  }
});

test("known other-user profile surfaces use safe RPC helpers instead of direct profiles selects", () => {
  const surfaces = [
    "src/hooks/useMatches.ts",
    "src/hooks/useMessages.ts",
    "src/hooks/useScheduleHub.ts",
    "src/hooks/useMatchCall.tsx",
    "src/components/safety/ReportWizard.tsx",
    "apps/mobile/lib/chatApi.ts",
    "apps/mobile/lib/useScheduleHub.ts",
    "apps/mobile/lib/useMatchCall.tsx",
  ];

  for (const file of surfaces) {
    const source = read(file);
    assert.doesNotMatch(source, /\.from\(['"]profiles['"]\)\s*\.select\(/, `${file} should not directly select profiles`);
    assert.match(source, /fetchUserProfile|get_profile_for_viewer/, `${file} should use the safe profile read surface`);
  }
});

test("validation pack covers requested role matrix and direct-table-vs-rpc delta", () => {
  for (const label of [
    "anon",
    "authenticated self",
    "authenticated other user",
    "blocked / not eligible other user",
    "admin",
    "service_role",
    "direct table API vs get_profile_for_viewer",
    "list surfaces",
    "anon_direct_profiles_table_select_denied",
    "authenticated_direct_safe_owner_columns_allowed",
    "authenticated_private_profile_columns_revoked",
    "profiles_self_select_policy_only_for_non_admin",
    "admin_profile_policy_preserved",
    "service_role_direct_profile_select_preserved",
    "get_my_profile_settings_owner_rpc_acl",
    "get_my_profile_settings_owner_rpc_runtime_payload",
    "get_profile_for_viewer_canonical_rpc_acl",
    "get_profiles_for_viewer_batch_rpc_acl",
  ]) {
    assert.match(validation, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(validation, /when not exists \(select 1 from candidate\) then true/);
  assert.match(validation, /jsonb_typeof\(body\) = 'object'/);
  assert.match(validation, /payload_keys as \([\s\S]*jsonb_object_keys\(body\)[\s\S]*where jsonb_typeof\(body\) = 'object'[\s\S]*\)/);
  assert.match(validation, /coalesce\([\s\S]*from payload[\s\S]*false[\s\S]*\)/);
});
