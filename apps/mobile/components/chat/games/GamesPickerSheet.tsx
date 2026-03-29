/**
 * Vibely-styled games entry sheet — replaces system Alert for chat “Games”.
 */
import React, { useCallback } from 'react';
import type { ViewStyle } from 'react-native';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, typography, fonts, shadows } from '@/constants/theme';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';

export type GamesPickerGameId =
  | 'intuition'
  | 'two_truths'
  | 'would_rather'
  | 'roulette'
  | 'charades'
  | 'scavenger';

type IonIconName = React.ComponentProps<typeof Ionicons>['name'];

type GameRowDef = {
  id: GamesPickerGameId;
  title: string;
  description: string;
  icon: IonIconName;
  /** Accent for icon tile */
  accent: 'violet' | 'cyan' | 'pink' | 'yellow';
};

const IN_CHAT_GAMES: readonly GameRowDef[] = [
  {
    id: 'intuition',
    title: 'Intuition Test',
    description: 'Guess what fits them best',
    icon: 'bulb-outline',
    accent: 'violet',
  },
  {
    id: 'two_truths',
    title: 'Two Truths',
    description: 'Spot the lie and keep it playful',
    icon: 'layers-outline',
    accent: 'cyan',
  },
  {
    id: 'would_rather',
    title: 'Would You Rather',
    description: 'Fast chemistry questions',
    icon: 'git-compare-outline',
    accent: 'pink',
  },
  {
    id: 'roulette',
    title: 'Roulette',
    description: 'Surprise prompts for the chat',
    icon: 'shuffle-outline',
    accent: 'yellow',
  },
  {
    id: 'charades',
    title: 'Emoji Charades',
    description: 'Act it out and let them guess',
    icon: 'body-outline',
    accent: 'violet',
  },
  {
    id: 'scavenger',
    title: 'Scavenger Hunt',
    description: 'Find something fun around you',
    icon: 'compass-outline',
    accent: 'cyan',
  },
];

function accentColors(
  theme: (typeof Colors)['light'],
  accent: GameRowDef['accent']
): { tileBg: string; icon: string } {
  switch (accent) {
    case 'violet':
      return { tileBg: 'rgba(139,92,246,0.2)', icon: theme.neonViolet };
    case 'cyan':
      return { tileBg: 'rgba(6,182,212,0.18)', icon: theme.neonCyan };
    case 'pink':
      return { tileBg: 'rgba(236,72,153,0.18)', icon: theme.neonPink };
    case 'yellow':
      return { tileBg: 'rgba(234,179,8,0.16)', icon: theme.neonYellow };
    default:
      return { tileBg: theme.muted, icon: theme.text };
  }
}

type Props = {
  visible: boolean;
  onClose: () => void;
  /** When true, show “Open full arcade in browser” (parity with legacy GAMES_WEB_FALLBACK). */
  showBrowserFallback: boolean;
  onSelectGame: (game: GamesPickerGameId) => void;
  onOpenBrowser?: () => void;
};

export function GamesPickerSheet({
  visible,
  onClose,
  showBrowserFallback,
  onSelectGame,
  onOpenBrowser,
}: Props) {
  const theme = Colors[useColorScheme()];

  const pickGame = useCallback(
    (id: GamesPickerGameId) => {
      onSelectGame(id);
    },
    [onSelectGame]
  );

  const openBrowser = useCallback(() => {
    onOpenBrowser?.();
  }, [onOpenBrowser]);

  const sheetSurface: ViewStyle = {
    backgroundColor: 'rgba(16,16,20,0.96)',
    borderColor: 'rgba(255,255,255,0.1)',
    ...shadows.card,
  };

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      showHandle
      handleStyle={{
        width: 44,
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.22)',
      }}
      maxHeightRatio={0.78}
      backdropColor="rgba(0,0,0,0.72)"
      sheetStyle={sheetSurface}
      footer={
        <View style={[styles.footerWrap, { borderTopColor: theme.border }]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close games sheet"
            style={({ pressed }) => [styles.footerBtn, pressed && { opacity: 0.72 }]}
          >
            <Text style={[styles.footerLabel, { color: theme.textSecondary }]}>Close</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.headerBlock}>
        <Text style={[typography.titleLG, { color: theme.text, fontFamily: fonts.displayBold }]}>Games</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Start a playful game in chat, or open the full arcade in your browser.
        </Text>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Start in chat</Text>
      <View style={styles.gameList}>
        {IN_CHAT_GAMES.map((g) => {
          const { tileBg, icon: iconColor } = accentColors(theme, g.accent);
          return (
            <Pressable
              key={g.id}
              onPress={() => pickGame(g.id)}
              accessibilityRole="button"
              accessibilityLabel={`${g.title}. ${g.description}`}
              style={({ pressed }) => [
                styles.gameRow,
                {
                  borderColor: 'rgba(255,255,255,0.08)',
                  backgroundColor: theme.surfaceSubtle,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}
            >
              <View style={[styles.iconTile, { backgroundColor: tileBg }]}>
                <Ionicons name={g.icon} size={22} color={iconColor} />
              </View>
              <View style={styles.gameTextCol}>
                <Text style={[styles.gameTitle, { color: theme.text }]} numberOfLines={1}>
                  {g.title}
                </Text>
                <Text style={[styles.gameDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                  {g.description}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} style={styles.chevron} />
            </Pressable>
          );
        })}
      </View>

      {showBrowserFallback ? (
        <View style={styles.secondarySection}>
          <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />
          <Pressable
            onPress={openBrowser}
            accessibilityRole="button"
            accessibilityLabel="Open full arcade in browser"
            style={({ pressed }) => [
              styles.browserRow,
              {
                borderColor: 'rgba(255,255,255,0.1)',
                backgroundColor: 'rgba(255,255,255,0.04)',
                opacity: pressed ? 0.88 : 1,
              },
            ]}
          >
            <View style={[styles.iconTile, { backgroundColor: 'rgba(6,182,212,0.12)' }]}>
              <Ionicons name="globe-outline" size={22} color={theme.neonCyan} />
            </View>
            <View style={styles.gameTextCol}>
              <Text style={[styles.gameTitle, { color: theme.text }]}>Open full arcade in browser</Text>
              <Text style={[styles.gameDesc, { color: theme.textSecondary }]}>
                Full Vibely arcade experience on the web
              </Text>
            </View>
            <Ionicons name="open-outline" size={20} color={theme.neonCyan} style={styles.chevron} />
          </Pressable>
        </View>
      ) : null}
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    marginBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.body,
  },
  sectionLabel: {
    ...typography.overline,
    marginBottom: spacing.sm,
    letterSpacing: 1.2,
  },
  gameList: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameTextCol: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
    minWidth: 0,
  },
  gameTitle: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  gameDesc: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.body,
  },
  chevron: { opacity: 0.85 },
  secondarySection: {
    marginTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  sectionDivider: {
    height: 1,
    opacity: 0.45,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  browserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footerWrap: {
    marginHorizontal: -spacing.lg,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },
  footerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  footerLabel: {
    fontSize: 16,
    fontFamily: fonts.bodyMedium,
  },
});
