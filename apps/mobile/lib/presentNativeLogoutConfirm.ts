import type { VibelyDialogShowConfig } from '@/components/VibelyDialog';

export type NativeLogoutShow = (config: VibelyDialogShowConfig) => void;

/**
 * Single confirmation UX for every native “Log out” entry point (You tab, Account & Security).
 */
export function presentNativeLogoutConfirm(show: NativeLogoutShow, logout: () => Promise<void>): void {
  show({
    title: 'Log out?',
    message: 'You’ll need to sign back in to use Vibely.',
    variant: 'destructive',
    primaryAction: {
      label: 'Log out',
      onPress: () => {
        void logout().catch((err) => {
          if (__DEV__) console.warn('[nativeLogout] sign-out flow failed:', err);
        });
      },
    },
    secondaryAction: { label: 'Stay', onPress: () => {} },
  });
}
