import { clearNativeSupabaseAuthStorage } from '@/lib/authStorage';
import { supabase } from '@/lib/supabase';

export type NativeAuthRecoveryReason = 'bootstrap' | 'cached-session' | 'managed-refresh' | 'sign-out';

const INVALID_REFRESH_TOKEN_PATTERNS = [
  /invalid refresh token/i,
  /refresh token not found/i,
  /refresh_token_not_found/i,
  /refresh token already used/i,
  /refresh_token_already_used/i,
];

function errorFingerprint(error: unknown): string {
  if (!error) return '';
  const maybeError = error as { message?: string; code?: string; name?: string };
  return [maybeError.name, maybeError.code, maybeError.message].filter(Boolean).join(' ');
}

export function isInvalidRefreshTokenError(error: unknown): boolean {
  const fingerprint = errorFingerprint(error);
  return INVALID_REFRESH_TOKEN_PATTERNS.some((pattern) => pattern.test(fingerprint));
}

export function isNoSessionError(error: unknown): boolean {
  return /session missing|no session/i.test(errorFingerprint(error));
}

export function isRecoverableNativeAuthError(error: unknown): boolean {
  return isInvalidRefreshTokenError(error) || isNoSessionError(error);
}

function warnUnexpectedRecoveryError(
  label: string,
  reason: NativeAuthRecoveryReason,
  error: unknown,
): void {
  if (!__DEV__ || !error || isRecoverableNativeAuthError(error)) return;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[auth] local ${reason} cleanup ${label}:`, message);
}

export async function recoverNativeAuthSession(
  reason: NativeAuthRecoveryReason,
  triggerError: unknown,
): Promise<{
  failedKeys: string[];
}> {
  try {
    await supabase.auth.stopAutoRefresh();
  } catch (stopError) {
    warnUnexpectedRecoveryError('auto-refresh stop failed', reason, stopError);
  }

  const storageCleanup = await clearNativeSupabaseAuthStorage();

  let localSignOutError: unknown = null;
  try {
    const result = await supabase.auth.signOut({ scope: 'local' });
    localSignOutError = result.error;
  } catch (signOutError) {
    localSignOutError = signOutError;
  }

  warnUnexpectedRecoveryError('sign-out failed', reason, localSignOutError);

  if (__DEV__ && storageCleanup.failedKeys.length > 0) {
    console.warn(`[auth] local ${reason} cleanup storage purge incomplete:`, storageCleanup.failedKeys);
  }

  if (__DEV__ && triggerError && !isRecoverableNativeAuthError(triggerError)) {
    const message = triggerError instanceof Error ? triggerError.message : String(triggerError);
    console.warn(`[auth] local ${reason} cleanup triggered by unexpected error:`, message);
  }

  return { failedKeys: storageCleanup.failedKeys };
}
