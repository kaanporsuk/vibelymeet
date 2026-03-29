import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { button, fonts, gradient, layout, radius, spacing, typography } from '@/constants/theme';

/** Deeper than sheets — floats above settings without looking washed out. */
const MODAL_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.28,
  shadowRadius: 22,
  elevation: 10,
} as const;

const CARD_RADIUS = radius['3xl'];
const GUTTER_MIN = layout.screenPadding.default;
const INNER_PADDING = spacing.xl;
const TOP_ACCENT_HEIGHT = 3;
const WARNING_AMBER = '#f59e0b';
const PRIMARY_MIN_HEIGHT = Math.max(button.height.default, 48);

const BACKDROP_TINT = 'rgba(4,5,12,0.72)';

export type StatusDialogVariant = 'info' | 'success' | 'warning' | 'error';

export type StatusDialogProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  variant?: StatusDialogVariant;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Called when the user dismisses via backdrop (only when `backdropDismissible` is true). */
  onDismiss?: () => void;
  icon?: ReactNode;
  /**
   * When true, tapping the dimmed backdrop closes the dialog.
   * Defaults to true for `info` and `success`, false for `warning` and `error`.
   */
  backdropDismissible?: boolean;
};

function defaultIconName(variant: StatusDialogVariant): keyof typeof Ionicons.glyphMap {
  switch (variant) {
    case 'success':
      return 'checkmark-circle';
    case 'warning':
      return 'alert-circle-outline';
    case 'error':
      return 'close-circle-outline';
    default:
      return 'information-circle-outline';
  }
}

function useDefaultBackdropDismissible(
  variant: StatusDialogVariant,
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit;
  return variant === 'info' || variant === 'success';
}

