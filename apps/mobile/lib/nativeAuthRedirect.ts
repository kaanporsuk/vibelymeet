import * as Linking from 'expo-linking';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasPasswordRecoveryIntent,
  normalizeAuthReturnTokenHashOtpType,
  normalizeAuthRedirectPath,
  parseSupabaseAuthReturnUrl,
  type PasswordRecoveryStatus,
} from '@shared/authRedirect';
import { safeAuthErrorMessage } from '@clientShared/authErrorCopy';

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

export function getNativeEmailChangeRedirectUrl(): string {
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

function authRedirectError(error: unknown, fallback: string): Error {
  return new Error(safeAuthErrorMessage(error, fallback));
}

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
      error: authRedirectError({ message: authReturn.authError }, 'Could not complete sign-in. Try again.'),
    };
  }

  if (authReturn.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(authReturn.code);
    return {
      handled: true,
      recovery,
      recoveryStatus: recovery ? (error ? 'invalid' : 'ready') : 'none',
      error: error ? authRedirectError(error, 'Could not complete sign-in. Try again.') : null,
    };
  }

  if (authReturn.tokenHash) {
    const otpType = normalizeAuthReturnTokenHashOtpType(authReturn.type, recovery);
    if (!otpType) {
      return {
        handled: true,
        recovery,
        recoveryStatus: recovery ? 'invalid' : 'none',
        error: new Error('Auth redirect did not include a recognized verification type. Please request a fresh link.'),
      };
    }

    const tokenHashFallback = recovery
      ? 'That recovery link is invalid or expired.'
      : 'That sign-in link is invalid or expired. Please request a fresh link.';
    const { error } = await supabase.auth.verifyOtp({
      token_hash: authReturn.tokenHash,
      type: otpType,
    });
    return {
      handled: true,
      recovery,
      recoveryStatus: recovery ? (error ? 'invalid' : 'ready') : 'none',
      error: error ? authRedirectError(error, tokenHashFallback) : null,
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
      error: error ? authRedirectError(error, 'Could not complete sign-in. Try again.') : null,
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
