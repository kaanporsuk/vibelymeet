/**
 * useIdentityLinking.ts (Native)
 *
 * React Native/Expo version of Supabase manual identity linking hook.
 * Fetches user's linked identities and handles linking/unlinking flows.
 */

import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import {
  completeSessionFromAuthReturnUrl,
  getNativeGoogleOAuthRedirectUrl,
} from '@/lib/nativeAuthRedirect';

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

      const identities: LinkedIdentity[] = ((data?.identities || []) as RawIdentity[]).map((identity) => ({
        provider: identity.provider as ProviderType,
        user_id: identity.user_id,
        identity_id: identity.id,
        identity_data: identity.identity_data,
      }));

      // Add primary auth method
      if (session.user.email && !identities.find(i => i.provider === 'email')) {
        identities.push({
          provider: 'email',
          user_id: session.user.id,
          identity_id: `email-${session.user.id}`,
          identity_data: { email: session.user.email },
        });
      }

      if (session.user.phone && !identities.find(i => i.provider === 'phone')) {
        identities.push({
          provider: 'phone',
          user_id: session.user.id,
          identity_id: `phone-${session.user.id}`,
          identity_data: { phone: session.user.phone },
        });
      }

      setState(prev => ({
        ...prev,
        identities,
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
  }, [session?.user?.id, session?.user?.identities, session?.user?.email, session?.user?.phone]);

  // Initial fetch on mount
  useEffect(() => {
    fetchIdentities();
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

        const redirectUrl = `${getNativeGoogleOAuthRedirectUrl()}?linking=true&provider=${provider}`;
        const { data, error } = await supabase.auth.linkIdentity({
          provider: provider as OAuthLinkProvider,
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true,
          },
        });

        if (error) throw error;
        if (!data?.url) throw new Error(`Failed to start ${provider} linking.`);

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

        if (result.type === 'success' && result.url) {
          const completion = await completeSessionFromAuthReturnUrl(supabase, result.url);
          if (completion.error) throw completion.error;

          await fetchIdentities();
          setState(prev => ({
            ...prev,
            isLinking: false,
            linkingProvider: null,
          }));
        } else if (result.type === 'cancel') {
          setState(prev => ({
            ...prev,
            isLinking: false,
            linkingProvider: null,
          }));
        }
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
    [session?.user?.id, isProviderLinked, fetchIdentities]
  );

  return {
    ...state,
    fetchIdentities,
    linkProvider,
    isProviderLinked,
  };
}
