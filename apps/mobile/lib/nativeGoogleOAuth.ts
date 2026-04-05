import * as WebBrowser from 'expo-web-browser';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  completeSessionFromAuthReturnUrl,
  getNativeGoogleOAuthRedirectUrl,
} from '@/lib/nativeAuthRedirect';

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

  const { error } = await completeSessionFromAuthReturnUrl(supabase, result.url);
  return { cancelled: false, error };
}
