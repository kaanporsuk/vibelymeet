/**
 * useIdentityLinking.ts (Native / Expo)
 *
 * Manages Supabase identity linking for a signed-in Vibely user on React Native.
 *
 * SUPPORTED METHODS
 * ─────────────────
 * • Google  → supabase.auth.linkIdentity() via browser OAuth (expo-web-browser)
 * • Apple   → supabase.auth.linkIdentity() via native ID token (expo-apple-authentication)
 * • Email+password  → two distinct flows depending on session state:
 *     A. Session already has an email (OAuth user) → addPasswordToAccount(password)
 *        Uses updateUser({ password }). No email change, no confirmation email.
 *     B. No session email (phone-only user)        → linkNewEmail(email)
 *        Uses updateUser({ email }). Sends confirmation email.
 * • Phone  → linkPhone(phone) + verifyPhoneLink(phone, token)
 *        Uses updateUser({ phone }) + verifyOtp({ type: 'phone_change' }).
 *        Phone sign-in is OTP-only; no phone+password is implemented.
 *
 * NATIVE OAUTH LINKING ARCHITECTURE
 * ──────────────────────────────────
 * supabase.auth.linkIdentity() supports two overloads:
 *   1. SignInWithOAuthCredentials    — browser redirect
 *   2. SignInWithIdTokenCredentials  — native OIDC ID token
 *
 * APPLE: Native token path is implemented.
 *   expo-apple-authentication.signAsync() produces an identityToken that is passed
 *   directly to linkIdentity({ provider: 'apple', token }). This is the same token
 *   used by the existing Apple sign-in flow. No browser required.
 *
 * GOOGLE: Browser OAuth path is used. This is a deliberate first-release choice:
 *   • Native Google ID tokens require @react-native-google-signin, which is not in
 *     the Vibely native dependency tree.
 *   • Adding that module requires pod-install, Google Cloud Console native client
 *     setup, and EAS build changes — a separate engineering investment.
 *   • The browser OAuth flow via expo-web-browser is consistent with the existing
 *     Google sign-in path and works correctly for linking.
 *   • Google native token linking is tracked as a future upgrade.
 *
 * REMOVAL
 * ───────
 * supabase.auth.unlinkIdentity() is available. A user may unlink any identity as long
 * as at least one other identity remains (prevents orphaned accounts).
 * canRemoveMethod is computed from the live identity count.
 *
 * SECURITY INVARIANTS
 * ───────────────────
 * • All mutations require an active session.
 * • linkIdentity() is used, never signInWithOAuth() while signed in.
 * • updateUser() edits the existing auth.users row — never creates a new account.
 * • Cross-account conflicts are surfaced via mapIdentityLinkingError(); no silent merge.
 */

import { Platform } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  completeSessionFromAuthReturnUrl,
  getNativeGoogleOAuthRedirectUrl,
} from '@/lib/nativeAuthRedirect';
import { mapIdentityLinkingError } from '@shared/authConflictMessages';

// ---------- types ----------

export type ProviderType = 'google' | 'apple' | 'email' | 'phone';

// Derive raw identity type from the SDK return so we can pass it to unlinkIdentity().
type RawUserIdentity = NonNullable<
  Awaited<ReturnType<typeof supabase.auth.getUserIdentities>>['data']
>['identities'][number];

export interface LinkedIdentity {
  provider: ProviderType;
  user_id: string;
  identity_id: string;
  identity_data?: {
    email?: string;
    phone?: string;
    sub?: string;
    name?: string;
  };
}

export interface IdentityLinkingState {
  identities: LinkedIdentity[];
  isLoading: boolean;
  error: string | null;
  isLinking: boolean;
  linkingProvider: ProviderType | null;
}

// ---------- hook ----------

