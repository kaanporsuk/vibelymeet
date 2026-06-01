import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("native auth listener is registered only after bootstrap recovery can run", () => {
  const authContext = read("apps/mobile/context/AuthContext.tsx");
  const nativeAuthSession = read("apps/mobile/lib/nativeAuthSession.ts");

  assert.match(authContext, /const subscribeAfterBootstrap = \(\) => \{/);
  assert.match(authContext, /supabase\.auth\.onAuthStateChange\(\(_event, s\) =>/);
  assert.match(
    authContext,
    /await recoverNativeAuthSession\('bootstrap', error\);[\s\S]*subscribeAfterBootstrap\(\);/,
  );
  const successApplyIndex = authContext.indexOf("applyAuthSession(readySession);");
  const successLoadingIndex = authContext.indexOf("setLoading(false);", successApplyIndex);
  const successSubscribeIndex = authContext.indexOf("subscribeAfterBootstrap();", successLoadingIndex);
  assert.ok(successApplyIndex >= 0, "bootstrap success should apply the refreshed readySession");
  assert.ok(successLoadingIndex > successApplyIndex, "loading should clear after applying bootstrap session");
  assert.ok(successSubscribeIndex > successLoadingIndex, "auth listener should subscribe after bootstrap loading clears");
  assert.doesNotMatch(nativeAuthSession, /supabase\.auth\.onAuthStateChange/);
});

test("invalid refresh cleanup purges persisted auth before local sign-out notification", () => {
  const recovery = read("apps/mobile/lib/nativeAuthRecovery.ts");
  const stopRefreshIndex = recovery.indexOf("await supabase.auth.stopAutoRefresh()");
  const clearStorageIndex = recovery.indexOf("const storageCleanup = await clearNativeSupabaseAuthStorage()");
  const localSignOutIndex = recovery.indexOf("supabase.auth.signOut({ scope: 'local' })");

  assert.ok(stopRefreshIndex >= 0, "recovery should stop auto-refresh");
  assert.ok(clearStorageIndex > stopRefreshIndex, "storage purge should follow auto-refresh stop");
  assert.ok(localSignOutIndex > clearStorageIndex, "local sign-out should follow storage purge");
  assert.match(recovery, /refresh_token_not_found/);
  assert.match(recovery, /refresh_token_already_used/);
});

test("native cached session helper recovers invalid refresh errors", () => {
  const nativeAuthSession = read("apps/mobile/lib/nativeAuthSession.ts");

  assert.match(nativeAuthSession, /isRecoverableNativeAuthError\(error\)/);
  assert.match(nativeAuthSession, /recoverNativeAuthSession\('cached-session', error\)/);
  assert.match(nativeAuthSession, /isRecoverableNativeAuthError\(e\)/);
  assert.match(nativeAuthSession, /recoverNativeAuthSession\('cached-session', e\)/);
});

test("native layout uses Vibely-managed auth refresh instead of SDK auto-refresh", () => {
  const layout = read("apps/mobile/app/_layout.tsx");
  const recovery = read("apps/mobile/lib/nativeAuthRecovery.ts");

  assert.match(layout, /SupabaseManagedAuthRefreshAppStateBridge/);
  assert.match(layout, /classifyAuthRefreshError/);
  assert.match(layout, /requestManagedAuthRefresh/);
  assert.match(layout, /applyManagedAuthRefreshSession\(supabase\.auth, refreshSession, refreshResponse,/);
  assert.match(layout, /shouldApply:\s*\(\)\s*=>/);
  assert.match(layout, /recoverNativeAuthSession\('managed-refresh', error\)/);
  assert.match(layout, /managed_refresh_stale_attempt_recovered/);
  assert.doesNotMatch(layout, /supabase\.auth\.refreshSession\(refreshSession\)/);
  assert.doesNotMatch(layout, /startAutoRefresh/);
  assert.match(recovery, /'managed-refresh'/);
});

test("hot-path native token consumers use cached recovery helper", () => {
  const hotPathFiles = [
    "apps/mobile/lib/chatMediaUpload.ts",
    "apps/mobile/lib/creditsCheckout.ts",
    "apps/mobile/lib/uploadImage.ts",
    "apps/mobile/lib/useDeletionRecovery.ts",
    "apps/mobile/lib/vibeVideoApi.ts",
    "apps/mobile/app/(tabs)/events/[id].tsx",
  ];

  for (const path of hotPathFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /supabase\.auth\.getSession\(/, `${path} should not call getSession directly`);
    assert.match(source, /getCachedAccessToken/, `${path} should use recovered cached access tokens`);
  }
});
