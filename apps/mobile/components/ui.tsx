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
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { border, button, layout, radius, spacing, typography, shadows } from '@/constants/theme';
import { useColorScheme } from './useColorScheme';
import { GradientSurface } from './GradientSurface';

/** Reusable input styles for forms (profile edit, search, etc.) — web parity */
export const inputStyles = {
  height: layout.inputHeight,
  borderRadius: radius.input,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderWidth: border.width.thin,
  fontSize: 15,
} as const;

// ─── Typography primitives (apply theme typography + color; reuse in screens)
export type VibelyTextVariant = keyof typeof typography;

type VibelyTextProps = {
  variant: VibelyTextVariant;
  children: React.ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
} & Omit<React.ComponentProps<typeof Text>, 'style' | 'numberOfLines'>;

/** Themed text using typography scale (Inter body, Space Grotesk display). Color from theme.text unless overridden. */
export function VibelyText({ variant, children, color, style, numberOfLines, ...rest }: VibelyTextProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const baseStyle = [typography[variant], { color: color ?? theme.text }];
  return (
    <Text style={[...baseStyle, style]} numberOfLines={numberOfLines} {...rest}>
      {children}
    </Text>
  );
}

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

type GlassHeaderBarProps = {
  children: ReactNode;
  /** Safe area insets; when provided and skipTopInset is false, paddingTop includes insets.top */
  insets?: { top: number };
  /** When true, do not add insets.top to paddingTop (e.g. when already inside ScreenContainer) */
  skipTopInset?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Reusable tab-screen header bar: GlassSurface + standard padding. Use for Dashboard, Events, Matches. */
export function GlassHeaderBar({ children, insets, skipTopInset = false, style }: GlassHeaderBarProps) {
  const top = insets?.top ?? 0;
  const paddingTop = skipTopInset ? layout.headerPaddingTopExtra : top + layout.headerPaddingTopExtra;
  return (
    <GlassSurface
      style={[
        {
          paddingTop,
          paddingBottom: layout.headerPaddingBottom,
          paddingHorizontal: layout.containerPadding,
        },
        style,
      ]}
    >
      {children}
    </GlassSurface>
  );
}

type ScreenHeaderProps = {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Insets from useSafeAreaInsets(); used for paddingTop */
  insets?: { top: number };
};

/** Reusable screen header: back button, title, optional right. Use with GlassSurface or standalone. */
export function ScreenHeader({ title, onBack, right, insets }: ScreenHeaderProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const topPadding = insets ? insets.top + layout.headerPaddingTopExtra : layout.headerPaddingTopExtra;
  return (
    <View style={[styles.screenHeaderRow, { paddingTop: topPadding }]}>
      {onBack ? (
        <Pressable onPress={onBack} style={({ pressed }) => [styles.screenHeaderBack, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
      ) : (
        <View style={styles.screenHeaderBack} />
      )}
      <Text style={[styles.screenHeaderTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
      {right ? <View style={styles.screenHeaderRight}>{right}</View> : <View style={styles.screenHeaderRight} />}
    </View>
  );
}

type ChipVariant = 'default' | 'secondary' | 'outline' | 'accent' | 'destructive';

type ChipProps = {
  label: string;
  variant?: ChipVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/** Reusable chip/badge — web Badge parity (default, secondary, outline, accent, destructive). */
export function Chip({ label, variant = 'default', style, textStyle }: ChipProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  let backgroundColor: string = theme.tint;
  let borderColor: string = 'transparent';
  let labelColor: string = theme.primaryForeground;
  const borderWidth = variant === 'outline' || variant === 'secondary' ? border.width.thin : 0;
  if (variant === 'secondary') {
    backgroundColor = theme.secondary;
    borderColor = theme.border;
    labelColor = theme.secondaryForeground;
  } else if (variant === 'outline') {
    backgroundColor = 'transparent';
    borderColor = theme.border;
    labelColor = theme.text;
  } else if (variant === 'accent') {
    backgroundColor = theme.accentSoft;
    borderColor = 'transparent';
    labelColor = theme.tint;
  } else if (variant === 'destructive') {
    backgroundColor = theme.danger;
    borderColor = 'transparent';
    labelColor = theme.primaryForeground;
  }
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor, borderColor, borderWidth },
        style,
      ]}
    >
      <Text style={[styles.chipLabel, { color: labelColor }, textStyle]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

type SkeletonProps = {
  width?: number;
  height?: number;
  borderRadius?: number;
  /** Default: theme.surfaceSubtle. Use theme.muted for web bg-muted parity. */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width, height, borderRadius, backgroundColor, style }: SkeletonProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const bg = backgroundColor ?? theme.surfaceSubtle;
  return (
    <View
      style={[
        { backgroundColor: bg },
        width !== undefined && { width },
        height !== undefined && { height },
        borderRadius !== undefined && { borderRadius },
        style,
      ]}
    />
  );
}

/** Next Event card skeleton — same layout as dashboard Next Event (cover + body with countdown/CTA). */
export function EventCardSkeleton() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View style={[styles.eventCardSkeleton, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      <Skeleton height={144} style={styles.eventCardSkeletonMedia} backgroundColor={theme.muted} />
      <View style={styles.eventCardSkeletonBody}>
        <View style={styles.eventCardSkeletonCountdownRow}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={56} height={56} borderRadius={radius.lg} backgroundColor={theme.muted} />
          ))}
        </View>
        <Skeleton height={button.height.default} borderRadius={button.radius.default} backgroundColor={theme.muted} />
      </View>
    </View>
  );
}

/** Match avatar + name skeleton — same layout as Your Matches row item. */
export function MatchAvatarSkeleton() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View style={styles.matchAvatarSkeleton}>
      <Skeleton width={52} height={52} borderRadius={26} backgroundColor={theme.muted} />
      <Skeleton width={40} height={12} borderRadius={4} backgroundColor={theme.muted} style={{ marginTop: spacing.xs }} />
    </View>
  );
}