export function useIdentityLinking() {
  const { session } = useAuth();
  const [state, setState] = useState<IdentityLinkingState>({
    identities: [],
    isLoading: true,
    error: null,
    isLinking: false,
    linkingProvider: null,
  });

  // Raw Supabase identities — kept in sync with state.identities.
  // Stored separately so unlinkIdentity() receives the full SDK object shape.
  const rawIdentitiesRef = useRef<RawUserIdentity[]>([]);

  // ─── fetch ────────────────────────────────────────────────────────────────

  const fetchIdentities = useCallback(async () => {
    if (!session?.user?.id) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const { data, error } = await supabase.auth.getUserIdentities();
      if (error) throw error;

      rawIdentitiesRef.current = data?.identities ?? [];

      const linked: LinkedIdentity[] = (data?.identities ?? []).map(i => ({
        provider: i.provider as ProviderType,
        user_id: i.user_id,
        identity_id: i.identity_id,
        identity_data: i.identity_data as LinkedIdentity['identity_data'],
      }));

      if (session.user.email && !linked.some(i => i.provider === 'email')) {
        linked.push({
          provider: 'email',
          user_id: session.user.id,
          identity_id: `email-${session.user.id}`,
          identity_data: { email: session.user.email },
        });
      }
      if (session.user.phone && !linked.some(i => i.provider === 'phone')) {
        linked.push({
          provider: 'phone',
          user_id: session.user.id,
          identity_id: `phone-${session.user.id}`,
          identity_data: { phone: session.user.phone },
        });
      }

      setState(prev => ({ ...prev, identities: linked, isLoading: false }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch identities',
      }));
    }
  }, [session?.user?.id, session?.user?.identities, session?.user?.email, session?.user?.phone]);

  useEffect(() => { fetchIdentities(); }, [fetchIdentities]);

  // ─── read helpers ─────────────────────────────────────────────────────────

  const isProviderLinked = useCallback(
    (provider: ProviderType) => state.identities.some(i => i.provider === provider),
    [state.identities],
  );

  const canRemoveMethod = state.identities.length >= 2;

  const canUnlinkProvider = useCallback(
    (provider: ProviderType) => state.identities.length >= 2 && isProviderLinked(provider),
    [state.identities.length, isProviderLinked],
  );

  // ─── Apple native token linking ───────────────────────────────────────────
  //
  // Uses expo-apple-authentication to obtain an OIDC identity token, then passes
  // it directly to linkIdentity({ provider: 'apple', token }). This is the same
  // token the existing Apple sign-in uses. No browser required.

  const linkAppleNative = useCallback(async (): Promise<void> => {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign In is only available on iOS.');
    }

    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      throw new Error('Apple Sign In is not available on this device or iOS build.');
    }

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      throw new Error('Apple did not return an identity token. Please try again.');
    }

    const { error } = await supabase.auth.linkIdentity({
      provider: 'apple',
      token: credential.identityToken,
    });

    if (error) throw new Error(mapIdentityLinkingError(error, 'apple'));

    await fetchIdentities();
  }, [fetchIdentities]);

  // ─── Google browser OAuth linking ─────────────────────────────────────────
  //
  // Uses expo-web-browser + supabase.auth.linkIdentity(SignInWithOAuthCredentials).
  // Native Google ID tokens would require @react-native-google-signin (not in stack).

  const linkGoogleBrowser = useCallback(async (): Promise<void> => {
    const redirectUrl = `${getNativeGoogleOAuthRedirectUrl()}?linking=true&provider=google`;
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
    });

    if (error) throw new Error(mapIdentityLinkingError(error, 'google'));
    if (!data?.url) throw new Error('Failed to start Google linking.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

    if (result.type === 'success' && result.url) {
      const completion = await completeSessionFromAuthReturnUrl(supabase, result.url);
      if (completion.error) throw completion.error;
      await fetchIdentities();
    }
    // 'cancel' / 'dismiss' — user backed out; no error surfaced
  }, [fetchIdentities]);

  // ─── linkProvider (public) ────────────────────────────────────────────────

  const linkProvider = useCallback(
    async (provider: ProviderType) => {
      if (!session?.user?.id) {
        setState(prev => ({ ...prev, error: 'You must be signed in to link providers.' }));
        return;
      }
      if (isProviderLinked(provider)) {
        setState(prev => ({ ...prev, error: `${provider} is already linked to your account.` }));
        return;
      }
      if (provider !== 'google' && provider !== 'apple') {
        setState(prev => ({ ...prev, error: `Use the dedicated form to link ${provider}.` }));
        return;
      }

      setState(prev => ({ ...prev, isLinking: true, linkingProvider: provider, error: null }));
      try {
        if (provider === 'apple') {
          await linkAppleNative();
        } else {
          await linkGoogleBrowser();
        }
        setState(prev => ({ ...prev, isLinking: false, linkingProvider: null }));
      } catch (err) {
        // Swallow Apple cancellation silently
        if ((err as any)?.code === 'ERR_REQUEST_CANCELED') {
          setState(prev => ({ ...prev, isLinking: false, linkingProvider: null }));
          return;
        }
        setState(prev => ({
          ...prev,
          isLinking: false,
          linkingProvider: null,
          error: err instanceof Error ? err.message : `Failed to link ${provider}.`,
        }));
      }
    },
    [session?.user?.id, isProviderLinked, linkAppleNative, linkGoogleBrowser],
  );

  // ─── unlinkProvider ───────────────────────────────────────────────────────

  const unlinkProvider = useCallback(
    async (provider: ProviderType) => {
      if (!session?.user?.id) throw new Error('You must be signed in to unlink a method.');

      if (state.identities.length < 2) {
        throw new Error(
          'You cannot remove your last sign-in method. Add another method first.',
        );
      }

      const rawIdentity = rawIdentitiesRef.current.find(i => i.provider === provider);
      if (!rawIdentity) throw new Error(`${provider} is not linked to your account.`);

      setState(prev => ({ ...prev, isLinking: true, linkingProvider: provider, error: null }));
      try {
        const { error } = await supabase.auth.unlinkIdentity(rawIdentity);
        if (error) throw new Error(mapIdentityLinkingError(error, provider));
        await fetchIdentities();
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to unlink ${provider}.`;
        setState(prev => ({ ...prev, error: message }));
        throw err;
      } finally {
        setState(prev => ({ ...prev, isLinking: false, linkingProvider: null }));
      }
    },
    [session?.user?.id, state.identities.length, fetchIdentities],
  );

  // ─── Email: Case A — add password to existing email account ───────────────

  const addPasswordToAccount = useCallback(
    async (password: string): Promise<void> => {
      if (!session?.user?.id) throw new Error('You must be signed in.');
      if (!session.user.email) {
        throw new Error('No email on this account. Add an email address first.');
      }

      setState(prev => ({ ...prev, isLinking: true, linkingProvider: 'email', error: null }));
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(mapIdentityLinkingError(error, 'email'));
        await fetchIdentities();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to set password.';
        setState(prev => ({ ...prev, error: message }));
        throw err;
      } finally {
        setState(prev => ({ ...prev, isLinking: false, linkingProvider: null }));
      }
    },
    [session?.user?.id, session?.user?.email, fetchIdentities],
  );

  // ─── Email: Case B — add/change email address ─────────────────────────────

  const linkNewEmail = useCallback(
    async (email: string): Promise<{ confirmationRequired: true }> => {
      if (!session?.user?.id) throw new Error('You must be signed in.');

      setState(prev => ({ ...prev, isLinking: true, linkingProvider: 'email', error: null }));
      try {
        const { error } = await supabase.auth.updateUser({ email });
        if (error) throw new Error(mapIdentityLinkingError(error, 'email'));
        return { confirmationRequired: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add email.';
        setState(prev => ({ ...prev, error: message }));
        throw err;
      } finally {
        setState(prev => ({ ...prev, isLinking: false, linkingProvider: null }));
      }
    },
    [session?.user?.id],
  );

  // ─── Phone linking (OTP-only) ─────────────────────────────────────────────

  const linkPhone = useCallback(
    async (phone: string): Promise<{ otpSent: true }> => {
      if (!session?.user?.id) throw new Error('You must be signed in.');

      setState(prev => ({ ...prev, isLinking: true, linkingProvider: 'phone', error: null }));
      try {
        const { error } = await supabase.auth.updateUser({ phone });
        if (error) throw new Error(mapIdentityLinkingError(error, 'phone'));
        return { otpSent: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send verification code.';
        setState(prev => ({ ...prev, error: message, isLinking: false, linkingProvider: null }));
        throw err;
      }
    },
    [session?.user?.id],
  );

  const verifyPhoneLink = useCallback(
    async (phone: string, token: string): Promise<void> => {
      try {
        const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'phone_change' });
        if (error) throw new Error(mapIdentityLinkingError(error, 'phone'));
        await fetchIdentities();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Phone verification failed.';
        setState(prev => ({ ...prev, error: message }));
        throw err;
      } finally {
        setState(prev => ({ ...prev, isLinking: false, linkingProvider: null }));
      }
    },
    [fetchIdentities],
  );

  const cancelPhoneLink = useCallback(() => {
    setState(prev => ({ ...prev, isLinking: false, linkingProvider: null, error: null }));
  }, []);

  // ─── computed ─────────────────────────────────────────────────────────────

  const hasGoogle = state.identities.some(i => i.provider === 'google');
  const hasApple = state.identities.some(i => i.provider === 'apple');
  const hasEmail = state.identities.some(i => i.provider === 'email');
  const hasPhone = state.identities.some(i => i.provider === 'phone');
  const linkedCount = state.identities.length;

  const sessionEmail = session?.user?.email ?? null;
  const sessionPhone = session?.user?.phone ?? null;

  return {
    ...state,
    hasGoogle,
    hasApple,
    hasEmail,
    hasPhone,
    linkedCount,
    canRemoveMethod,
    canUnlinkProvider,
    sessionEmail,
    sessionPhone,
    fetchIdentities,
    isProviderLinked,
    linkProvider,
    unlinkProvider,
    addPasswordToAccount,
    linkNewEmail,
    linkPhone,
    verifyPhoneLink,
    cancelPhoneLink,
  };
}
