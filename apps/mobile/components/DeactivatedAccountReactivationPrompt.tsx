/**
 * After login, if profile.account_paused (deactivate / break), offer one reactivation prompt per session.
 */
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export function DeactivatedAccountReactivationPrompt() {
  const { user } = useAuth();
  const qc = useQueryClient();
  /** Cleared on logout; reset in effect cleanup so React Strict Mode remount can run again. */
  const reactivationHandledRef = useRef(false);

  useEffect(() => {
    if (!user?.id) {
      reactivationHandledRef.current = false;
      return;
    }

    let cancelled = false;
    const userId = user.id;

    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled || reactivationHandledRef.current) return;
        reactivationHandledRef.current = true;

        const { data, error } = await supabase
          .from('profiles')
          .select('account_paused, name')
          .eq('id', userId)
          .maybeSingle();

        if (cancelled) {
          reactivationHandledRef.current = false;
          return;
        }
        if (error) {
          reactivationHandledRef.current = false;
          return;
        }

        if (!data?.account_paused) return;

        const firstName = (data.name as string | null)?.trim()?.split(/\s+/)[0] ?? 'there';

        Alert.alert(
          `Welcome back, ${firstName}!`,
          'Your account is currently deactivated. Would you like to reactivate and appear in discovery again?',
          [
            { text: 'Stay deactivated', style: 'cancel' },
            {
              text: 'Reactivate',
              onPress: async () => {
                const { error: upErr } = await supabase
                  .from('profiles')
                  .update({
                    account_paused: false,
                    account_paused_until: null,
                    discoverable: true,
                    discovery_mode: 'visible',
                    is_paused: false,
                    paused_until: null,
                    paused_at: null,
                  })
                  .eq('id', userId);
                if (upErr) {
                  Alert.alert('Couldn’t reactivate', upErr.message);
                  return;
                }
                await qc.invalidateQueries({ queryKey: ['my-profile'] });
                await qc.invalidateQueries({ queryKey: ['profile-account', userId] });
                await qc.invalidateQueries({ queryKey: ['privacy-profile', userId] });
              },
            },
          ]
        );
      })();
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      reactivationHandledRef.current = false;
    };
  }, [user?.id, qc]);

  return null;
}