/** Discover/upcoming event card skeleton — 260×image+body, same layout as discover card. */
export function DiscoverCardSkeleton() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View style={[styles.discoverCardSkeleton, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      <View style={styles.discoverCardSkeletonMedia}>
        <Skeleton height={120} style={StyleSheet.absoluteFill} backgroundColor={theme.muted} />
      </View>
      <View style={styles.discoverCardSkeletonBody}>
        <Skeleton height={16} width={180} borderRadius={4} backgroundColor={theme.muted} />
        <Skeleton height={12} width={120} borderRadius={4} backgroundColor={theme.muted} style={{ marginTop: 6 }} />
        <Skeleton height={12} width={72} borderRadius={4} backgroundColor={theme.muted} style={{ marginTop: 6 }} />
      </View>
    </View>
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

/** Section header — title, optional subtitle, optional action (e.g. See all); uses typography tokens. */
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

type CardVariant = 'default' | 'glass';

type CardProps = {
  children: ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
};

/** Card container — web parity rounded-2xl, border, shadow. glass = lighter surface (no blur on native). */
export function Card({ children, variant = 'default', style, onPress }: CardProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const backgroundColor = variant === 'glass' ? theme.surfaceSubtle : theme.surface;
  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor,
          borderColor: theme.border,
          borderWidth: border.width.thin,
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

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

type ButtonSize = 'sm' | 'default' | 'lg';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/** Primary/secondary/ghost/destructive button — web parity h-12 rounded-2xl, uses Stage 2 button tokens. */
export function VibelyButton({
  label,
  onPress,
  variant = 'primary',
  size = 'default',
  loading,
  disabled,
  style,
  textStyle,
}: ButtonProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const isDisabled = disabled || loading;

  const height = button.height[size];
  const borderRadius = button.radius[size];

  const base: ViewStyle = {
    minHeight: height,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  };

  let backgroundColor: string = theme.tint;
  let borderColor: string = theme.tint;
  let labelColor: string = theme.primaryForeground;

  if (variant === 'secondary') {
    backgroundColor = theme.surface;
    borderColor = theme.border;
    labelColor = theme.text;
  } else if (variant === 'ghost') {
    backgroundColor = 'transparent';
    borderColor = 'transparent';
    labelColor = theme.tint;
  } else if (variant === 'destructive') {
    backgroundColor = theme.danger;
    borderColor = theme.danger;
    labelColor = theme.primaryForeground;
  }

  const borderWidth = variant === 'ghost' ? 0 : border.width.thin;

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

/** Avatar — circular image or fallback initials; uses theme.muted for empty bg. */
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
          backgroundColor: theme.muted,
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

type MediaTileProps = {
  /** Image content (e.g. <Image source={{ uri }} />) */
  children: ReactNode;
  /** Optional caption overlay (e.g. title + subtitle) */
  caption?: ReactNode;
  aspectRatio?: number;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
};

/** Reusable media tile — rounded-2xl, overflow hidden; for event cards, discover cards, profile covers. */
export function MediaTile({ children, caption, aspectRatio = 16 / 9, style, onPress }: MediaTileProps) {
  const content = (
    <View style={[styles.mediaTile, aspectRatio ? { aspectRatio } : undefined, style]}>
      <View style={StyleSheet.absoluteFill}>{children}</View>
      {caption ? <View style={styles.mediaTileCaption}>{caption}</View> : null}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
}

type StateProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

/** Empty state — title, optional message, optional CTA; optional illustration. Set showIllustration={false} for minimal/restrained (e.g. dashboard no-events). */
export function EmptyState({
  title,
  message,
  actionLabel,
  onActionPress,
  illustration,
  showIllustration = true,
}: StateProps & { illustration?: ReactNode; showIllustration?: boolean }) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const defaultIllustration = showIllustration ? (
    <GradientSurface variant="primary" style={styles.emptyStateGradient}>
      {null}
    </GradientSurface>
  ) : null;

  return (
    <View style={styles.stateContainer}>
      {illustration ?? defaultIllustration}
      <Text style={[styles.stateTitle, { color: theme.text }]}>{title}</Text>
      {message ? (
        <Text style={[styles.stateMessage, { color: theme.textSecondary }]}>{message}</Text>
      ) : null}
      {actionLabel && onActionPress ? (
        <VibelyButton
          label={actionLabel}
          onPress={onActionPress}
          variant="secondary"
          size="default"
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}

/** Error state — danger title, message, optional primary CTA. */
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
          size="default"
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}

/** Loading state — spinner, title, optional message. */
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

/** Generic list row — left slot, optional right slot, optional onPress; consistent padding and border. */
type ListRowProps = {
  left: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function ListRow({ left, right, onPress, style }: ListRowProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const content = (
    <View style={[styles.listRowInner, { borderBottomColor: theme.border }, style]}>
      <View style={styles.listRowLeft}>{left}</View>
      {right != null ? <View style={styles.listRowRight}>{right}</View> : null}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>{content}</Pressable>;
  }
  return content;
}

type SettingsRowProps = {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Settings-style row: icon, title, optional subtitle, optional right (default chevron). Android: min height for touch target. */
export function SettingsRow({ icon, title, subtitle, onPress, right, style }: SettingsRowProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const content = (
    <View style={[styles.settingsRowInner, Platform.OS === 'android' && { minHeight: layout.minTouchTargetSize }, style]}>
      <View style={[styles.settingsRowIcon, { backgroundColor: theme.secondary }]}>{icon}</View>
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
  /** Optional; when provided show "Name, age" (web parity). */
  age?: number | null;
  time: string;
  lastMessage: string | null;
  unread: boolean;
  isNew: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Conversation list row: avatar (with unread ring), name+age, New badge, time, preview, unread dot. */
export function MatchListRow({ imageUri, name, age, time, lastMessage, unread, isNew, style }: MatchListRowProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const nameAge = age != null && age > 0 ? `${name}, ${age}` : name;
  return (
    <View style={[styles.matchListRow, { borderBottomColor: theme.border }, style]}>
      <View style={[styles.matchListAvatarWrap, unread && { borderWidth: 2, borderColor: theme.tint }]}>
        <Avatar
          size={52}
          image={imageUri ? <Image source={{ uri: imageUri }} style={styles.matchListAvatarImg} /> : undefined}
          fallbackInitials={name?.[0]}
        />
        {unread && <View style={[styles.matchListUnreadRingDot, { backgroundColor: theme.accent }]} />}
      </View>
      <View style={styles.matchListRowBody}>
        <View style={styles.matchListRowTop}>
          <Text style={[styles.matchListName, { color: theme.text }]} numberOfLines={1}>{nameAge}</Text>
          {isNew && <Chip label="New" variant="accent" style={styles.matchListNewBadge} />}
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
    </View>
  );
}

/** Skeleton for matches list row (loading state). Avatar wrap matches MatchListRow for no layout jump. */
export function MatchListRowSkeleton() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View style={[styles.matchListRow, { borderBottomColor: theme.border }]}>
      <View style={styles.matchListAvatarWrap}>
        <Skeleton width={52} height={52} borderRadius={26} backgroundColor={theme.muted} />
      </View>
      <View style={styles.matchListRowBody}>
        <View style={styles.matchListRowTop}>
          <Skeleton width={120} height={16} borderRadius={4} backgroundColor={theme.muted} />
          <Skeleton width={36} height={11} borderRadius={4} backgroundColor={theme.muted} />
        </View>
        <Skeleton width={180} height={13} borderRadius={4} backgroundColor={theme.muted} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.containerPadding,
    paddingBottom: layout.headerPaddingBottom,
    gap: spacing.md,
  },
  screenHeaderBack: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  screenHeaderTitle: {
    flex: 1,
    ...typography.titleMD,
    textAlign: 'center',
  },
  screenHeaderRight: {
    minWidth: 44,
    alignItems: 'flex-end',
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  screen: {
    flex: 1,
    paddingHorizontal: layout.containerPadding,
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
  emptyStateGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: spacing.md,
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
  eventCardSkeleton: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  eventCardSkeletonMedia: { width: '100%' },
  eventCardSkeletonBody: {
    padding: spacing.lg,
    paddingTop: spacing.md + 2,
    gap: spacing.md,
  },
  eventCardSkeletonCountdownRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  matchAvatarSkeleton: {
    alignItems: 'center',
    minWidth: 64,
  },
  discoverCardSkeleton: {
    width: 260,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  discoverCardSkeletonMedia: {
    height: 120,
    position: 'relative',
    overflow: 'hidden',
  },
  discoverCardSkeletonBody: {
    padding: spacing.md,
    gap: 6,
  },
  listRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: border.width.hairline,
  },
  listRowLeft: { flex: 1, minWidth: 0 },
  listRowRight: { marginLeft: spacing.md },
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
    minHeight: 48, // touch target (Android HIG)
  },
  destructiveRowLabel: { fontSize: 16, fontWeight: '600' },
  mediaTile: {
    borderRadius: radius['2xl'],
    overflow: 'hidden',
    position: 'relative',
  },
  mediaTileCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    justifyContent: 'flex-end',
  },
  matchListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: layout.containerPadding,
    borderBottomWidth: border.width.hairline,
    gap: spacing.md,
  },
  matchListAvatarWrap: {
    borderRadius: 26,
    padding: 2,
  },
  matchListUnreadRingDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
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
  matchListNewBadge: { paddingHorizontal: 6, paddingVertical: 2 },
  matchListTime: { fontSize: 11 },
  matchListPreview: { fontSize: 13, marginTop: 2 },
  matchListUnreadDot: { width: 10, height: 10, borderRadius: 5, marginLeft: spacing.sm },
});

