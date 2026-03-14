/**
 * Settings stack: main list (index), Notifications, Credits, Account.
 */
import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="credits" options={{ title: 'Video Date Credits' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
    </Stack>
  );
}
