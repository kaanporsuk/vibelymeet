import { Stack } from 'expo-router';

/**
 * Auth stack: no default header — sign-in/sign-up/reset-password each render their own Vibely screen UI (title + form).
 * Root layout also uses headerShown: false for (auth) so no "(auth)" or duplicate header leaks.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
