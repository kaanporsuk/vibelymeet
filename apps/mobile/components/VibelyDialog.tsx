import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { button, radius, spacing } from '@/constants/theme';

const CARD_RADIUS = 20;
const HORIZONTAL_MARGIN = 32;
const INNER_PADDING = 24;
const WARNING_AMBER = '#f59e0b';
const PRIMARY_MIN_HEIGHT = Math.max(button.height.default, 48);

export interface VibelyDialogProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  variant?: 'info' | 'success' | 'warning' | 'destructive';
  primaryAction: {
    label: string;
    onPress: () => void;
  };
  secondaryAction?: {
    label: string;
    onPress: () => void;
  };
}

function variantIcon(
  variant: NonNullable<VibelyDialogProps['variant']>,
): keyof typeof Ionicons.glyphMap {
  switch (variant) {
    case 'success':
      return 'checkmark-circle-outline';
    case 'warning':
      return 'alert-circle-outline';
    case 'destructive':
      return 'warning-outline';
    default:
      return 'information-circle-outline';
  }
}

export function VibelyDialog({
  visible,
  onClose,
  title,
  message,
  variant = 'info',
  primaryAction,
  secondaryAction,
}: VibelyDialogProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.95)).current;
  const [displayed, setDisplayed] = useState(visible);

  useLayoutEffect(() => {
    if (visible) setDisplayed(true);
  }, [visible]);

  useEffect(() => {
    if (!displayed) return;
    if (visible) {
      opacity.setValue(0);
      scale.setValue(0.95);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 200,
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
          toValue: 0.95,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setDisplayed(false);
      });
    }
  }, [visible, displayed, opacity, scale]);

  const handlePrimary = () => {
    primaryAction.onPress();
    onClose();
  };

  const handleSecondary = () => {
    secondaryAction?.onPress();
    onClose();
  };

  const primaryBgStyle: ViewStyle =
    variant === 'destructive'
      ? { backgroundColor: theme.danger }
      : variant === 'success'
        ? { backgroundColor: theme.success }
        : variant === 'warning'
          ? { backgroundColor: WARNING_AMBER }
          : {};

  const iconBg =
    variant === 'success'
      ? { backgroundColor: theme.successSoft, borderColor: 'rgba(34, 197, 94, 0.45)' }
      : variant === 'warning'
        ? { backgroundColor: 'rgba(245, 158, 11, 0.16)', borderColor: 'rgba(245, 158, 11, 0.45)' }
        : variant === 'destructive'
          ? { backgroundColor: theme.dangerSoft, borderColor: 'rgba(239, 68, 68, 0.45)' }
          : { backgroundColor: 'rgba(139,92,246,0.18)', borderColor: 'rgba(139,92,246,0.45)' };

  const iconColor =
    variant === 'success'
      ? theme.success
      : variant === 'warning'
        ? WARNING_AMBER
        : variant === 'destructive'
          ? theme.danger
          : theme.neonViolet;

  if (!displayed) return null;

  return (
    <Modal
      visible={displayed}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.root, { opacity }]} accessibilityViewIsModal importantForAccessibility="yes">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss dialog" />
        <Animated.View
          style={[
            styles.cardWrap,
            {
              transform: [{ scale }],
            },
          ]}
          accessibilityRole="alert"
          accessibilityViewIsModal
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.cardPressable}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.glassSurface,
                  borderColor: theme.glassBorder,
                },
              ]}
            >
              <View style={[styles.iconWrap, iconBg]}>
                <Ionicons name={variantIcon(variant)} size={20} color={iconColor} />
              </View>
              <Text
                style={[
                  styles.title,
                  { color: theme.text },
                  !message ? { marginBottom: spacing.lg } : null,
                ]}
              >
                {title}
              </Text>
              {message ? (
                <Text style={[styles.message, { color: theme.textSecondary, marginTop: spacing.sm }]}>
                  {message}
                </Text>
              ) : null}

              {variant === 'info' ? (
                <Pressable
                  onPress={handlePrimary}
                  style={({ pressed }) => [styles.primaryTouchable, { opacity: pressed ? 0.92 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={primaryAction.label}
                >
                  <LinearGradient
                    colors={['#8B5CF6', '#E84393']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryGradient}
                  >
                    <Text style={styles.primaryLabel}>{primaryAction.label}</Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <Pressable
                  onPress={handlePrimary}
                  style={({ pressed }) => [
                    styles.primarySolid,
                    primaryBgStyle,
                    { opacity: pressed ? 0.92 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={primaryAction.label}
                >
                  <Text style={styles.primaryLabel}>{primaryAction.label}</Text>
                </Pressable>
              )}

              {secondaryAction ? (
                <Pressable
                  onPress={handleSecondary}
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.75 }]}
                  accessibilityRole="button"
                  accessibilityLabel={secondaryAction.label}
                >
                  <Text style={[styles.secondaryLabel, { color: theme.textSecondary }]}>
                    {secondaryAction.label}
                  </Text>
                </Pressable>
              ) : null}
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
    backgroundColor: 'rgba(4,6,12,0.74)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_MARGIN,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 400,
  },
  cardPressable: {
    width: '100%',
  },
  card: {
    borderRadius: CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    padding: INNER_PADDING,
    alignItems: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  primaryTouchable: {
    width: '100%',
    marginTop: spacing.sm,
    minHeight: PRIMARY_MIN_HEIGHT,
    borderRadius: radius.button,
    overflow: 'hidden',
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
    marginTop: spacing.sm,
    minHeight: PRIMARY_MIN_HEIGHT,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    minHeight: PRIMARY_MIN_HEIGHT,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export type VibelyDialogShowConfig = Omit<VibelyDialogProps, 'visible' | 'onClose'>;

/**
 * Single-dialog controller for screens with many alert sites. Keeps hook order stable
 * and matches VibelyDialog props without storing callbacks in React state.
 */
export function useVibelyDialog() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<VibelyDialogShowConfig | null>(null);

  const hide = useCallback(() => setOpen(false), []);

  const show = useCallback((next: VibelyDialogShowConfig) => {
    setConfig(next);
    setOpen(true);
  }, []);

  const node =
    config != null ? (
      <VibelyDialog
        visible={open}
        onClose={hide}
        title={config.title}
        message={config.message}
        variant={config.variant}
        primaryAction={config.primaryAction}
        secondaryAction={config.secondaryAction}
      />
    ) : null;

  return { show, hide, dialog: node };
}
