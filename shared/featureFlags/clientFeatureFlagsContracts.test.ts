import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearClientFeatureFlagCache as clearRuntimeClientFeatureFlagCache,
  evaluateClientFeatureFlag as evaluateRuntimeClientFeatureFlag,
  getCachedClientFeatureFlag as getRuntimeCachedClientFeatureFlag,
  prefetchClientFeatureFlags as prefetchRuntimeClientFeatureFlags,
  type ClientFeatureFlagKey,
} from "./clientFeatureFlagCore";

const baseMigration = readFileSync("supabase/migrations/20260519120000_client_feature_flags.sql", "utf8");
const hardeningMigration = readFileSync("supabase/migrations/20260520120000_client_feature_flags_hardening.sql", "utf8");
const videoDatePhase0Migration = readFileSync("supabase/migrations/20260521161000_video_date_phase0_observability_flags.sql", "utf8");
const videoDatePhase5AuditMigration = readFileSync("supabase/migrations/20260522013000_video_date_phase5_audit_hardening.sql", "utf8");
const videoDateInstantPremiumMigration = readFileSync(
  "supabase/migrations/20260522193000_video_date_instant_premium_v2_flags_batched_broadcast.sql",
  "utf8",
);
const migration = `${baseMigration}\n${hardeningMigration}\n${videoDatePhase0Migration}\n${videoDatePhase5AuditMigration}\n${videoDateInstantPremiumMigration}`;
const videoDateFlagSeedMigration = `${videoDatePhase0Migration}\n${videoDatePhase5AuditMigration}\n${videoDateInstantPremiumMigration}`;
const core = readFileSync("shared/featureFlags/clientFeatureFlagCore.ts", "utf8");
const videoDateFlags = readFileSync("shared/featureFlags/videoDateV4Flags.ts", "utf8");
const webHook = readFileSync("src/hooks/useFeatureFlag.ts", "utf8");
const nativeHook = readFileSync("apps/mobile/hooks/useFeatureFlag.ts", "utf8");
const webLib = readFileSync("src/lib/clientFeatureFlags.ts", "utf8");
const nativeLib = readFileSync("apps/mobile/lib/clientFeatureFlags.ts", "utf8");
const webAuth = readFileSync("src/contexts/AuthContext.tsx", "utf8");
const nativeAuth = readFileSync("apps/mobile/context/AuthContext.tsx", "utf8");
const webStorageUploads = readFileSync("src/lib/mediaSdk/webStorageUploads.ts", "utf8");
const webVideoUploads = readFileSync("src/lib/mediaSdk/webVideoUploads.ts", "utf8");
const nativeStorageUploads = readFileSync("apps/mobile/lib/mediaSdk/nativeStorageUploads.ts", "utf8");
const nativeVideoUploads = readFileSync("apps/mobile/lib/mediaSdk/nativeVideoUploads.ts", "utf8");

function assertBefore(text: string, earlier: string, later: string) {
  const first = text.indexOf(earlier);
  const second = text.indexOf(later);
  assert.notEqual(first, -1, `${earlier} not found`);
  assert.notEqual(second, -1, `${later} not found`);
  assert.ok(first < second, `${earlier} should appear before ${later}`);
}

