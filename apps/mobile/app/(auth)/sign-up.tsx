import { useEffect } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function SignUpRedirectScreen() {
  const theme = Colors[useColorScheme()];
  useEffect(() => {
    router.replace('/(auth)/sign-in');
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.tint} />
    </View>
  );
}
