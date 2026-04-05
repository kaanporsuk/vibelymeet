import * as Linking from 'expo-linking';
import type { SupabaseClient } from '@supabase/supabase-js';

const GOOGLE_OAUTH_CALLBACK_PATH = 'auth/callback';
const RESET_PASSWORD_PATH = 'reset-password';
const ROOT_PATH = '/';

function normalizePath(path: string | null | undefined): string {
  return String(path ?? '')
    .replace(/^\/+/, '')
    .replace(/^--\//, '')
    .replace(/\/+$/, '');
}

function getPathVariants(url: string, parsed: URL): string[] {
  const linked = Linking.parse(url);
  return Array.from(
    new Set(
      [normalizePath(parsed.pathname), normalizePath(linked.path)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

export function getNativeGoogleOAuthRedirectUrl(): string {
  return Linking.createURL(GOOGLE_OAUTH_CALLBACK_PATH);
}

export function getNativePasswordResetRedirectUrl(): string {
  return Linking.createURL(RESET_PASSWORD_PATH);
}

export function getNativeEmailSignUpRedirectUrl(): string {
  return Linking.createURL(ROOT_PATH);
}

function isGoogleOAuthCallbackUrl(url: string, parsed: URL): boolean {
  return getPathVariants(url, parsed).some((path) => path === GOOGLE_OAUTH_CALLBACK_PATH);
}

function isPasswordResetUrl(url: string, parsed: URL): boolean {
  return getPathVariants(url, parsed).some((path) => path.endsWith(RESET_PASSWORD_PATH));
}

export type NativeAuthRedirectResult = {
  handled: boolean;
  recovery: boolean;
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
    return { handled: false, recovery: false, error: null };
  }

  const searchParams = parsed.searchParams;
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));

  const code = searchParams.get('code') ?? hashParams.get('code');
  const accessToken =
    hashParams.get('access_token') ?? searchParams.get('access_token');
  const refreshToken =
    hashParams.get('refresh_token') ?? searchParams.get('refresh_token');
  const authError =
    hashParams.get('error_description') ??
    searchParams.get('error_description') ??
    hashParams.get('error') ??
    searchParams.get('error');
  const type = hashParams.get('type') ?? searchParams.get('type');
  const hasAuthPayload = Boolean(
    authError || code || (accessToken && refreshToken),
  );
  const googleCallback = isGoogleOAuthCallbackUrl(url, parsed);
  const recovery = type === 'recovery' || isPasswordResetUrl(url, parsed);

  if (!hasAuthPayload && !googleCallback) {
    return { handled: false, recovery: false, error: null };
  }

  if (authError) {
    return { handled: true, recovery, error: new Error(authError) };
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return {
      handled: true,
      recovery,
      error: error ? new Error(error.message) : null,
    };
  }

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return {
      handled: true,
      recovery,
      error: error ? new Error(error.message) : null,
    };
  }

  const fallbackMessage = googleCallback
    ? 'Google sign-in did not return a session. Please try again.'
    : 'Auth redirect did not return a session. Please try again.';

  return { handled: true, recovery, error: new Error(fallbackMessage) };
}
