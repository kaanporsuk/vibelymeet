import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';

type Props = {
  unseenCount: number;
  urgentUnseenCount: number;
  pushSetupNeeded: boolean;
  onPress: () => void;
};

export function NotificationBell({ unseenCount, urgentUnseenCount, pushSetupNeeded, onPress }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const hasUnseen = unseenCount > 0;
  const hasUrgent = urgentUnseenCount > 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: hasUnseen ? withAlpha(theme.tint, 0.16) : theme.glassSurface,
          borderColor: hasUnseen ? withAlpha(theme.tint, 0.35) : theme.glassBorder,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      accessibilityLabel="Open notifications"
      accessibilityRole="button"
    >
      {hasUrgent ? <View style={[styles.urgentRing, { borderColor: theme.accent }]} /> : null}
      <Ionicons name={hasUnseen ? 'notifications' : 'notifications-outline'} size={22} color={hasUnseen ? theme.tint : theme.text} />
      {hasUnseen ? (
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <Text style={styles.badgeText}>{unseenCount > 9 ? '9+' : String(unseenCount)}</Text>
        </View>
      ) : pushSetupNeeded ? (
        <View style={[styles.setupDot, { backgroundColor: theme.neonYellow, borderColor: theme.background }]} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentRing: {
    position: 'absolute',
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderRadius: 22,
    borderWidth: 1,
    opacity: 0.75,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  setupDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1,
  },
});
