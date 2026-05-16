import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function EventsLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />;
}
