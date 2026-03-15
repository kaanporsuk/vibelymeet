import React, { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  TextInput,
  TextStyle,
  ViewStyle,
  View,
  Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { layout, radius, spacing, typography, shadows } from '@/constants/theme';

/** Reusable input styles for forms (profile edit, search, etc.) — web parity */
export const inputStyles = {
  height: layout.inputHeight,
  borderRadius: radius.lg,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderWidth: 1,
  fontSize: 15,
} as const;
import { useColorScheme } from './useColorScheme';

type GlassSurfaceProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** When true (default), show bottom border. Set false for full-bleed glass (e.g. tab bar). */
  borderBottom?: boolean;
};

export function GlassSurface({ children, style, borderBottom = true }: GlassSurfaceProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View
      style={[
        { backgroundColor: theme.glassSurface },
        borderBottom && { borderBottomWidth: 1, borderBottomColor: theme.glassBorder },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type SkeletonProps = {
  width?: number;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width, height, borderRadius, style }: SkeletonProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View
      style={[
        { backgroundColor: theme.surfaceSubtle },
        width !== undefined && { width },
        height !== undefined && { height },
        borderRadius !== undefined && { borderRadius },
        style,
      ]}
    />
  );
}

type ScreenProps = {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
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
    return <Pressable onPress={onPress}>{content}</Pressable>;
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

  const borderWidth = variant === 'ghost' ? 0 : variant === 'secondary' ? 1 : 1;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        base,
        {
          backgroundColor,
          borderWidth,
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

type SettingsRowProps = {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SettingsRow({ icon, title, subtitle, onPress, right, style }: SettingsRowProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const content = (
    <View style={[styles.settingsRowInner, style]}>
      <View style={[styles.settingsRowIcon, { backgroundColor: theme.accentSoft }]}>{icon}</View>
      <View style={styles.settingsRowText}>
        <Text style={[styles.settingsRowTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.settingsRowSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {right ?? <Text style={{ color: theme.textSecondary }}>›</Text>}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>{content}</Pressable>;
  }
  return content;
}

type VibelyInputProps = {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  editable?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  /** Layout (e.g. marginBottom); applied to wrapper View */
  containerStyle?: StyleProp<ViewStyle>;
  /** TextInput style (font, etc.). Border/padding come from inputStyles. */
  style?: StyleProp<TextStyle>;
  placeholderTextColor?: string;
};

export function VibelyInput({
  value,
  onChangeText,
  placeholder,
  editable = true,
  multiline,
  numberOfLines = 3,
  containerStyle,
  style,
  placeholderTextColor,
}: VibelyInputProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const inputStyle: StyleProp<TextStyle> = [
    inputStyles,
    {
      borderColor: theme.border,
      color: theme.text,
      minHeight: multiline ? 96 : layout.inputHeight,
      textAlignVertical: multiline ? 'top' : 'center',
    },
    style,
  ];
  return (
    <View style={containerStyle}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor ?? theme.textSecondary}
        editable={editable}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : undefined}
        style={inputStyle}
      />
    </View>
  );
}

type DestructiveRowProps = {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function DestructiveRow({ icon, label, onPress, style }: DestructiveRowProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.destructiveRow,
        { opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.destructiveRowLabel, { color: theme.danger }]}>{label}</Text>
    </Pressable>
  );
}

export type MatchListRowProps = {
  imageUri: string;
  name: string;
  time: string;
  lastMessage: string | null;
  unread: boolean;
  isNew: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Conversation list row: avatar, name, optional New badge, time, preview, unread dot. */
export function MatchListRow({ imageUri, name, time, lastMessage, unread, isNew, style }: MatchListRowProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View style={[styles.matchListRow, { borderBottomColor: theme.border }, style]}>
      <Avatar
        size={52}
        image={imageUri ? <Image source={{ uri: imageUri }} style={styles.matchListAvatarImg} /> : undefined}
        fallbackInitials={name?.[0]}
      />
      <View style={styles.matchListRowBody}>
        <View style={styles.matchListRowTop}>
          <Text style={[styles.matchListName, { color: theme.text }]} numberOfLines={1}>{name}</Text>
          {isNew && (
            <View style={[styles.matchListNewBadge, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.matchListNewBadgeText, { color: theme.tint }]}>New</Text>
            </View>
          )}
          <Text style={[styles.matchListTime, { color: theme.textSecondary }]} numberOfLines={1}>{time}</Text>
        </View>
        <Text
          style={[
            styles.matchListPreview,
            { color: theme.textSecondary },
            unread && { color: theme.text, fontWeight: '600' },
          ]}
          numberOfLines={1}
        >
          {lastMessage || 'New match'}
        </Text>
      </View>
      {unread && <View style={[styles.matchListUnreadDot, { backgroundColor: theme.accent }]} />}
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
    minHeight: 220,
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
  settingsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingsRowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsRowText: { flex: 1, minWidth: 0 },
  settingsRowTitle: { ...typography.titleMD, fontSize: 16 },
  settingsRowSubtitle: { fontSize: 12, marginTop: 2 },
  destructiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  destructiveRowLabel: { fontSize: 16, fontWeight: '600' },
  matchListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  matchListAvatarImg: { width: '100%', height: '100%' },
  matchListRowBody: { flex: 1, marginLeft: spacing.sm, minWidth: 0 },
  matchListRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
    gap: spacing.xs,
  },
  matchListName: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  matchListNewBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  matchListNewBadgeText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  matchListTime: { fontSize: 11 },
  matchListPreview: { fontSize: 13, marginTop: 2 },
  matchListUnreadDot: { width: 10, height: 10, borderRadius: 5, marginLeft: spacing.sm },
});

