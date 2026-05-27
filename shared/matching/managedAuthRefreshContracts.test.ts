import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

test('web disables Supabase SDK auto refresh and owns managed scheduling', () => {
  const client = read('src/integrations/supabase/client.ts');
  const authContext = read('src/contexts/AuthContext.tsx');

  assert.match(client, /autoRefreshToken:\s*false/);
  assert.doesNotMatch(client, /autoRefreshToken:\s*isBrowser/);
  assert.match(authContext, /classifyAuthRefreshError/);
  assert.match(authContext, /nextAuthRefreshDelayMs/);
  assert.match(authContext, /shouldRefreshSessionSoon/);
  assert.match(authContext, /requestManagedAuthRefresh/);
  assert.match(authContext, /applyManagedAuthRefreshSession\(supabase\.auth, refreshSession, refreshResponse,/);
  assert.match(authContext, /shouldApply:\s*\(\)\s*=>/);
  assert.match(authContext, /AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS/);
  assert.match(authContext, /isNewerAuthRefreshSession/);
  assert.match(authContext, /browser\.auth_refresh_stale_attempt_recovered/);
  assert.doesNotMatch(authContext, /supabase\.auth\.refreshSession\(refreshSession\)/);
  assert.match(authContext, /browser\.auth_refresh_retry_scheduled/);
  assert.match(authContext, /browser\.auth_refresh_invalid_session/);
  assert.match(authContext, /window\.addEventListener\("online"/);
  assert.match(authContext, /document\.addEventListener\("visibilitychange"/);
  assert.match(authContext, /supabase\.auth\.signOut\(\{\s*scope:\s*"local"\s*\}\)/);
});

test('native foreground bridge uses managed refresh, not SDK auto refresh', () => {
  const layout = read('apps/mobile/app/_layout.tsx');

  assert.match(layout, /function SupabaseManagedAuthRefreshAppStateBridge\(\)/);
  assert.match(layout, /classifyAuthRefreshError/);
  assert.match(layout, /nextAuthRefreshDelayMs/);
  assert.match(layout, /shouldRefreshSessionSoon/);
  assert.match(layout, /requestManagedAuthRefresh/);
  assert.match(layout, /applyManagedAuthRefreshSession\(supabase\.auth, refreshSession, refreshResponse,/);
  assert.match(layout, /shouldApply:\s*\(\)\s*=>/);
  assert.match(layout, /AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS/);
  assert.match(layout, /isNewerAuthRefreshSession/);
  assert.match(layout, /managed_refresh_stale_attempt_recovered/);
  assert.match(layout, /recoverNativeAuthSession\('managed-refresh', error\)/);
  assert.match(layout, /primeCachedSession\(nextSession\)/);
  assert.match(layout, /AppState\.addEventListener\('change', handleAppStateChange\)/);
  assert.doesNotMatch(layout, /supabase\.auth\.refreshSession\(refreshSession\)/);
  assert.doesNotMatch(layout, /startAutoRefresh/);
});

test('native cached refresh helper keeps recovery and sanitized diagnostics aligned', () => {
  const nativeAuthSession = read('apps/mobile/lib/nativeAuthSession.ts');
  const nativeRecovery = read('apps/mobile/lib/nativeAuthRecovery.ts');

  assert.match(nativeAuthSession, /function handleCachedRefreshFailure/);
  assert.match(nativeAuthSession, /classifyAuthRefreshError\(error\)/);
  assert.match(nativeAuthSession, /requestManagedAuthRefresh/);
  assert.match(nativeAuthSession, /applyManagedAuthRefreshSession\(supabase\.auth, session, refreshResponse,/);
  assert.match(nativeAuthSession, /shouldApply:\s*\(\)\s*=>\s*cacheVersion === requestVersion/);
  assert.match(nativeAuthSession, /function recoverFromCachedRefreshRace/);
  assert.match(nativeAuthSession, /function resolveFreshSessionAfterCacheInvalidation/);
  assert.match(nativeAuthSession, /AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS/);
  assert.match(nativeAuthSession, /isNewerAuthRefreshSession/);
  assert.match(nativeAuthSession, /recoverNativeAuthSession\('cached-session', error\)/);
  assert.match(nativeAuthSession, /authRefreshDebugInfo\(error\)/);
  assert.match(nativeAuthSession, /isSessionExpiredForSwipe\(session\)[\s\S]*invalidate\(\);[\s\S]*return null/);
  assert.match(nativeAuthSession, /export function primeCachedSession/);
  assert.match(nativeRecovery, /'managed-refresh'/);
});

test('managed refresh paths do not introduce raw refresh-token error logging', () => {
  const managedSources = [
    read('src/contexts/AuthContext.tsx'),
    read('apps/mobile/app/_layout.tsx'),
    read('apps/mobile/lib/nativeAuthSession.ts'),
  ].join('\n');

  assert.doesNotMatch(managedSources, /console\.error\([^)]*refresh/i);
  assert.doesNotMatch(managedSources, /console\.warn\([^)]*refreshSession (?:error|threw)/i);
  assert.doesNotMatch(managedSources, /recordBrowserEvent\([^)]*error\.message/i);
  assert.doesNotMatch(managedSources, /rcBreadcrumb\([^)]*error\.message/i);
});
