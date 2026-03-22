/**
 * Premium invite flow — bottom sheet with personalized preview + quick-send channels.
 *
 * Share URLs (web source of truth):
 * - General: https://vibelymeet.com/invite?ref= → redirects to /auth?mode=signup&ref=
 * - Event:   https://vibelymeet.com/events/:id?ref= (canonical; /event/:id?ref= also redirects on web)
 *
 * Deep links: Opening these in a browser is the supported path. iOS/Android universal links
 * (open installed app from https://) require associated domains + AASA / intent filters in the
 * store build — not configured in-repo.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Dimensions,
  Share,
  Platform,
  Linking,
  Image,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { fetchMyProfile } from '@/lib/profileApi';
import { getImageUrl, eventCoverUrl } from '@/lib/imageUrl';
import {
  useRegisteredUpcomingEventsForInvite,
  type InviteSheetEventRow,
} from '@/lib/eventsApi';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.85;

const WEB_ORIGIN = 'https://vibelymeet.com';

/** General invite — distinct from event copy */
const GENERAL_INVITE_DEFAULT_MSG =
  "Join me on Vibely — video-first dating and real events near you. Would love to connect there.";

function defaultEventInviteMessage(eventTitle: string) {
  const t = eventTitle.trim() || 'this event';
  return `I'm going to “${t}” on Vibely — want to join me?`;
}

export type InviteFriendsSheetEvent = {
  id: string;
  title: string;
  cover_url?: string;
  start_time: string;
  city?: string;
};

export interface InviteFriendsSheetProps {
  visible: boolean;
  onClose: () => void;
  event?: InviteFriendsSheetEvent;
}

const CHANNELS = [
  { key: 'messages', icon: 'chatbubbles-outline' as const, label: 'Messages', color: '#34C759' },
  { key: 'whatsapp', icon: 'logo-whatsapp' as const, label: 'WhatsApp', color: '#25D366' },
  { key: 'copy', icon: 'copy-outline' as const, label: 'Copy', color: '#8B5CF6' },
  { key: 'more', icon: 'share-outline' as const, label: 'More', color: '#6B7280' },
];

function buildInviteUrl(userId: string) {
  return `${WEB_ORIGIN}/invite?ref=${encodeURIComponent(userId)}`;
}

function buildEventInviteUrl(eventId: string, userId: string) {
  return `${WEB_ORIGIN}/events/${eventId}?ref=${encodeURIComponent(userId)}`;
}

function formatEventWhen(iso: string) {
  try {
    return format(new Date(iso), 'EEE, MMM d · h:mm a');
  } catch {
    return iso;
  }
}

function resolveCoverUri(cover?: string | null): string | undefined {
  if (!cover) return undefined;
  if (cover.startsWith('http')) return cover;
  return eventCoverUrl(cover);
}

