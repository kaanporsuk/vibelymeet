import * as Linking from 'expo-linking';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasPasswordRecoveryIntent,
  normalizeAuthRedirectPath,
  parseSupabaseAuthReturnUrl,
  type PasswordRecoveryStatus,
} from '@shared/authRedirect';

const GOOGLE_OAUTH_CALLBACK_PATH = 'auth/callback';
const ROOT_PATH = '/';

function getPathVariants(url: string, parsed: URL): string[] {
  const linked = Linking.parse(url);
  return Array.from(
    new Set(
      [
        normalizeAuthRedirectPath(parsed.pathname),
        normalizeAuthRedirectPath(linked.path),
      ].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

export function getNativeGoogleOAuthRedirectUrl(): string {
  return Linking.createURL(GOOGLE_OAUTH_CALLBACK_PATH);
}

export function getNativePasswordResetRedirectUrl(): string {
  return Linking.createURL('reset-password');
}

export function getNativeEmailSignUpRedirectUrl(): string {
  return Linking.createURL(ROOT_PATH);
}

function isGoogleOAuthCallbackUrl(url: string, parsed: URL): boolean {
  return getPathVariants(url, parsed).some((path) => path === GOOGLE_OAUTH_CALLBACK_PATH);
}

export type NativeAuthRedirectResult = {
  handled: boolean;
  recovery: boolean;
  recoveryStatus: PasswordRecoveryStatus;
  error: Error | null;
};

export async function completeSessionFromAuthReturnUrl(
  supabase: SupabaseClient,
  url: string,
): Promise<NativeAuthRedirectResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      handled: false,
      recovery: false,
      recoveryStatus: 'none',
      error: null,
    };
  }

  const authReturn = parseSupabaseAuthReturnUrl(url);
  const pathVariants = getPathVariants(url, parsed);
  const googleCallback = isGoogleOAuthCallbackUrl(url, parsed);
  const recovery = hasPasswordRecoveryIntent(authReturn.type, pathVariants);

  if (!authReturn.hasAuthPayload && !googleCallback) {
    return {
      handled: false,
      recovery: false,
      recoveryStatus: 'none',
      error: null,
    };
  }

  if (authReturn.authError) {
    return {
      handled: true,
      recovery,
      recoveryStatus: recovery ? 'invalid' : 'none',
      error: new Error(authReturn.authError),
    };
  }

  if (authReturn.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(authReturn.code);
    return {
      handled: true,
      recovery,
      recoveryStatus: recovery ? (error ? 'invalid' : 'ready') : 'none',
      error: error ? new Error(error.message) : null,
    };
  }

  if (authReturn.tokenHash && recovery) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: authReturn.tokenHash,
      type: 'recovery',
    });
    return {
      handled: true,
      recovery,
      recoveryStatus: error ? 'invalid' : 'ready',
      error: error ? new Error(error.message) : null,
    };
  }

  if (authReturn.accessToken && authReturn.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: authReturn.accessToken,
      refresh_token: authReturn.refreshToken,
    });
    return {
      handled: true,
      recovery,
      recoveryStatus: recovery ? (error ? 'invalid' : 'ready') : 'none',
      error: error ? new Error(error.message) : null,
    };
  }

  const fallbackMessage = googleCallback
    ? 'Google sign-in did not return a session. Please try again.'
    : 'Auth redirect did not return a session. Please try again.';

  return {
    handled: true,
    recovery,
    recoveryStatus: recovery ? 'invalid' : 'none',
    error: new Error(fallbackMessage),
  };
}
