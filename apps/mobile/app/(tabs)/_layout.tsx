import { Tabs } from 'expo-router';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useDailyDropTabBadge } from '@/lib/useDailyDropTabBadge';
import { withAlpha } from '@/lib/colorUtils';

const TAB_CONFIG = [
  { name: 'index' as const, label: 'Now', iconDefault: 'flash-outline' as const, iconActive: 'flash' as const },
  { name: 'events' as const, label: 'Events', iconDefault: 'calendar-outline' as const, iconActive: 'calendar' as const },
  { name: 'matches' as const, label: 'Vibe', iconDefault: 'heart-circle-outline' as const, iconActive: 'heart-circle' as const },
  { name: 'profile' as const, label: 'You', iconDefault: 'person-circle-outline' as const, iconActive: 'person-circle' as const },
];

function VibelyTabBar({ state, navigation }: BottomTabBarProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const dropBadge = useDailyDropTabBadge(user?.id);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unread-message-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .neq('sender_id', user.id)
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });

  return (
    <View style={[tabBarStyles.dockOuter, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View
        style={[
          tabBarStyles.dockContainer,
          { backgroundColor: 'rgba(10, 10, 18, 0.88)', borderColor: 'rgba(255, 255, 255, 0.06)' },
        ]}
      >
        {TAB_CONFIG.map((config) => {
          const route = state.routes.find((r) => r.name === config.name);
          if (!route) return null;

          const focused = state.routes[state.index]?.name === config.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          let badge: number | null = null;
          if (config.name === 'matches' && unreadCount > 0) badge = unreadCount;

          const showLiveDot = config.name === 'index' && dropBadge;

          return (
            <Pressable key={route.key} onPress={onPress} style={tabBarStyles.tabItem} accessibilityRole="tab" accessibilityState={{ selected: focused }}>
              {focused ? (
                <View style={[tabBarStyles.activeCapsule, { backgroundColor: withAlpha(theme.tint, 0.14) }]} />
              ) : null}

              <View style={tabBarStyles.tabContent}>
                <View style={{ position: 'relative' }}>
                  <Ionicons
                    name={(focused ? config.iconActive : config.iconDefault) as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={focused ? theme.tint : 'rgba(255, 255, 255, 0.45)'}
                  />

                  {badge !== null && badge > 0 ? (
                    <View style={tabBarStyles.badge}>
                      <Text style={tabBarStyles.badgeText}>{badge > 99 ? '99+' : String(badge)}</Text>
                    </View>
                  ) : null}

                  {showLiveDot ? <View style={tabBarStyles.liveDot} /> : null}
                </View>

                <Text
                  style={[
                    tabBarStyles.tabLabel,
                    { color: focused ? theme.tint : 'rgba(255, 255, 255, 0.4)' },
                    focused && { fontWeight: '600' },
                  ]}
                >
                  {config.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const tabBarStyles = StyleSheet.create({
  dockOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dockContainer: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 560,
    borderRadius: 28,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    position: 'relative',
  },
  activeCapsule: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 8,
    right: 8,
    borderRadius: 18,
  },
  tabContent: {
    alignItems: 'center',
    gap: 3,
    zIndex: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#E84393',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  liveDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#00CEC9',
    borderWidth: 1.5,
    borderColor: 'rgba(10, 10, 18, 0.88)',
  },
});

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <VibelyTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Now' }} />
      <Tabs.Screen name="events" options={{ title: 'Events' }} />
      <Tabs.Screen name="matches" options={{ title: 'Vibe' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}
