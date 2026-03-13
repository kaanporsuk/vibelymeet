import React, { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  TextStyle,
  ViewStyle,
  View,
  Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { layout, radius, spacing, typography, shadows } from '@/constants/theme';
import { useColorScheme } from './useColorScheme';

type ScreenProps = {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  headerRight?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenContainer({ title, children, footer, headerRight, style }: ScreenProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? layout.screenPadding.default : insets.top;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: topPadding }, style]}>
      <View style={styles.screenInner}>
        {title ? (
          <View style={styles.headerRow}>
            <Text style={[styles.screenTitle, { color: theme.text }]}>{title}</Text>
            {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
          </View>
        ) : null}
        {children}
      </View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View style={styles.sectionHeaderRow}>
      <View>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
};

export function Card({ children, style, onPress }: CardProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
        shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable style={{ marginBottom: spacing.md }} onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return content;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function VibelyButton({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  textStyle,
}: ButtonProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const isDisabled = disabled || loading;

  const base: ViewStyle = {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  };

  let backgroundColor: string = theme.tint;
  let borderColor: string = theme.tint;
  let labelColor: string = '#ffffff';

  if (variant === 'secondary') {
    backgroundColor = theme.surface;
    borderColor = theme.border;
    labelColor = theme.text;
  } else if (variant === 'ghost') {
    backgroundColor = 'transparent';
    borderColor = 'transparent';
    labelColor = theme.tint;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        base,
        {
          backgroundColor,
          borderWidth: variant === 'ghost' ? 0 : StyleSheet.hairlineWidth,
          borderColor,
          opacity: isDisabled ? 0.6 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={labelColor} /> : null}
      <Text
        style={[
          { color: labelColor, fontWeight: '600', fontSize: 15 },
          textStyle as TextStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type AvatarProps = {
  size?: number;
  image?: ReactNode;
  fallbackInitials?: string;
};

export function Avatar({ size = 56, image, fallbackInitials }: AvatarProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  if (image) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: theme.surfaceSubtle,
        }}
      >
        {image}
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: theme.accent, fontWeight: '700' }}>
        {fallbackInitials ?? 'V'}
      </Text>
    </View>
  );
}

type StateProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

export function EmptyState({ title, message, actionLabel, onActionPress }: StateProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View style={styles.stateContainer}>
      <Text style={[styles.stateTitle, { color: theme.text }]}>{title}</Text>
      {message ? (
        <Text style={[styles.stateMessage, { color: theme.textSecondary }]}>{message}</Text>
      ) : null}
      {actionLabel && onActionPress ? (
        <VibelyButton
          label={actionLabel}
          onPress={onActionPress}
          variant="secondary"
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({ title, message, actionLabel, onActionPress }: StateProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View style={styles.stateContainer}>
      <Text style={[styles.stateTitle, { color: theme.danger }]}>{title}</Text>
      {message ? (
        <Text style={[styles.stateMessage, { color: theme.textSecondary }]}>{message}</Text>
      ) : null}
      {actionLabel && onActionPress ? (
        <VibelyButton
          label={actionLabel}
          onPress={onActionPress}
          variant="primary"
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}

export function LoadingState({ title, message }: Pick<StateProps, 'title' | 'message'>) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View style={styles.stateContainer}>
      <ActivityIndicator size="large" color={theme.tint} />
      <Text style={[styles.stateTitle, { color: theme.text, marginTop: spacing.md }]}>{title}</Text>
      {message ? (
        <Text style={[styles.stateMessage, { color: theme.textSecondary }]}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: layout.screenPadding.default,
  },
  screenInner: {
    flex: 1,
    maxWidth: layout.contentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerRight: {
    marginLeft: spacing.md,
  },
  screenTitle: {
    ...typography.titleLG,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.titleMD,
  },
  sectionSubtitle: {
    ...typography.bodySecondary,
    marginTop: 2,
  },
  card: {
    borderRadius: radius['2xl'],
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  footer: {
    paddingTop: spacing.md,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  stateTitle: {
    ...typography.titleMD,
    textAlign: 'center',
  },
  stateMessage: {
    ...typography.bodySecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

