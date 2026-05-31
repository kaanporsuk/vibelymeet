import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { radius, spacing } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';

type PermissionRecoveryCardProps = {
  title: string;
  message: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  primaryLabel: string;
  onPrimaryPress: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  fallbackLabel?: string;
  onFallbackPress?: () => void;
  loading?: boolean;
  testID?: string;
};

export function PermissionRecoveryCard({
  title,
  message,
  icon = 'lock-open-outline',
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
  fallbackLabel,
  onFallbackPress,
  loading,
  testID,
}: PermissionRecoveryCardProps) {
  const theme = Colors[useColorScheme()];
  const { width } = useWindowDimensions();
  const availableWidth = Math.max(0, width - 32);
  const cardWidth = Math.min(availableWidth > 0 ? availableWidth : 280, 380);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          width: cardWidth,
          backgroundColor: theme.glassSurface,
          borderColor: withAlpha(theme.tint, 0.28),
        },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
        <Ionicons name={icon} size={28} color={theme.tint} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>

      <Pressable
        onPress={onPrimaryPress}
        disabled={loading}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.tint },
          (pressed || loading) && { opacity: 0.86 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
            {primaryLabel}
          </Text>
        )}
      </Pressable>

      {fallbackLabel && onFallbackPress ? (
        <Pressable
          onPress={onFallbackPress}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: withAlpha(theme.tint, 0.1), borderColor: withAlpha(theme.tint, 0.2) },
            pressed && { opacity: 0.82 },
          ]}
        >
          <Text
            style={[styles.secondaryLabel, { color: theme.tint }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {fallbackLabel}
          </Text>
        </Pressable>
      ) : null}

      {secondaryLabel && onSecondaryPress ? (
        <Pressable
          onPress={onSecondaryPress}
          hitSlop={12}
          accessibilityRole="button"
          style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.65 }]}
        >
          <Text
            style={[styles.textButtonLabel, { color: theme.textSecondary }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {secondaryLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.3,
        shadowRadius: 28,
      },
      android: { elevation: 16 },
    }),
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: spacing.lg,
    minHeight: 48,
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 46,
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  textButton: {
    marginTop: spacing.sm,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  textButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
});
