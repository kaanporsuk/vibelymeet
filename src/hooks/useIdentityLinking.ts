/**
 * useIdentityLinking.ts
 *
 * Shared hook for managing Supabase manual identity linking.
 * Fetches user's linked identities and handles linking/unlinking flows.
 *
 * Note: Unlinking is not supported per Supabase policy; users must use account deletion.
 */

import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export type ProviderType = 'google' | 'apple' | 'email' | 'phone';
type OAuthLinkProvider = Extract<ProviderType, 'google' | 'apple'>;

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

type RawIdentity = {
  provider: string;
  user_id: string;
  id: string;
  identity_data?: LinkedIdentity['identity_data'];
};

export interface IdentityLinkingState {
  identities: LinkedIdentity[];
  isLoading: boolean;
  error: string | null;
  isLinking: boolean;
  linkingProvider: ProviderType | null;
}

export function useIdentityLinking() {
  const { session } = useAuth();
  const [state, setState] = useState<IdentityLinkingState>({
    identities: [],
    isLoading: true,
    error: null,
    isLinking: false,
    linkingProvider: null,
  });

  // Fetch current identities
  const fetchIdentities = useCallback(async () => {
    if (!session?.user?.id) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const { data, error } = await supabase.auth.getUserIdentities();

      if (error) throw error;

      const linkedIdentities = ((data?.identities || []) as RawIdentity[]).map((identity) => ({
        provider: identity.provider as ProviderType,
        user_id: identity.user_id,
        identity_id: identity.id,
        identity_data: identity.identity_data,
      }));

      // Keep provider state resilient when provider claims are present on session user.
      if (session.user.email && !linkedIdentities.some(i => i.provider === 'email')) {
        linkedIdentities.push({
          provider: 'email',
          user_id: session.user.id,
          identity_id: `email-${session.user.id}`,
          identity_data: { email: session.user.email },
        });
      }
      if (session.user.phone && !linkedIdentities.some(i => i.provider === 'phone')) {
        linkedIdentities.push({
          provider: 'phone',
          user_id: session.user.id,
          identity_id: `phone-${session.user.id}`,
          identity_data: { phone: session.user.phone },
        });
      }

      setState(prev => ({
        ...prev,
        identities: linkedIdentities,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch identities';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, [session?.user?.id, session?.user?.email, session?.user?.phone]);

  // Initial fetch on mount
  useEffect(() => {
    fetchIdentities();
  }, [fetchIdentities]);

  // Complete manual-link callback and normalize URL on return.
  useEffect(() => {
    const finishLinkCallback = async () => {
      const currentUrl = new URL(window.location.href);
      const isLinkingReturn = currentUrl.searchParams.get('linking') === 'true';
      if (!isLinkingReturn) return;

      const code = currentUrl.searchParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            setState(prev => ({
              ...prev,
              error: error.message,
            }));
          }
        }
      }

      await fetchIdentities();

      [
        'linking',
        'provider',
        'code',
        'error',
        'error_code',
        'error_description',
        'state',
      ].forEach(param => currentUrl.searchParams.delete(param));
      window.history.replaceState({}, document.title, currentUrl.toString());
    };

    void finishLinkCallback();
  }, [fetchIdentities]);

  // Check if a provider is linked
  const isProviderLinked = useCallback(
    (provider: ProviderType): boolean => {
      return state.identities.some(id => id.provider === provider);
    },
    [state.identities]
  );

  // Initiate provider linking via OAuth
  const linkProvider = useCallback(
    async (provider: ProviderType) => {
      if (!session?.user?.id) {
        setState(prev => ({
          ...prev,
          error: 'You must be signed in to link providers.',
        }));
        return;
      }

      if (isProviderLinked(provider)) {
        setState(prev => ({
          ...prev,
          error: `${provider} is already linked to your account.`,
        }));
        return;
      }

      if (provider !== 'google' && provider !== 'apple') {
        setState(prev => ({
          ...prev,
          error: `${provider} linking is not supported in this flow.`,
        }));
        return;
      }

      try {
        setState(prev => ({
          ...prev,
          isLinking: true,
          linkingProvider: provider,
          error: null,
        }));

        const redirectUrl = new URL(window.location.href);
        redirectUrl.searchParams.set('linking', 'true');
        redirectUrl.searchParams.set('provider', provider);

        // Use Supabase manual identity linking API (not sign-in OAuth).
        const { error } = await supabase.auth.linkIdentity({
          provider: provider as OAuthLinkProvider,
          options: {
            redirectTo: redirectUrl.toString(),
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
          },
        });

        if (error) throw error;
      } catch (err) {
        const message = err instanceof Error ? err.message : `Failed to link ${provider}`;
        setState(prev => ({
          ...prev,
          isLinking: false,
          linkingProvider: null,
          error: message,
        }));
      }
    },
    [session?.user?.id, isProviderLinked]
  );

  return {
    ...state,
    fetchIdentities,
    linkProvider,
    isProviderLinked,
  };
}
