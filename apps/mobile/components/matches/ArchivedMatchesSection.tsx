/**
 * Collapsible archived conversations — web parity with `ArchivedMatchesSection` (Matches page).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Card, MatchListRow } from '@/components/ui';
import { spacing, radius, layout, typography } from '@/constants/theme';
import type { MatchListItem } from '@/lib/chatApi';

export type ArchivedMatchesSectionProps = {
  archivedMatches: MatchListItem[];
  /** Count of non-archived matches (for this user); used to auto-expand when every chat is archived. */
  activeConversationCount: number;
  onOpenChat: (otherProfileId: string) => void;
  onRestore: (matchId: string) => void;
  restoreDisabled?: boolean;
};

export function ArchivedMatchesSection({
  archivedMatches,
  activeConversationCount,
  onOpenChat,
  onRestore,
  restoreDisabled,
}: ArchivedMatchesSectionProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (archivedMatches.length === 0) return;
    if (activeConversationCount === 0) setExpanded(true);
  }, [activeConversationCount, archivedMatches.length]);

  if (archivedMatches.length === 0) return null;

  const n = archivedMatches.length;
  const subtitle = `${n} conversation${n !== 1 ? 's' : ''}`;

  return (
    <View style={styles.outer}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.headerPress,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
      >
        <View style={[styles.headerIconWrap, { backgroundColor: theme.muted }]}>
          <Ionicons name="archive-outline" size={20} color={theme.textSecondary} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Archived</Text>
          <Text style={[styles.headerSub, { color: theme.textSecondary }]}>{subtitle}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={theme.textSecondary}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.list}>
          {archivedMatches.map((m) => (
            <Card
              key={m.matchId}
              variant="glass"
              style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            >
              <View style={styles.rowInner}>
                <Pressable
                  onPress={() => onOpenChat(m.id)}
                  style={styles.rowMain}
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat with ${m.name}`}
                >
                  <MatchListRow
                    imageUri={m.image}
                    name={m.name}
                    age={m.age}
                    time={m.time}
                    conversationPreview={m.conversationPreview}
                    unread={false}
                    isNew={false}
                    style={{
                      borderBottomWidth: 0,
                      flex: 1,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: 0,
                    }}
                  />
                </Pressable>
                <Pressable
                  onPress={() => onRestore(m.matchId)}
                  disabled={restoreDisabled}
                  style={({ pressed }) => [
                    styles.restoreBtn,
                    { opacity: restoreDisabled ? 0.45 : pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Restore chat with ${m.name}`}
                >
                  <Ionicons name="refresh-outline" size={16} color={theme.tint} />
                  <Text style={[styles.restoreLabel, { color: theme.tint }]}>Restore</Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginHorizontal: layout.containerPadding,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerPress: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { ...typography.titleSM, fontSize: 15 },
  headerSub: { fontSize: 13, marginTop: 2 },
  list: { marginTop: spacing.sm, gap: spacing.sm },
  rowCard: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    marginBottom: 0,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rowMain: { flex: 1, minWidth: 0 },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  restoreLabel: { fontSize: 12, fontWeight: '600' },
});