export function StatusDialog({
  visible,
  onClose,
  title,
  message,
  variant = 'info',
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  onDismiss,
  icon,
  backdropDismissible: backdropDismissibleProp,
}: StatusDialogProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const backdropDismissible = useDefaultBackdropDismissible(variant, backdropDismissibleProp);

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const [displayed, setDisplayed] = useState(visible);

  useLayoutEffect(() => {
    if (visible) setDisplayed(true);
  }, [visible]);

  useEffect(() => {
    if (!displayed) return;
    if (visible) {
      opacity.setValue(0);
      scale.setValue(0.94);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.94,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setDisplayed(false);
      });
    }
  }, [visible, displayed, opacity, scale]);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleBackdrop = useCallback(() => {
    if (!backdropDismissible) return;
    onDismiss?.();
    close();
  }, [backdropDismissible, onDismiss, close]);

  const handlePrimary = () => {
    onPrimaryAction();
    close();
  };

  const handleSecondary = () => {
    onSecondaryAction?.();
    close();
  };

  const primaryBgStyle: ViewStyle =
    variant === 'error'
      ? { backgroundColor: theme.danger }
      : variant === 'success'
        ? { backgroundColor: theme.success }
        : variant === 'warning'
          ? { backgroundColor: WARNING_AMBER }
          : {};

  const useGradientPrimary = variant === 'info';

  const iconBg: ViewStyle =
    variant === 'success'
      ? {
          backgroundColor: theme.successSoft,
          borderColor: withAlpha(theme.success, 0.35),
        }
      : variant === 'warning'
        ? {
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            borderColor: withAlpha(WARNING_AMBER, 0.38),
          }
        : variant === 'error'
          ? {
              backgroundColor: theme.dangerSoft,
              borderColor: withAlpha(theme.danger, 0.4),
            }
          : {
              backgroundColor: withAlpha(theme.tint, 0.14),
              borderColor: withAlpha(theme.tint, 0.32),
            };

  const iconColor =
    variant === 'success'
      ? theme.success
      : variant === 'warning'
        ? WARNING_AMBER
        : variant === 'error'
          ? theme.danger
          : theme.neonViolet;

  const iconNode =
    icon ??
    (
      <Ionicons name={defaultIconName(variant)} size={24} color={iconColor} />
    );

  const showTopAccent = variant === 'info' || variant === 'success';

  if (!displayed) return null;

  const horizontalGutter = Math.max(GUTTER_MIN, insets.left + spacing.md, insets.right + spacing.md);
  const rootPadding = {
    paddingTop: Math.max(insets.top, spacing.lg),
    paddingBottom: Math.max(insets.bottom, spacing.lg),
    paddingLeft: horizontalGutter,
    paddingRight: horizontalGutter,
  };

  const cardBorderColor = withAlpha('#ffffff', 0.055);
  const rippleWhite = { color: 'rgba(255,255,255,0.22)' } as const;

  const iconHaloBorder =
    variant === 'success'
      ? withAlpha(theme.success, 0.14)
      : variant === 'warning'
        ? withAlpha(WARNING_AMBER, 0.14)
        : variant === 'error'
          ? withAlpha(theme.danger, 0.14)
          : withAlpha(theme.tint, 0.16);

  return (
    <Modal
      visible={displayed}
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
    >
      <Animated.View
        style={[styles.root, rootPadding, { opacity }]}
        accessibilityViewIsModal
        importantForAccessibility="yes"
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={backdropDismissible ? handleBackdrop : undefined}
          accessibilityLabel={backdropDismissible ? 'Dismiss dialog' : undefined}
          accessibilityRole={backdropDismissible ? 'button' : undefined}
        />
        <Animated.View
          style={[styles.cardWrap, { transform: [{ scale }] }]}
          accessibilityRole="alert"
          accessibilityViewIsModal
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.cardPressable}>
            <View style={styles.shadowShell}>
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.surface,
                    borderColor: cardBorderColor,
                    ...(Platform.OS === 'android' ? { elevation: MODAL_SHADOW.elevation } : null),
                  },
                ]}
              >
                {showTopAccent ? (
                  <LinearGradient
                    colors={[withAlpha(theme.tint, 0.95), withAlpha(theme.accent, 0.85), withAlpha(theme.tint, 0.45)]}
                    locations={[0, 0.55, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.topAccent}
                  />
                ) : null}
                <View style={styles.cardInner}>
                  <View style={[styles.iconHalo, { borderColor: iconHaloBorder }]}>
                    <View style={[styles.iconWrap, iconBg]}>{iconNode}</View>
                  </View>
                  <Text
                    style={[
                      typography.titleLG,
                      styles.title,
                      { fontFamily: fonts.displayBold, color: theme.text },
                      !message ? { marginBottom: spacing.lg } : null,
                    ]}
                  >
                    {title}
                  </Text>
                  {message ? (
                    <Text
                      style={[
                        styles.message,
                        {
                          color: theme.mutedForeground,
                          marginTop: spacing.sm,
                        },
                      ]}
                    >
                      {message}
                    </Text>
                  ) : null}

                  {useGradientPrimary ? (
                    <Pressable
                      onPress={handlePrimary}
                      accessibilityRole="button"
                      accessibilityLabel={primaryActionLabel}
                      android_ripple={Platform.OS === 'android' ? rippleWhite : undefined}
                      style={({ pressed }) => [
                        styles.primaryTouchable,
                        pressed && styles.primaryPressed,
                      ]}
                    >
                      <LinearGradient
                        colors={[...gradient.primary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.primaryGradient}
                      >
                        <Text style={styles.primaryLabel}>{primaryActionLabel}</Text>
                      </LinearGradient>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={handlePrimary}
                      accessibilityRole="button"
                      accessibilityLabel={primaryActionLabel}
                      android_ripple={Platform.OS === 'android' ? rippleWhite : undefined}
                      style={({ pressed }) => [
                        styles.primarySolid,
                        primaryBgStyle,
                        pressed && styles.primaryPressed,
                      ]}
                    >
                      <Text style={styles.primaryLabel}>{primaryActionLabel}</Text>
                    </Pressable>
                  )}

                  {secondaryActionLabel ? (
                    <Pressable
                      onPress={handleSecondary}
                      accessibilityRole="button"
                      accessibilityLabel={secondaryActionLabel}
                      android_ripple={
                        Platform.OS === 'android'
                          ? { color: withAlpha(theme.mutedForeground, 0.25) }
                          : undefined
                      }
                      style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryPressed]}
                    >
                      <Text style={[styles.secondaryLabel, { color: theme.mutedForeground }]}>
                        {secondaryActionLabel}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BACKDROP_TINT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardWrap: {
    width: '100%',
    maxWidth: 400,
    zIndex: 1,
  },
  cardPressable: {
    width: '100%',
  },
  shadowShell: {
    width: '100%',
    borderRadius: CARD_RADIUS,
    backgroundColor: 'transparent',
    ...(Platform.OS !== 'android'
      ? {
          shadowColor: MODAL_SHADOW.shadowColor,
          shadowOffset: MODAL_SHADOW.shadowOffset,
          shadowOpacity: MODAL_SHADOW.shadowOpacity,
          shadowRadius: MODAL_SHADOW.shadowRadius,
        }
      : {}),
  },
  card: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'stretch',
  },
  topAccent: {
    width: '100%',
    height: TOP_ACCENT_HEIGHT,
  },
  cardInner: {
    paddingHorizontal: INNER_PADDING,
    paddingTop: INNER_PADDING - 2,
    paddingBottom: INNER_PADDING,
    alignItems: 'center',
  },
  iconHalo: {
    borderWidth: 1,
    borderRadius: 28,
    padding: 3,
    marginBottom: spacing.md + 2,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    letterSpacing: 0.15,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  primaryTouchable: {
    width: '100%',
    marginTop: spacing.xs,
    minHeight: PRIMARY_MIN_HEIGHT,
    borderRadius: radius.button,
    overflow: 'hidden',
  },
  primaryPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  primaryGradient: {
    minHeight: PRIMARY_MIN_HEIGHT,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primarySolid: {
    width: '100%',
    marginTop: spacing.xs,
    minHeight: PRIMARY_MIN_HEIGHT,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    minHeight: PRIMARY_MIN_HEIGHT - 2,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  secondaryPressed: {
    opacity: 0.58,
  },
  secondaryLabel: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    fontWeight: '600',
  },
});

export type StatusDialogShowConfig = Omit<StatusDialogProps, 'visible' | 'onClose'>;

export function useStatusDialog() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<StatusDialogShowConfig | null>(null);

  const hide = useCallback(() => setOpen(false), []);

  const show = useCallback((next: StatusDialogShowConfig) => {
    setConfig(next);
    setOpen(true);
  }, []);

  const node =
    config != null ? (
      <StatusDialog
        visible={open}
        onClose={hide}
        title={config.title}
        message={config.message}
        variant={config.variant}
        primaryActionLabel={config.primaryActionLabel}
        onPrimaryAction={config.onPrimaryAction}
        secondaryActionLabel={config.secondaryActionLabel}
        onSecondaryAction={config.onSecondaryAction}
        onDismiss={config.onDismiss}
        icon={config.icon}
        backdropDismissible={config.backdropDismissible}
      />
    ) : null;

  return { show, hide, dialog: node };
}