export function InviteFriendsSheet({ visible, onClose, event: eventProp }: InviteFriendsSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: visible && !!user?.id,
  });

  const { data: upcomingEvents = [], isLoading: loadingEvents } = useRegisteredUpcomingEventsForInvite(
    visible && !eventProp ? user?.id : null
  );

  const userName = profile?.name?.trim() || 'Someone';
  const userAvatar = profile?.photos?.[0]
    ? getImageUrl(profile.photos[0])
    : profile?.avatar_url
      ? getImageUrl(profile.avatar_url)
      : undefined;
  const userId = user?.id ?? '';

  const eventModeOnly = !!eventProp;
  const [modeTab, setModeTab] = useState<'vibely' | 'event'>('vibely');
  const [selectedEvent, setSelectedEvent] = useState<InviteSheetEventRow | null>(null);
  const [customMessage, setCustomMessage] = useState(GENERAL_INVITE_DEFAULT_MSG);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  const activeEvent: InviteFriendsSheetEvent | InviteSheetEventRow | null = eventProp
    ? eventProp
    : modeTab === 'event'
      ? selectedEvent
      : null;

  const showFeedbackToast = useCallback((message: string) => {
    setFeedbackToast(message);
    setTimeout(() => setFeedbackToast(null), 2200);
  }, []);

  // Reset when sheet opens (avoid clobbering message while typing mid-session)
  useEffect(() => {
    if (!visible) return;
    if (eventProp) {
      setCustomMessage(defaultEventInviteMessage(eventProp.title));
      return;
    }
    setModeTab('vibely');
    setSelectedEvent(null);
    setCustomMessage(GENERAL_INVITE_DEFAULT_MSG);
  }, [visible, eventProp?.id, eventProp?.title]);

  useEffect(() => {
    if (!visible || eventProp) return;
    if (modeTab === 'vibely') setCustomMessage(GENERAL_INVITE_DEFAULT_MSG);
  }, [modeTab, visible, eventProp]);

  useEffect(() => {
    if (!visible || eventProp) return;
    if (modeTab === 'event' && selectedEvent) {
      setCustomMessage(defaultEventInviteMessage(selectedEvent.title));
    }
  }, [selectedEvent?.id, selectedEvent?.title, modeTab, visible, eventProp]);

  const shareSheetTitle = useMemo(() => {
    if (activeEvent) {
      return `Vibely · ${activeEvent.title}`;
    }
    return 'Join me on Vibely';
  }, [activeEvent]);

  const shareUrl = useMemo(() => {
    if (!userId) return '';
    if (activeEvent) return buildEventInviteUrl(activeEvent.id, userId);
    return buildInviteUrl(userId);
  }, [userId, activeEvent]);

  const fullShareBody = useMemo(() => {
    const msg = customMessage.trim();
    return msg ? `${msg}\n\n${shareUrl}` : shareUrl;
  }, [customMessage, shareUrl]);

  const onChannelPress = useCallback(
    async (key: string) => {
      if (!shareUrl) return;
      switch (key) {
        case 'messages': {
          const body = fullShareBody;
          const sms =
            Platform.OS === 'ios'
              ? `sms:&body=${encodeURIComponent(body)}`
              : `sms:?body=${encodeURIComponent(body)}`;
          const can = await Linking.canOpenURL(sms).catch(() => false);
          if (can) {
            await Linking.openURL(sms);
          } else {
            const result = await Share.share({
              message: body,
              ...(Platform.OS === 'ios' ? { url: shareUrl } : {}),
            }).catch(() => null);
            if (result?.action === Share.sharedAction) {
              showFeedbackToast('Ready to send');
            }
          }
          break;
        }
        case 'whatsapp': {
          const text = encodeURIComponent(fullShareBody);
          const wa = `whatsapp://send?text=${text}`;
          const can = await Linking.canOpenURL('whatsapp://send').catch(() => false);
          if (can) {
            await Linking.openURL(wa);
          } else {
            const result = await Share.share({ message: fullShareBody, title: shareSheetTitle }).catch(() => null);
            if (result?.action === Share.sharedAction) {
              showFeedbackToast('Invite shared');
            }
          }
          break;
        }
        case 'copy': {
          await Clipboard.setStringAsync(fullShareBody);
          showFeedbackToast('Copied to clipboard');
          break;
        }
        case 'more':
        default: {
          const result = await Share.share({
            title: shareSheetTitle,
            message: fullShareBody,
            url: Platform.OS === 'ios' ? shareUrl : undefined,
          }).catch(() => null);
          if (result?.action === Share.sharedAction) {
            showFeedbackToast('Invite shared');
          }
          break;
        }
      }
    },
    [fullShareBody, shareUrl, shareSheetTitle, showFeedbackToast]
  );

  const renderEventMini = ({ item }: { item: InviteSheetEventRow }) => {
    const selected = selectedEvent?.id === item.id;
    const cover = resolveCoverUri(item.cover_url);
    return (
      <Pressable
        onPress={() => setSelectedEvent(item)}
        style={[
          styles.miniCard,
          { borderColor: selected ? '#8B5CF6' : theme.glassBorder, backgroundColor: theme.surfaceSubtle },
        ]}
      >
        {cover ? (
          <Image source={{ uri: cover }} style={styles.miniCover} />
        ) : (
          <View style={[styles.miniCover, { backgroundColor: theme.muted }]} />
        )}
        <View style={styles.miniBody}>
          <Text style={[styles.miniTitle, { color: theme.text }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.miniMeta, { color: theme.textSecondary }]}>
            {formatEventWhen(item.start_time)}
            {item.city ? ` · ${item.city}` : ''}
          </Text>
        </View>
        {selected ? <Ionicons name="checkmark-circle" size={22} color="#8B5CF6" /> : null}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: SHEET_HEIGHT,
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <Text style={[styles.title, { color: theme.text }]}>
              {eventModeOnly ? 'Invite friends to this event' : 'Bring Friends to Vibely'}
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {eventModeOnly
                ? 'Share your personal link — friends see this event and can join you on Vibely.'
                : 'Invite friends to events, discover people, and meet together.'}
            </Text>

            {!eventModeOnly && (
              <View style={[styles.tabRow, { backgroundColor: theme.surfaceSubtle }]}>
                <Pressable
                  onPress={() => {
                    setModeTab('vibely');
                    setSelectedEvent(null);
                  }}
                  style={[
                    styles.tabBtn,
                    modeTab === 'vibely' && { backgroundColor: '#8B5CF6' },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabLabel,
                      { color: modeTab === 'vibely' ? '#fff' : theme.textSecondary },
                    ]}
                  >
                    To Vibely
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setModeTab('event')}
                  style={[styles.tabBtn, modeTab === 'event' && { backgroundColor: '#8B5CF6' }]}
                >
                  <Text
                    style={[
                      styles.tabLabel,
                      { color: modeTab === 'event' ? '#fff' : theme.textSecondary },
                    ]}
                  >
                    To an Event
                  </Text>
                </Pressable>
              </View>
            )}

            {!eventModeOnly && modeTab === 'vibely' ? (
              <View style={styles.previewCard}>
                <LinearGradient
                  colors={['#8B5CF6', '#E84393']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.previewGradient}
                >
                  {userAvatar ? (
                    <Image source={{ uri: userAvatar }} style={styles.inviteAvatar} />
                  ) : (
                    <View style={[styles.inviteAvatar, styles.avatarPlaceholder]}>
                      <Ionicons name="person" size={36} color="rgba(255,255,255,0.8)" />
                    </View>
                  )}
                  <Text style={styles.inviteTitle}>{userName} invited you to Vibely</Text>
                  <Text style={styles.inviteSubtitle}>Video-first dating and social events in your city.</Text>
                </LinearGradient>
              </View>
            ) : null}

            {!eventModeOnly && modeTab === 'event' && !selectedEvent && (
              <View style={styles.eventPicker}>
                <Text style={[styles.sectionLabel, { color: theme.text }]}>Your upcoming events</Text>
                {loadingEvents ? (
                  <ActivityIndicator color={theme.tint} style={{ marginVertical: 16 }} />
                ) : upcomingEvents.length === 0 ? (
                  <Text style={[styles.emptyList, { color: theme.textSecondary }]}>
                    No upcoming events. Browse events to find one!
                  </Text>
                ) : (
                  upcomingEvents.map((item) => (
                    <React.Fragment key={item.id}>{renderEventMini({ item })}</React.Fragment>
                  ))
                )}
              </View>
            )}

            {(eventModeOnly || (modeTab === 'event' && !!selectedEvent)) && activeEvent && (
              <View style={styles.eventPreviewCard}>
                {resolveCoverUri(activeEvent.cover_url) ? (
                  <Image
                    source={{ uri: resolveCoverUri(activeEvent.cover_url)! }}
                    style={styles.eventCover}
                  />
                ) : (
                  <View style={[styles.eventCover, { backgroundColor: '#1C1A2E' }]} />
                )}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.85)']}
                  style={styles.eventOverlay}
                >
                  <Text style={styles.eventInviteLabel}>{userName} is going to</Text>
                  <Text style={styles.eventTitle} numberOfLines={2}>
                    {activeEvent.title}
                  </Text>
                  <Text style={styles.eventMeta}>
                    {formatEventWhen(activeEvent.start_time)}
                    {activeEvent.city ? ` · ${activeEvent.city}` : ''}
                  </Text>
                </LinearGradient>
              </View>
            )}

            {(eventModeOnly ||
              modeTab === 'vibely' ||
              (modeTab === 'event' && !!selectedEvent)) && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.text, marginTop: spacing.md }]}>
                  {activeEvent ? 'Add a note' : 'Add a message'}
                </Text>
                <TextInput
                  value={customMessage}
                  onChangeText={setCustomMessage}
                  placeholder={
                    activeEvent
                      ? 'Optional — say why you’d love them there…'
                      : 'Add a personal message…'
                  }
                  placeholderTextColor={theme.mutedForeground}
                  maxLength={120}
                  multiline
                  style={[
                    styles.messageInput,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.surfaceSubtle,
                      color: theme.text,
                    },
                  ]}
                />
                <Text style={[styles.charCount, { color: theme.textSecondary }]}>
                  {customMessage.length}/120
                </Text>

                <Text style={[styles.sectionLabel, { color: theme.text }]}>Send invite</Text>
                {!userId ? (
                  <Text style={[styles.signInHint, { color: theme.textSecondary }]}>
                    Sign in to generate your invite link.
                  </Text>
                ) : null}
                <View style={[styles.channelRow, !userId && { opacity: 0.45 }]} pointerEvents={userId ? 'auto' : 'none'}>
                  {CHANNELS.map((ch) => (
                    <Pressable
                      key={ch.key}
                      onPress={() => void onChannelPress(ch.key)}
                      style={styles.channelItem}
                    >
                      <View style={[styles.channelCircle, { backgroundColor: `${ch.color}22` }]}>
                        <Ionicons name={ch.icon} size={26} color={ch.color} />
                      </View>
                      <Text style={[styles.channelLabel, { color: theme.textSecondary }]} numberOfLines={1}>
                        {ch.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.urlHint, { color: theme.textSecondary }]} numberOfLines={2}>
                  {shareUrl || (userId ? '' : 'Your invite link appears here when signed in.')}
                </Text>
              </>
            )}

            <Pressable onPress={onClose} style={[styles.doneBtn, { borderColor: theme.border }]}>
              <Text style={[styles.doneBtnText, { color: theme.textSecondary }]}>Done</Text>
            </Pressable>
          </ScrollView>

          {feedbackToast ? (
            <View style={[styles.toast, { bottom: insets.bottom + 24 }]} accessibilityLiveRegion="polite">
              <Text style={styles.toastText}>{feedbackToast}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
    marginTop: 10,
    marginBottom: 8,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  tabRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  previewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  previewGradient: {
    padding: 24,
    alignItems: 'center',
  },
  inviteAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.5)',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    color: '#fff',
    fontSize: 18,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
    marginBottom: 6,
  },
  inviteSubtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 20,
  },
  eventPicker: {
    marginBottom: 12,
    maxHeight: 220,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 8,
  },
  miniCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
    paddingRight: 10,
  },
  miniCover: {
    width: 72,
    height: 72,
  },
  miniBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  miniTitle: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  miniMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  emptyList: {
    textAlign: 'center',
    paddingVertical: 16,
    fontSize: 14,
  },
  eventPreviewCard: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  eventCover: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  eventOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 16,
  },
  eventInviteLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  eventTitle: {
    color: '#fff',
    fontSize: 20,
    fontFamily: fonts.displayBold,
    marginTop: 4,
  },
  eventMeta: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    marginTop: 6,
  },
  messageInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    alignSelf: 'flex-end',
    marginTop: 4,
    marginBottom: 8,
  },
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  channelItem: {
    alignItems: 'center',
    width: '22%',
    maxWidth: 80,
  },
  channelCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  channelLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    textAlign: 'center',
  },
  urlHint: {
    fontSize: 11,
    marginTop: 12,
    marginBottom: 8,
  },
  signInHint: {
    fontSize: 13,
    fontFamily: fonts.body,
    marginBottom: 10,
    lineHeight: 18,
  },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  doneBtnText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default InviteFriendsSheet;
