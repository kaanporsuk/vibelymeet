import { useEffect, useMemo } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { UserNotificationRow } from '@clientShared/notifications';
import type { PushDeliveryHealth } from '@clientShared/pushDeliveryHealth';
import Colors from '@/constants/Colors';
import { spacing, radius, fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { trackEvent } from '@/lib/analytics';
import type { NotificationInboxController } from '@/lib/useNotificationInbox';
import { resolveNotificationActionRoute } from '@/lib/notificationActions';

type Props = {
  visible: boolean;
  onClose: () => void;
  inbox: NotificationInboxController;
  pushHealth: PushDeliveryHealth;
  onRequestPushSetup: () => void;
};

function ageSeconds(row: UserNotificationRow): number {
  return Math.max(0, Math.round((Date.now() - new Date(row.created_at).getTime()) / 1000));
}

function iconName(category: string): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case 'message':
      return 'chatbubble-outline';
    case 'new_match':
      return 'heart-outline';
    case 'ready_gate':
      return 'flash-outline';
    case 'video_date':
      return 'videocam-outline';
    case 'event_live':
      return 'radio-outline';
    case 'event_reminder':
      return 'calendar-outline';
    case 'daily_drop':
      return 'water-outline';
    case 'safety':
      return 'shield-checkmark-outline';
    case 'credits_subscription':
      return 'card-outline';
    default:
      return 'notifications-outline';
  }
}

