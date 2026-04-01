import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';

/**
 * Canonical native logout: AuthContext clears the Supabase session, OneSignal, pause keys,
 * and best-effort notification_preferences; then we drop React Query cache and reset navigation
 * to sign-in so protected screens are not left visible or reachable via back.
 *
 * Avoid `router.dismissAll()`: from tab roots (e.g. Profile Studio) it dispatches POP_TO_TOP with
 * no handling navigator and triggers a React Navigation warning.
 */
export function useNativeLogout() {
  const { signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await signOut();
    queryClient.clear();
    router.replace('/(auth)/sign-in');
  }, [signOut, queryClient, router]);
}
