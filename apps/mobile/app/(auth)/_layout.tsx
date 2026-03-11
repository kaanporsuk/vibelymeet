import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="sign-up" options={{ title: 'Sign up' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Reset password' }} />
    </Stack>
  );
}