function bucket(flag: string, userId: string): number {
  const bytes = createHash("md5").update(`${flag}:${userId}`).digest();
  return ((bytes[0] * 16_777_216 + bytes[1] * 65_536 + bytes[2] * 256 + bytes[3]) >>> 0) % 10_000;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function evaluationRow(
  flag: ClientFeatureFlagKey,
  enabled: boolean,
  source: "kill_switched" | "rollout",
) {
  return {
    flag,
    enabled,
    source,
    bucket: enabled ? 1 : null,
    rollout_bps: enabled ? 10000 : 0,
    user_id_bucket: "bucket-fixture",
  };
}

test("client feature flag schema is additive, default-off, RPC-gated, and hard-kill capable", () => {
  assert.match(baseMigration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flags/);
  assert.match(baseMigration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flag_user_overrides/);
  assert.match(baseMigration, /rollout_bps integer NOT NULL DEFAULT 0 CHECK \(rollout_bps BETWEEN 0 AND 10000\)/);
  assert.match(hardeningMigration, /ADD COLUMN IF NOT EXISTS kill_switch_active boolean NOT NULL DEFAULT false/);
  assert.match(hardeningMigration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flag_history/);
  assert.match(hardeningMigration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flag_override_history/);
  assert.match(hardeningMigration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flag_service_evals/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(hardeningMigration, /REVOKE ALL ON public\.client_feature_flags FROM PUBLIC, anon, authenticated/);
  assert.match(hardeningMigration, /REVOKE ALL ON public\.client_feature_flag_user_overrides FROM PUBLIC, anon, authenticated/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION public\.evaluate_client_feature_flag_detail\(text, uuid\) TO authenticated, service_role/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION public\.evaluate_client_feature_flags\(text\[\], uuid\) TO authenticated, service_role/);
  assert.match(hardeningMigration, /GRANT EXECUTE ON FUNCTION public\.evaluate_client_feature_flag\(text, uuid\) TO authenticated, service_role/);
});

test("client feature flag evaluation hard-kills before overrides and keeps boolean wrapper compatibility", () => {
  const detailStart = hardeningMigration.indexOf("CREATE OR REPLACE FUNCTION public.evaluate_client_feature_flag_detail");
  const detailEnd = hardeningMigration.indexOf("CREATE OR REPLACE FUNCTION public.evaluate_client_feature_flag(", detailStart);
  const detailFn = hardeningMigration.slice(detailStart, detailEnd);

  assert.match(detailFn, /auth\.role\(\) <> 'service_role' AND auth\.uid\(\) IS DISTINCT FROM v_user/);
  assertBefore(detailFn, "IF NOT FOUND THEN", "ELSIF v_flag.kill_switch_active THEN");
  assertBefore(detailFn, "ELSIF v_flag.kill_switch_active THEN", "ELSIF NOT v_flag.enabled THEN");
  assertBefore(detailFn, "ELSIF NOT v_flag.enabled THEN", "SELECT o.enabled");
  assertBefore(detailFn, "SELECT o.enabled", "ELSIF v_flag.rollout_bps >= 10000 THEN");
  assert.match(detailFn, /v_source := 'kill_switched'/);
  assert.match(detailFn, /v_source := 'disabled'/);
  assert.match(detailFn, /v_source := 'override'/);
  assert.match(detailFn, /v_enabled := v_bucket < v_flag\.rollout_bps/);
  assert.match(hardeningMigration, /evaluate_client_feature_flag_detail\(p_flag, p_user\) ->> 'enabled'/);
});

test("detail, batch, debug, admin, history, service audit, and ACL contracts are present", () => {
  for (const fn of [
    "evaluate_client_feature_flag_detail",
    "evaluate_client_feature_flags",
    "evaluate_all_client_feature_flags",
    "admin_list_client_feature_flags",
    "admin_update_client_feature_flag",
    "admin_list_client_feature_flag_overrides",
    "admin_upsert_client_feature_flag_override",
    "admin_delete_client_feature_flag_override",
  ]) {
    assert.match(hardeningMigration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
  }
  assert.match(hardeningMigration, /jsonb_build_object\([\s\S]*'flag'[\s\S]*'enabled'[\s\S]*'source'[\s\S]*'bucket'[\s\S]*'rollout_bps'[\s\S]*'user_id_bucket'/);
  assert.match(hardeningMigration, /SELECT COALESCE\(jsonb_agg\(public\.evaluate_client_feature_flag_detail\(flag_key, p_user\)\)/);
  assert.match(hardeningMigration, /RETURN public\.evaluate_client_feature_flags\(v_flags, p_user\)/);
  assert.match(hardeningMigration, /client_feature_flags_history[\s\S]+EXECUTE FUNCTION public\.client_feature_flag_state_history_trigger/);
  assert.match(hardeningMigration, /client_feature_flag_user_overrides_history[\s\S]+EXECUTE FUNCTION public\.client_feature_flag_override_history_trigger/);
  assert.match(hardeningMigration, /INSERT INTO public\.client_feature_flag_service_evals/);
  assert.match(hardeningMigration, /auth\.role\(\) = 'service_role' AND auth\.uid\(\) IS DISTINCT FROM v_user/);
  assert.match(hardeningMigration, /IF v_reason = '' THEN[\s\S]+A reason is required/);
});

test("client feature flag rollout bucket is deterministic, unsigned, stable, and distributed", () => {
  assert.match(baseMigration, /decode\(substr\(md5\(p_flag \|\| ':' \|\| p_user::text\), 1, 8\), 'hex'\)/);
  assert.match(baseMigration, /get_byte\(bytes, 0\)::bigint \* 16777216/);
  assert.match(baseMigration, /get_byte\(bytes, 3\)::bigint/);
  assert.match(baseMigration, /\) % 10000[\s\S]+\)::integer/);
  assert.doesNotMatch(baseMigration, /::bit\(32\)::bigint/);
  assert.match(hardeningMigration, /Flag keys are load-bearing rollout seeds; renaming a flag re-randomizes/);

  const fixtures: Array<[string, string, number]> = [
    ["media_v2_video", "00000000-0000-4000-8000-000000000001", 7761],
    ["media_v2_video", "11111111-1111-4111-8111-111111111111", 1740],
    ["media_v2_video", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 3642],
    ["media_v2_photo", "00000000-0000-4000-8000-000000000001", 8360],
    ["media_v2_photo", "11111111-1111-4111-8111-111111111111", 9881],
    ["media_v2_photo", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 3150],
    ["media_v2_voice", "00000000-0000-4000-8000-000000000001", 7458],
    ["media_v2_voice", "11111111-1111-4111-8111-111111111111", 1352],
    ["media_v2_voice", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 7359],
  ];
  for (const [flag, userId, expected] of fixtures) assert.equal(bucket(flag, userId), expected);

  let enabledCount = 0;
  for (let i = 0; i < 10_000; i += 1) {
    const userId = `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
    if (bucket("media_v2_video", userId) < 5000) enabledCount += 1;
  }
  assert.equal(enabledCount, 5027);
  assert.ok(enabledCount >= 4800 && enabledCount <= 5200);
});

test("media v2 flags are seeded disabled with zero rollout", () => {
  for (const flag of ["media_v2_video", "media_v2_photo", "media_v2_voice"]) {
    assert.match(baseMigration, new RegExp(`'${flag}', false, 0`));
  }
});

test("video date v4 flags are typed, prefetched, and use namespaced stable rollout keys", () => {
  for (const flag of [
    "video_date.snapshot_v2",
    "video_date.deck_deal_v2",
    "video_date.readiness_v2",
    "video_date.micro_verdict_v2",
    "video_date.broadcast_v2",
    "video_date.timeline_v2",
    "video_date.deck_prefetch_polish_v2",
    "video_date.lobby_timeline_v2",
    "video_date.post_date_instant_next_v2",
    "video_date.broadcast_batched_v2",
    "video_date.resilience_v2",
    "video_date.daily_webhooks_v2",
    "video_date.extension_mutual_v2",
    "video_date.safety_always_on_v2",
    "video_date.daily_pool_v2",
    "video_date.multi_device_v2",
    "video_date.outbox_v2.mark_ready",
    "video_date.outbox_v2.forfeit",
    "video_date.outbox_v2.continue_handshake",
    "video_date.outbox_v2.handshake_auto_promote",
    "video_date.outbox_v2.date_timeout",
    "video_date.outbox_v2.submit_verdict",
    "video_date.outbox_v2.extension",
    "video_date.outbox_v2.safety",
    "video_date.outbox_v2.drain_match_queue",
  ]) {
    assert.match(videoDateFlags, new RegExp(`"${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(videoDateFlagSeedMigration, new RegExp(`'${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}',\\s*false,\\s*0`));
  }
  assert.doesNotMatch(videoDateFlagSeedMigration, /INSERT INTO public\.client_feature_flags \(flag,/);
  assert.match(videoDateFlagSeedMigration, /INSERT INTO public\.client_feature_flags \(flag_key, enabled, rollout_bps, description, kill_switch_active\)/);

  assert.match(core, /VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS/);
  assert.match(core, /export const CLIENT_FEATURE_FLAG_TELEMETRY_EVENT = "client_feature_flag_evaluated"/);
  assert.match(core, /export const LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT = "media_v2_flag_evaluated"/);
});

test("web/native hooks use the shared core with persisted initial data and debounced refresh", () => {
  assert.match(core, /export const ALL_CLIENT_FEATURE_FLAGS/);
  assert.match(core, /export const CLIENT_FEATURE_FLAG_TTL_MS = 60_000/);
  assert.match(core, /export const CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS = CLIENT_FEATURE_FLAG_TTL_MS/);
  assert.match(core, /const flagCache = new Map<string, ClientFeatureFlagEvaluation>/);
  assert.match(core, /const inFlight = new Map<string, Promise<ClientFeatureFlagEvaluation>>/);
  assert.match(core, /latestRequestSequenceByKey/);
  assert.match(core, /nextRequestSequence/);
  assert.match(core, /cacheGeneration/);
  assert.match(core, /const inFlightKey = input\.force \? `\$\{key\}:force` : key/);
  assert.match(core, /writeCacheIfFresh/);
  assert.match(core, /hydrateClientFeatureFlagCacheFromString/);
  assert.match(core, /persistClientFeatureFlagCache/);
  assert.match(core, /prefetchClientFeatureFlags/);
  assert.match(core, /emitEvaluationSafely/);
  assert.match(core, /analytics failures must never affect flag decisions/);
  assert.match(core, /failClosedEvaluation/);

  assert.match(webHook, /from "@\/lib\/clientFeatureFlags"/);
  assert.match(webHook, /CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS/);
  assert.match(webHook, /hydrateWebClientFeatureFlagCache\(\)/);
  assert.match(webHook, /initialData/);
  assert.match(webHook, /initialDataUpdatedAt: initialData\?\.fetchedAtMs/);
  assert.doesNotMatch(webHook, /placeholderData:\s*false/);
  assert.match(webHook, /shouldRefreshClientFeatureFlag\(flag, userId\)/);
  assert.match(webHook, /fetchClientFeatureFlag\(flag, userId, true\)/);
  assert.match(webHook, /window\.setInterval\([\s\S]+CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS/);
  assert.match(webHook, /document\.visibilityState !== "visible"/);
  assert.match(webHook, /window\.clearInterval\(refreshIntervalId\)/);
  assert.match(webHook, /clearClientFeatureFlagCache/);

  assert.match(nativeHook, /from '@\/lib\/clientFeatureFlags'/);
  assert.match(nativeHook, /CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS/);
  assert.match(nativeHook, /hydrateNativeClientFeatureFlagCache\(\)/);
  assert.match(nativeHook, /initialData/);
  assert.match(nativeHook, /initialDataUpdatedAt: initialData\?\.fetchedAtMs/);
  assert.doesNotMatch(nativeHook, /placeholderData:\s*false/);
  assert.match(nativeHook, /shouldRefreshClientFeatureFlag\(flag, userId\)/);
  assert.match(nativeHook, /AppState\.addEventListener\('change'/);
  assert.match(nativeHook, /setInterval\([\s\S]+CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS/);
  assert.match(nativeHook, /AppState\.currentState !== 'active'/);
  assert.match(nativeHook, /clearInterval\(refreshIntervalId\)/);
});

test("platform feature flag libs persist, prefetch, emit evaluation telemetry, and fail closed at upload-start", () => {
  assert.match(core, /export const UPLOAD_FLAG_EVALUATION_TIMEOUT_MS = 1_500/);
  assert.match(core, /export function failClosedUploadEvaluation/);
  assert.match(core, /export function withUploadFlagTimeout/);
  assert.match(core, /client_feature_flag_upload_timeout/);

  for (const source of [webLib, nativeLib]) {
    assert.match(source, /evaluate_client_feature_flag_detail/);
    assert.match(source, /evaluate_client_feature_flags/);
    assert.match(source, /LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT/);
    assert.match(source, /CLIENT_FEATURE_FLAG_TELEMETRY_EVENT/);
    assert.match(source, /event\.flag\.startsWith\(['"]media_v2_['"]\)/);
    assert.match(source, /\[LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT, CLIENT_FEATURE_FLAG_TELEMETRY_EVENT\]/);
    assert.match(source, /\[CLIENT_FEATURE_FLAG_TELEMETRY_EVENT\]/);
    assert.match(source, /trackEvent\(eventName, payload\)/);
    assert.match(source, /platform: (?:['"]web['"]|nativePlatform\(\))/);
    assert.match(source, /user_id_bucket/);
    assert.match(source, /clearPersistedClientFeatureFlagCache/);
    assert.match(source, /evaluateClientFeatureFlagForUpload/);
    assert.match(source, /failClosedUploadEvaluation/);
    assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(options, ['"]userId['"]\)/);
    assert.match(source, /withUploadFlagTimeout\(supabase\.auth\.getSession\(\)\)/);
    assert.match(source, /withUploadFlagTimeout\(fetchClientFeatureFlag\(flag, userId, true\)\)/);
    assert.match(source, /supabase\.auth\.getSession\(\)/);
    assert.doesNotMatch(source, /supabase\.auth\.getUser\(\)/);
  }

  for (const source of [webStorageUploads, nativeStorageUploads]) {
    assert.match(source, /evaluateClientFeatureFlagForUpload\((["'])media_v2_photo\1, \{ userId: uploadUserId \}\)/);
    assert.match(source, /evaluateClientFeatureFlagForUpload\((["'])media_v2_voice\1, \{ userId: uploadUserId \}\)/);
  }
});

test("feature flag and upload telemetry are best-effort and never gate routing", () => {
  for (const source of [webLib, nativeLib]) {
    assert.match(source, /const eventNames = event\.flag\.startsWith\(['"]media_v2_['"]\)[\s\S]+for \(const eventName of eventNames\)[\s\S]+try \{[\s\S]+trackEvent\(eventName, payload\)[\s\S]+catch \{/);
    assert.match(source, /analytics failures must not change feature flag behavior/);
  }
  for (const source of [webStorageUploads, webVideoUploads, nativeStorageUploads, nativeVideoUploads]) {
    assert.match(source, /try \{[\s\S]+MEDIA_UPLOAD_PATH_EVENT_NAMES[\s\S]+catch \{/);
    assert.match(source, /createMediaUploadPathTelemetryFields/);
    assert.match(source, /upload telemetry is best-effort and must not block media uploads/);
  }
});

test("auth session lifecycle hydrates/prefetches and sign-out clears feature flag cache plus React Query rows", () => {
  for (const source of [webAuth, nativeAuth]) {
    assert.match(source, /clearClientFeatureFlagCache/);
    assert.match(source, /prefetchClientFeatureFlagsForUser/);
    assert.match(source, /clientFeatureFlagQueryKey/);
    assert.match(source, /CLIENT_FEATURE_FLAG_QUERY_KEY/);
    assert.match(source, /removeQueries\(\{ queryKey: \[CLIENT_FEATURE_FLAG_QUERY_KEY\] \}\)/);
    assert.match(source, /cacheAcceptedEvaluations/);
    assert.match(source, /setQueryData\(clientFeatureFlagQueryKey\(evaluation\.flag, userId\), evaluation\)/);
  }
  assert.match(webAuth, /hydrateClientFeatureFlagsForWeb/);
  assert.match(nativeAuth, /hydrateNativeClientFeatureFlagCache/);
});

test("older in-flight render evaluations cannot overwrite newer forced upload decisions", async () => {
  clearRuntimeClientFeatureFlagCache();
  const flag = "media_v2_photo";
  const userId = "00000000-0000-4000-8000-000000000123";
  const renderRequest = deferred<unknown>();
  const forcedRequest = deferred<unknown>();
  let callCount = 0;

  const renderEvaluation = evaluateRuntimeClientFeatureFlag({
    flag,
    userId,
    fetchDetail: async () => {
      callCount += 1;
      return callCount === 1 ? renderRequest.promise : forcedRequest.promise;
    },
  });
  await Promise.resolve();

  const forcedEvaluation = evaluateRuntimeClientFeatureFlag({
    flag,
    userId,
    force: true,
    fetchDetail: async () => {
      callCount += 1;
      return callCount === 1 ? renderRequest.promise : forcedRequest.promise;
    },
  });

  forcedRequest.resolve(evaluationRow(flag, false, "kill_switched"));
  assert.equal((await forcedEvaluation).enabled, false);

  renderRequest.resolve(evaluationRow(flag, true, "rollout"));
  assert.equal((await renderEvaluation).enabled, true);
  assert.equal(getRuntimeCachedClientFeatureFlag(flag, userId)?.enabled, false);
  assert.equal(getRuntimeCachedClientFeatureFlag(flag, userId)?.source, "kill_switched");
});

test("older prefetch responses cannot overwrite newer forced upload decisions", async () => {
  clearRuntimeClientFeatureFlagCache();
  const flag = "media_v2_video";
  const userId = "00000000-0000-4000-8000-000000000456";
  const prefetchRequest = deferred<unknown>();
  const forcedRequest = deferred<unknown>();

  const prefetch = prefetchRuntimeClientFeatureFlags({
    flags: [flag],
    userId,
    fetchBatch: async () => prefetchRequest.promise,
    fetchDetail: async () => {
      throw new Error("prefetch should not fall back in this test");
    },
  });
  await Promise.resolve();

  const forcedEvaluation = evaluateRuntimeClientFeatureFlag({
    flag,
    userId,
    force: true,
    fetchDetail: async () => forcedRequest.promise,
  });

  forcedRequest.resolve(evaluationRow(flag, false, "kill_switched"));
  assert.equal((await forcedEvaluation).enabled, false);

  prefetchRequest.resolve({
    success: true,
    flags: [evaluationRow(flag, true, "rollout")],
  });
  assert.deepEqual(await prefetch, []);
  assert.equal(getRuntimeCachedClientFeatureFlag(flag, userId)?.enabled, false);
  assert.equal(getRuntimeCachedClientFeatureFlag(flag, userId)?.source, "kill_switched");
});

test("in-flight evaluations started before cache clear cannot repopulate signed-out state", async () => {
  clearRuntimeClientFeatureFlagCache();
  const flag = "media_v2_voice";
  const userId = "00000000-0000-4000-8000-000000000789";
  const request = deferred<unknown>();
  let persistedWrites = 0;

  const evaluation = evaluateRuntimeClientFeatureFlag({
    flag,
    userId,
    fetchDetail: async () => request.promise,
    storage: {
      getItem: () => null,
      setItem: () => {
        persistedWrites += 1;
      },
      removeItem: () => undefined,
    },
  });
  await Promise.resolve();

  clearRuntimeClientFeatureFlagCache();
  request.resolve(evaluationRow(flag, true, "rollout"));

  assert.equal((await evaluation).enabled, true);
  assert.equal(getRuntimeCachedClientFeatureFlag(flag, userId), null);
  assert.equal(persistedWrites, 0);
});
