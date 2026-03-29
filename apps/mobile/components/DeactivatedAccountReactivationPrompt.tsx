/**
 * After login, if profile.account_paused (deactivate / break), offer one reactivation prompt per session.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useVibelyDialog } from '@/components/VibelyDialog';

export function DeactivatedAccountReactivationPrompt() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { show, dialog } = useVibelyDialog();
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

        show({
          title: `Welcome back, ${firstName}!`,
          message: 'Your account is paused. Want to show up in discovery again?',
          variant: 'info',
          primaryAction: {
            label: 'Reactivate',
            onPress: () => {
              void (async () => {
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
                    pause_reason: null,
                  })
                  .eq('id', userId);
                if (upErr) {
                  show({
                    title: 'Couldn’t reactivate',
                    message: upErr.message,
                    variant: 'warning',
                    primaryAction: { label: 'OK', onPress: () => {} },
                  });
                  return;
                }
                await qc.invalidateQueries({ queryKey: ['my-profile'] });
                await qc.invalidateQueries({ queryKey: ['account-pause-status'] });
                await qc.invalidateQueries({ queryKey: ['profile-account', userId] });
                await qc.invalidateQueries({ queryKey: ['privacy-profile', userId] });
              })();
            },
          },
          secondaryAction: { label: 'Stay paused', onPress: () => {} },
        });
      })();
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      reactivationHandledRef.current = false;
    };
  }, [user?.id, qc, show]);

  return <>{dialog}</>;
}
