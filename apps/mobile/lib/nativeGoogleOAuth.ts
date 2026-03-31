import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deep link Supabase should redirect to after Google OAuth. Must match an allowed redirect URL
 * in the Supabase dashboard (exact URL or wildcard pattern).
 */
export function getNativeGoogleOAuthRedirectUrl(): string {
  return Linking.createURL('auth/callback');
}

async function completeSessionFromOAuthReturnUrl(
  supabase: SupabaseClient,
  url: string
): Promise<{ error: Error | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: new Error('Invalid OAuth return URL') };
  }

  const code = parsed.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return { error: error ? new Error(error.message) : null };
  }

  const hash = parsed.hash.replace(/^#/, '');
  if (hash) {
    const hp = new URLSearchParams(hash);
    const oauthErr = hp.get('error_description') || hp.get('error');
    if (oauthErr) {
      return { error: new Error(oauthErr) };
    }
    const access_token = hp.get('access_token');
    const refresh_token = hp.get('refresh_token');
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      return { error: error ? new Error(error.message) : null };
    }
  }

  const qAccess = parsed.searchParams.get('access_token');
  const qRefresh = parsed.searchParams.get('refresh_token');
  if (qAccess && qRefresh) {
    const { error } = await supabase.auth.setSession({ access_token: qAccess, refresh_token: qRefresh });
    return { error: error ? new Error(error.message) : null };
  }

  return { error: new Error('Google sign-in did not return a session. Please try again.') };
}

export type NativeGoogleOAuthResult = { cancelled: boolean; error: Error | null };

/**
 * Full Google OAuth for React Native: PKCE / implicit callback tokens via auth session,
 * then persist session through Supabase (same outcomes as web redirect flow).
 */
export async function startNativeGoogleOAuth(supabase: SupabaseClient): Promise<NativeGoogleOAuthResult> {
  const redirectTo = getNativeGoogleOAuthRedirectUrl();

  const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (oauthError) {
    return { cancelled: false, error: new Error(oauthError.message) };
  }

  const authUrl = data?.url;
  if (!authUrl) {
    return { cancelled: false, error: new Error('Could not start Google sign-in.') };
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { cancelled: true, error: null };
  }

  if (result.type !== 'success' || !result.url) {
    return { cancelled: false, error: new Error('Google sign-in was interrupted. Please try again.') };
  }

  const { error } = await completeSessionFromOAuthReturnUrl(supabase, result.url);
  return { cancelled: false, error };
}
