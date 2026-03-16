import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { border, layout, radius, spacing } from '@/constants/theme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const tabBarContentHeight =
    Platform.OS === 'ios' ? layout.tabBarContentHeightIos : layout.tabBarContentHeightAndroid;
  const tabBarHeight = tabBarContentHeight + insets.bottom;
  const paddingBottom = Platform.OS === 'ios' ? insets.bottom : Math.max(insets.bottom, layout.tabBarPaddingBottomAndroid);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.tabIconDefault,
        tabBarActiveBackgroundColor: theme.tintSoft,
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarStyle: {
          backgroundColor: theme.glassSurface,
          borderTopColor: theme.glassBorder,
          borderTopWidth: border.width.thin,
          height: tabBarHeight,
          paddingBottom,
          paddingTop: layout.tabBarPaddingTop,
          shadowColor: theme.tint,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          elevation: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          paddingVertical: spacing.xs,
          borderRadius: radius.xl,
          marginHorizontal: 3,
          ...(Platform.OS === 'android' && { minHeight: layout.minTouchTargetSize }),
        },
        tabBarIconStyle: { marginBottom: -2 },
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'house', android: 'home', web: 'home' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'list.bullet', android: 'list', web: 'list' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'person.circle', android: 'person', web: 'person' }} tintColor={color} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}
