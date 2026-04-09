/**
 * useIdentityLinking.ts (Web)
 *
 * Manages Supabase identity linking for a signed-in Vibely user.
 *
 * SUPPORTED METHODS
 * ─────────────────
 * • Google / Apple  → supabase.auth.linkIdentity() (OAuth redirect, browser-based)
 * • Email+password  → two distinct flows depending on session state:
 *     A. Session already has an email (OAuth user) → addPasswordToAccount(password)
 *        Uses updateUser({ password }). No email change, no confirmation email.
 *     B. No session email (phone-only user)        → linkNewEmail(email)
 *        Uses updateUser({ email }). Sends confirmation email; password can be set after.
 * • Phone           → linkPhone(phone) + verifyPhoneLink(phone, token)
 *        Uses updateUser({ phone }) + verifyOtp({ type: 'phone_change' }).
 *        Phone sign-in is OTP-only; no phone+password is implemented.
 *
 * REMOVAL
 * ───────
 * supabase.auth.unlinkIdentity() is available. A user may unlink any identity as long
 * as at least one other identity remains (prevents orphaned accounts).
 * canRemoveMethod is computed from the live identity count.
 *
 * SECURITY INVARIANTS
 * ───────────────────
 * • All mutations require an active session — never called unauthenticated.
 * • linkIdentity() is used for OAuth, never signInWithOAuth() — prevents second-account creation.
 * • updateUser() edits the existing auth.users row — never creates a new account.
 * • Cross-account conflicts are surfaced via mapIdentityLinkingError(); no silent merge.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { mapIdentityLinkingError } from '@shared/authConflictMessages';

// ---------- types ----------

export type ProviderType = 'google' | 'apple' | 'email' | 'phone';
type OAuthLinkProvider = Extract<ProviderType, 'google' | 'apple'>;

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

      // Cache raw objects for unlinkIdentity()
      rawIdentitiesRef.current = data?.identities ?? [];

      const linked: LinkedIdentity[] = (data?.identities ?? []).map(i => ({
        provider: i.provider as ProviderType,
        user_id: i.user_id,
        identity_id: i.identity_id,
        identity_data: i.identity_data as LinkedIdentity['identity_data'],
      }));

      // Extend with session-level email/phone if not yet in the identities list.
      // These appear when email/phone is set on auth.users but not (yet) confirmed.
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
  }, [session?.user?.id, session?.user?.email, session?.user?.phone]);

  useEffect(() => { fetchIdentities(); }, [fetchIdentities]);

  // Handle OAuth linking return (web only): ?linking=true in URL after redirect.
  useEffect(() => {
    const finish = async () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get('linking') !== 'true') return;

      const code = url.searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) setState(prev => ({ ...prev, error: error.message }));
        }
      }

      await fetchIdentities();

      ['linking', 'provider', 'code', 'error', 'error_code', 'error_description', 'state']
        .forEach(p => url.searchParams.delete(p));
      window.history.replaceState({}, document.title, url.toString());
    };
    void finish();
  }, [fetchIdentities]);

  // ─── read helpers ─────────────────────────────────────────────────────────

  const isProviderLinked = useCallback(
    (provider: ProviderType) => state.identities.some(i => i.provider === provider),
    [state.identities],
  );

  // canRemoveMethod: true when 2+ identities are linked (unlink one still leaves at least one).
  const canRemoveMethod = state.identities.length >= 2;

  const canUnlinkProvider = useCallback(
    (provider: ProviderType) => state.identities.length >= 2 && isProviderLinked(provider),
    [state.identities.length, isProviderLinked],
  );

  // ─── OAuth linking (Google / Apple) ───────────────────────────────────────

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

      try {
        setState(prev => ({ ...prev, isLinking: true, linkingProvider: provider, error: null }));

        const redirectUrl = new URL(window.location.href);
        redirectUrl.searchParams.set('linking', 'true');
        redirectUrl.searchParams.set('provider', provider);

        const { error } = await supabase.auth.linkIdentity({
          provider: provider as OAuthLinkProvider,
          options: {
            redirectTo: redirectUrl.toString(),
            queryParams: { access_type: 'offline', prompt: 'consent' },
          },
        });
        if (error) throw error;
        // Page will redirect; isLinking stays true until the component unmounts.
      } catch (err) {
        setState(prev => ({
          ...prev,
          isLinking: false,
          linkingProvider: null,
          error: mapIdentityLinkingError(err, provider as OAuthLinkProvider),
        }));
      }
    },
    [session?.user?.id, isProviderLinked],
  );

  // ─── OAuth unlinking ───────────────────────────────────────────────────────

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
  //
  // Use when session.user.email is already set (OAuth user, or email user without password).
  // updateUser({ password }) sets the password without touching the email identity or
  // sending any confirmation email. The user can immediately sign in with existing email + password.

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
  //
  // Use when the account has no email, or the user wants to add a different email.
  // updateUser({ email }) initiates an email-change flow; Supabase sends a confirmation link.
  // The email identity is not usable for sign-in until the link is clicked.
  // Password sign-in requires a password to be separately set (via addPasswordToAccount).

  const linkNewEmail = useCallback(
    async (email: string): Promise<{ confirmationRequired: true }> => {
      if (!session?.user?.id) throw new Error('You must be signed in.');

      setState(prev => ({ ...prev, isLinking: true, linkingProvider: 'email', error: null }));
      try {
        const { error } = await supabase.auth.updateUser({ email });
        if (error) throw new Error(mapIdentityLinkingError(error, 'email'));
        // Don't fetchIdentities() yet — identity only appears after email confirmation.
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

  // ─── Phone linking ────────────────────────────────────────────────────────
  //
  // Phone sign-in is OTP-only. There is no phone+password mode in Vibely.
  // updateUser({ phone }) sends an OTP to the new number.
  // verifyPhoneLink() completes the flow via type: 'phone_change'.

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
      // isLinking stays true until verifyPhoneLink completes or the user cancels.
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

  // Expose the session email/phone so UI can branch without importing useAuth separately.
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
