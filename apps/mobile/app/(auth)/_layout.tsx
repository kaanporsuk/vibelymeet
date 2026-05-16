import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

/**
 * Auth stack: no default header — sign-in and reset-password each render their own Vibely screen UI (title + form).
 * Root layout also uses headerShown: false for (auth) so no "(auth)" or duplicate header leaks.
 */
export default function AuthLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
