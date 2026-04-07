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
      <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
      <Stack.Screen name="discovery" options={{ title: 'Discovery' }} />
      <Stack.Screen name="blocked-users" options={{ title: 'Blocked users' }} />
      <Stack.Screen name="support" options={{ title: 'Support & Feedback' }} />
      <Stack.Screen name="safety-center" options={{ title: 'Safety Center' }} />
      <Stack.Screen name="submit-ticket" options={{ title: 'New request' }} />
      <Stack.Screen name="ticket-submitted" options={{ title: 'Request sent' }} />
      <Stack.Screen name="ticket/[id]" options={{ title: 'Request' }} />
    </Stack>
  );
}