function PushSetupBanner({
  health,
  onRequestPushSetup,
  onOpenSettings,
}: {
  health: PushDeliveryHealth;
  onRequestPushSetup: () => void;
  onOpenSettings: () => void;
}) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  if (health.backendDeliverable) return null;
  const denied = health.permission === 'denied';
  const unsupported = health.status === 'unsupported';
  const preferencesDisabled = health.status === 'preferences_disabled';
  const paused = health.status === 'paused';
  return (
    <View style={[styles.pushBanner, { borderColor: withAlpha(theme.neonYellow, 0.25), backgroundColor: withAlpha(theme.neonYellow, 0.08) }]}>
      <View style={[styles.pushIcon, { backgroundColor: withAlpha(theme.neonYellow, 0.14) }]}>
        <Ionicons name={denied ? 'alert-circle-outline' : 'flash-outline'} size={18} color={theme.neonYellow} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pushTitle, { color: theme.text }]}>
          {denied
            ? 'Notifications are blocked'
            : unsupported
              ? 'Push is not available here'
              : preferencesDisabled
                ? 'Push notifications are off'
                : paused
                  ? 'Notifications are paused'
                  : 'Never miss a live vibe'}
        </Text>
        <Text style={[styles.pushBody, { color: theme.textSecondary }]}>
          {denied
            ? 'Open system settings to allow Vibely notifications.'
            : unsupported
              ? 'You can still use this inbox for in-app alerts.'
              : preferencesDisabled
                ? 'Turn them back on in notification settings when you want alerts again.'
                : paused
                  ? 'Resume push alerts from notification settings.'
                  : 'Turn on push for matches, event reminders, and Ready Gate alerts.'}
        </Text>
        {!unsupported ? (
          <Pressable
            onPress={() => {
              if (denied) void Linking.openSettings();
              else if (preferencesDisabled || paused) onOpenSettings();
              else onRequestPushSetup();
            }}
            style={[styles.pushButton, { borderColor: withAlpha(theme.neonYellow, 0.35), backgroundColor: withAlpha(theme.neonYellow, 0.12) }]}
          >
            <Text style={[styles.pushButtonText, { color: theme.neonYellow }]}>
              {denied ? 'Open Settings' : preferencesDisabled || paused ? 'Notification settings' : 'Enable notifications'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function NotificationRow({
  row,
  onOpen,
  onDismiss,
}: {
  row: UserNotificationRow;
  onOpen: (row: UserNotificationRow) => void;
  onDismiss: (id: string) => void;
}) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const unread = !row.read_at;
  return (
    <View style={[styles.row, { borderColor: unread ? withAlpha(theme.tint, 0.28) : theme.glassBorder, backgroundColor: unread ? withAlpha(theme.tint, 0.08) : theme.glassSurface }]}>
      <Pressable onPress={() => onOpen(row)} style={styles.rowMain}>
        <View style={[styles.rowIcon, { backgroundColor: withAlpha(row.priority === 'urgent' ? theme.accent : theme.tint, 0.14) }]}>
          <Ionicons name={iconName(row.category)} size={18} color={row.priority === 'urgent' ? theme.accent : theme.tint} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowTitle, { color: theme.text, fontFamily: unread ? fonts.bodyBold : fonts.bodySemiBold }]}>
              {row.group_count > 1 && row.category === 'message' ? `${row.group_count} new messages` : row.title}
            </Text>
            {!row.seen_at ? <View style={[styles.unseenDot, { backgroundColor: theme.accent }]} /> : null}
          </View>
          {row.body ? <Text style={[styles.rowBody, { color: theme.textSecondary }]} numberOfLines={2}>{row.body}</Text> : null}
        </View>
      </Pressable>
      <Pressable onPress={() => onDismiss(row.id)} style={styles.dismiss} accessibilityLabel="Dismiss notification">
        <Ionicons name="close" size={16} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

function Section({ title, rows, onOpen, onDismiss }: { title: string; rows: UserNotificationRow[]; onOpen: (row: UserNotificationRow) => void; onDismiss: (id: string) => void }) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      {rows.map((row) => (
        <NotificationRow key={row.id} row={row} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

export function NotificationCenterSheet({ visible, onClose, inbox, pushHealth, onRequestPushSetup }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const visibleIds = useMemo(() => inbox.rows.filter((row) => !row.seen_at).map((row) => row.id), [inbox.rows]);

  useEffect(() => {
    if (!visible || visibleIds.length === 0) return;
    void inbox.markSeen(visibleIds);
    visibleIds.forEach((id) => {
      const row = inbox.rows.find((item) => item.id === id);
      if (!row) return;
      trackEvent('notification_seen', {
        category: row.category,
        priority: row.priority,
        action_kind: row.action.kind,
        source_screen: 'notification_center',
        push_state: pushHealth.status,
        notification_age_seconds: ageSeconds(row),
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, visibleIds.join('|')]);

  useEffect(() => {
    if (!visible) return;
    trackEvent('notification_center_opened', {
      source_screen: 'dashboard',
      push_state: pushHealth.status,
      unseen_count: inbox.unseenCount,
    });
  }, [inbox.unseenCount, pushHealth.status, visible]);

  useEffect(() => {
    if (!visible || pushHealth.backendDeliverable) return;
    trackEvent('notification_push_setup_banner_shown', {
      source_screen: 'notification_center',
      push_state: pushHealth.status,
    });
  }, [pushHealth.backendDeliverable, pushHealth.status, visible]);

  const handleOpen = async (row: UserNotificationRow) => {
    await inbox.markOpened(row.id);
    trackEvent('notification_read', {
      category: row.category,
      priority: row.priority,
      action_kind: row.action.kind,
      source_screen: 'notification_center',
      push_state: pushHealth.status,
      notification_age_seconds: ageSeconds(row),
    });
    trackEvent('notification_opened', {
      category: row.category,
      priority: row.priority,
      action_kind: row.action.kind,
      source_screen: 'notification_center',
      push_state: pushHealth.status,
      notification_age_seconds: ageSeconds(row),
    });
    const route = resolveNotificationActionRoute(row.action);
    if (!route) {
      trackEvent('notification_action_failed', {
        category: row.category,
        priority: row.priority,
        action_kind: row.action.kind,
        source_screen: 'notification_center',
        push_state: pushHealth.status,
        notification_age_seconds: ageSeconds(row),
      });
      return;
    }
    onClose();
    router.push(route);
  };

  const handleDismiss = async (id: string) => {
    const row = inbox.rows.find((item) => item.id === id);
    await inbox.dismiss(id);
    if (row) {
      trackEvent('notification_dismissed', {
        category: row.category,
        priority: row.priority,
        action_kind: row.action.kind,
        source_screen: 'notification_center',
        push_state: pushHealth.status,
        notification_age_seconds: ageSeconds(row),
      });
    }
  };

  const handleMarkAllRead = async () => {
    await inbox.markAllRead();
    trackEvent('notification_mark_all_read', {
      source_screen: 'notification_center',
      push_state: pushHealth.status,
    });
  };

  const empty = !inbox.isLoading && inbox.rows.length === 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close notifications" />
      <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.glassBorder }]}>
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>Notifications</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{inbox.unseenCount > 0 ? `${inbox.unseenCount} new` : 'All caught up'}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => void handleMarkAllRead()} style={styles.headerButton} accessibilityLabel="Mark all read">
              <Ionicons name="checkmark-done" size={20} color={theme.text} />
            </Pressable>
            <Pressable onPress={() => { onClose(); router.push('/settings/notifications'); }} style={styles.headerButton} accessibilityLabel="Notification settings">
              <Ionicons name="settings-outline" size={20} color={theme.text} />
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PushSetupBanner
            health={pushHealth}
            onOpenSettings={() => {
              trackEvent('notification_push_setup_clicked', {
                source_screen: 'notification_center',
                push_state: pushHealth.status,
              });
              onClose();
              router.push('/settings/notifications');
            }}
            onRequestPushSetup={() => {
              trackEvent('notification_push_setup_clicked', {
                source_screen: 'notification_center',
                push_state: pushHealth.status,
              });
              onClose();
              onRequestPushSetup();
            }}
          />
          {inbox.isLoading ? (
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>Loading notifications...</Text>
          ) : empty ? (
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={32} color={theme.textSecondary} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No new vibes yet</Text>
              <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>Matches, messages, drops, and event reminders will appear here.</Text>
              <Pressable onPress={() => { onClose(); router.push('/events'); }} style={[styles.browseButton, { backgroundColor: theme.tint }]}>
                <Text style={styles.browseText}>Browse Events</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Section title="Needs action" rows={inbox.grouped.needsAction} onOpen={handleOpen} onDismiss={handleDismiss} />
              <Section title="Today" rows={inbox.grouped.today} onOpen={handleOpen} onDismiss={handleDismiss} />
              <Section title="Earlier" rows={inbox.grouped.earlier} onOpen={handleOpen} onDismiss={handleDismiss} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 92,
    height: 5,
    borderRadius: 3,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
  },
  subtitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  pushBanner: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  pushIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pushTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
  },
  pushBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  pushButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  pushButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  row: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  rowMain: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
  },
  rowBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  unseenDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dismiss: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
  },
  emptyTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    marginTop: spacing.md,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  browseButton: {
    marginTop: spacing.lg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  browseText: {
    color: '#fff',
    fontFamily: fonts.bodyBold,
    fontSize: 14,
  },
});
