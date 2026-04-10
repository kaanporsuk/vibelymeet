/**
 * Vibely Neon Noir recovery UI when system push permission is off (not the OS sheet).
 * Used from home push prompt, onboarding, and notification settings.
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, fonts } from '@/constants/theme';

export const NOTIFICATION_DENIED_RECOVERY_TITLE = 'Turn notifications back on';

export const NOTIFICATION_DENIED_RECOVERY_BODY =
  "Notifications are off for Vibely. Re-enable them in Settings so you don't miss matches, messages, and date activity.";

type NotificationDeniedRecoverySurfaceProps = {
  onOpenSettings: () => void;
  /** When set, shows secondary “Not now” (e.g. close parent modal). Omit on persistent inline surfaces. */
  onDismiss?: () => void;
  compact?: boolean;
};

export function NotificationDeniedRecoverySurface({
  onOpenSettings,
  onDismiss,
  compact,
}: NotificationDeniedRecoverySurfaceProps) {
  const theme = Colors[useColorScheme()];
  const { width } = useWindowDimensions();
  const maxW = compact ? undefined : Math.min(width - 32, 400);
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const borderColor = withAlpha(theme.tint, 0.42);

  return (
    <View
      style={[
        styles.surface,
        {
          maxWidth: maxW,
          width: maxW ? '100%' : undefined,
          alignSelf: maxW ? 'center' : 'stretch',
          backgroundColor: theme.glassSurface,
          borderColor: borderColor,
        },
      ]}
    >
      <View style={styles.iconRow}>
        <View style={styles.iconWrap}>
          <Animated.View
            style={[
              styles.glow,
              {
                opacity: pulse,
                shadowColor: theme.tint,
                backgroundColor: withAlpha(theme.tint, 0.2),
              },
            ]}
          />
          <LinearGradient
            colors={[withAlpha(theme.tint, 0.35), withAlpha(theme.accent, 0.28)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconDisk}
          >
            <Ionicons name="notifications-off" size={26} color={theme.text} />
          </LinearGradient>
        </View>
      </View>

      <Text
        style={[
          styles.title,
          { color: theme.text, fontFamily: fonts.displayBold, fontSize: compact ? 19 : 20 },
        ]}
      >
        {NOTIFICATION_DENIED_RECOVERY_TITLE}
      </Text>
      <Text style={[styles.body, { color: theme.mutedForeground }]}>{NOTIFICATION_DENIED_RECOVERY_BODY}</Text>

      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [styles.primaryWrap, pressed && { opacity: 0.92 }]}
      >
        <LinearGradient
          colors={[theme.tint, theme.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.primaryBtn}
        >
          <Text style={styles.primaryLabel}>Open Settings</Text>
        </LinearGradient>
      </Pressable>

      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={({ pressed }) => [styles.secondaryWrap, pressed && { opacity: 0.65 }]}
        >
          <Text style={[styles.secondaryLabel, { color: theme.mutedForeground }]}>Not now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg + 2,
    paddingBottom: spacing.lg,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.4,
        shadowRadius: 24,
      },
      android: { elevation: 14 },
    }),
  },
  iconRow: { alignItems: 'center', marginBottom: spacing.md },
  iconWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 16,
    elevation: 8,
  },
  iconDisk: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.35,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  primaryWrap: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: 'hsl(263, 70%, 50%)',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.32,
        shadowRadius: 10,
      },
      android: { elevation: 5 },
    }),
  },
  primaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryWrap: {
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});

type NotificationDeniedRecoveryModalProps = {
  visible: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
};

/** Full-screen overlay using the same Neon Noir surface as inline recovery (home / onboarding). */
export function NotificationDeniedRecoveryModal({
  visible,
  onClose,
  onOpenSettings,
}: NotificationDeniedRecoveryModalProps) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 40, 400);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={recoveryModalStyles.root}>
        <BlurView intensity={Platform.OS === 'ios' ? 88 : 72} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={recoveryModalStyles.dim} pointerEvents="none" />
        <View style={{ width: cardWidth, alignSelf: 'center' }}>
          <NotificationDeniedRecoverySurface onOpenSettings={onOpenSettings} onDismiss={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const recoveryModalStyles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
});
