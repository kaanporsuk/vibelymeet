import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260519120000_client_feature_flags.sql", "utf8");
const webHook = readFileSync("src/hooks/useFeatureFlag.ts", "utf8");
const nativeHook = readFileSync("apps/mobile/hooks/useFeatureFlag.ts", "utf8");

test("client feature flag schema is additive, default-off, and RPC-gated", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flags/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.client_feature_flag_user_overrides/);
  assert.match(migration, /rollout_bps integer NOT NULL DEFAULT 0 CHECK \(rollout_bps BETWEEN 0 AND 10000\)/);
  assert.match(migration, /ALTER TABLE public\.client_feature_flags ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public\.client_feature_flag_user_overrides ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /auth\.role\(\) <> 'service_role' AND auth\.uid\(\) IS DISTINCT FROM v_user/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.evaluate_client_feature_flag\(text, uuid\) TO authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.client_feature_flag_bucket\(text, uuid\) TO service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.client_feature_flag_bucket\(text, uuid\) TO authenticated/);
});

test("client feature flag evaluation preserves override then rollout then default false order", () => {
  assert.match(migration, /SELECT o\.enabled[\s\S]+FROM public\.client_feature_flag_user_overrides/);
  assert.match(migration, /IF FOUND THEN[\s\S]+RETURN v_override/);
  assert.match(migration, /IF NOT FOUND OR NOT v_flag\.enabled THEN[\s\S]+RETURN false/);
  assert.match(migration, /IF v_flag\.rollout_bps >= 10000 THEN[\s\S]+RETURN true/);
  assert.match(migration, /IF v_flag\.rollout_bps <= 0 THEN[\s\S]+RETURN false/);
  assert.match(migration, /client_feature_flag_bucket\(v_flag_key, v_user\)/);
  assert.match(migration, /RETURN v_bucket < v_flag\.rollout_bps/);
});

test("client feature flag rollout bucket is deterministic and unsigned", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.client_feature_flag_bucket/);
  assert.match(migration, /decode\(substr\(md5\(p_flag \|\| ':' \|\| p_user::text\), 1, 8\), 'hex'\)/);
  assert.match(migration, /get_byte\(bytes, 0\)::bigint \* 16777216/);
  assert.match(migration, /get_byte\(bytes, 3\)::bigint/);
  assert.match(migration, /\) % 10000[\s\S]+\)::integer/);
  assert.doesNotMatch(migration, /::bit\(32\)::bigint/);
});

test("media v2 flags are seeded disabled with zero rollout", () => {
  for (const flag of ["media_v2_video", "media_v2_photo", "media_v2_voice"]) {
    assert.match(migration, new RegExp(`'${flag}', false, 0`));
  }
});

test("web feature flag hook is cached, fail-closed, and visibility refreshed", () => {
  assert.match(webHook, /export type ClientFeatureFlagKey = "media_v2_video" \| "media_v2_photo" \| "media_v2_voice"/);
  assert.match(webHook, /export const CLIENT_FEATURE_FLAG_TTL_MS = 60_000/);
  assert.match(webHook, /supabase\.rpc\("evaluate_client_feature_flag"/);
  assert.match(webHook, /p_flag: flag/);
  assert.match(webHook, /p_user: userId/);
  assert.match(webHook, /enabled = error \? false : data === true/);
  assert.match(webHook, /catch \{[\s\S]+enabled = false/);
  assert.match(webHook, /const existing = inFlight\.get\(key\);[\s\S]+if \(existing\) return existing/);
  assert.doesNotMatch(webHook, /!force && existing/);
  assert.match(webHook, /placeholderData: false/);
  assert.match(webHook, /document\.addEventListener\("visibilitychange"/);
  assert.match(webHook, /fetchFeatureFlag\(flag, userId, true\)/);
  assert.match(webHook, /queryClient\.setQueryData\(queryKey, enabled\)/);
  assert.match(webHook, /clearClientFeatureFlagCacheForTests/);
});

test("native feature flag hook mirrors web semantics and refreshes on AppState active", () => {
  assert.match(nativeHook, /export type ClientFeatureFlagKey = 'media_v2_video' \| 'media_v2_photo' \| 'media_v2_voice'/);
  assert.match(nativeHook, /export const CLIENT_FEATURE_FLAG_TTL_MS = 60_000/);
  assert.match(nativeHook, /supabase\.rpc\('evaluate_client_feature_flag'/);
  assert.match(nativeHook, /p_flag: flag/);
  assert.match(nativeHook, /p_user: userId/);
  assert.match(nativeHook, /enabled = error \? false : data === true/);
  assert.match(nativeHook, /catch \{[\s\S]+enabled = false/);
  assert.match(nativeHook, /const existing = inFlight\.get\(key\);[\s\S]+if \(existing\) return existing/);
  assert.doesNotMatch(nativeHook, /!force && existing/);
  assert.match(nativeHook, /placeholderData: false/);
  assert.match(nativeHook, /AppState\.addEventListener\('change'/);
  assert.match(nativeHook, /nextState !== 'active'/);
  assert.match(nativeHook, /fetchFeatureFlag\(flag, userId, true\)/);
  assert.match(nativeHook, /queryClient\.setQueryData\(queryKey, enabled\)/);
  assert.match(nativeHook, /clearClientFeatureFlagCacheForTests/);
});
