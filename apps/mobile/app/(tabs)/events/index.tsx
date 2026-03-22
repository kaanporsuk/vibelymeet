/**
 * Events list screen — web parity: header, location prompt shell, filter bar,
 * featured hero, Live Now / Upcoming rails, empty state, Happening Elsewhere shell.
 * Uses existing useEvents and event-detail navigation; no new backend contracts.
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLanguageLabel } from '@/lib/eventLanguages';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Card, GlassHeaderBar, ErrorState, Skeleton, VibelyButton } from '@/components/ui';
import { spacing, radius, typography, layout, shadows } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useEvents,
  useIsRegisteredForEvent,
  useEventAttendees,
  useRegisteredEventIds,
  type EventListItem,
  type EventAttendee,
} from '@/lib/eventsApi';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { eventCoverUrl, avatarUrl } from '@/lib/imageUrl';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Linking } from 'react-native';
import { useOtherCityEvents } from '@/lib/useOtherCityEvents';
import EventFilterSheet, {
  type EventFilters,
  DEFAULT_FILTERS,
  countActiveFilters,
} from '@/components/events/EventFilterSheet';
import * as Location from 'expo-location';

const TIME_FILTERS = [
  { key: 'tonight', label: 'Tonight' },
  { key: 'this_weekend', label: 'This Weekend' },
  { key: 'this_week', label: 'This Week' },
  { key: 'upcoming', label: 'Upcoming' },
] as const;


function isTonight(ed: Date, now: Date): boolean {
  return ed.toDateString() === now.toDateString();
}

function isThisWeekend(ed: Date, now: Date): boolean {
  const dow = now.getDay();
  const sat = new Date(now);
  sat.setDate(now.getDate() + (6 - dow));
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return ed >= sat && ed <= sun;
}

function isThisWeek(ed: Date, now: Date): boolean {
  const end = new Date(now);
  end.setDate(now.getDate() + (7 - now.getDay()));
  return ed <= end && ed >= now;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Location prompt banner: show when profile has no location_data; Enable opens web to set location
function LocationPromptBanner({
  onDismiss,
  onEnable,
  theme,
}: {
  onDismiss: () => void;
  onEnable: () => void;
  theme: (typeof Colors)[keyof typeof Colors];
}) {
  return (
    <View style={[locationStyles.banner, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[locationStyles.iconBox, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name="location" size={18} color={theme.tint} />
      </View>
      <View style={locationStyles.copy}>
        <Text style={[locationStyles.title, { color: theme.text }]}>
          Share your location to see events near you
        </Text>
        <Text style={[locationStyles.sub, { color: theme.textSecondary }]}>
          We'll show local events matched to your city
        </Text>
      </View>
      <View style={locationStyles.actions}>
        <Pressable onPress={onDismiss} style={locationStyles.ghostBtn}>
          <Text style={[locationStyles.ghostLabel, { color: theme.textSecondary }]}>Not now</Text>
        </Pressable>
        <Pressable onPress={onEnable} style={[locationStyles.primaryBtn, { backgroundColor: theme.tint }]}>
          <Text style={locationStyles.primaryLabel}>Enable</Text>
        </Pressable>
      </View>
    </View>
  );
}

const locationStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ghostBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  ghostLabel: { fontSize: 12 },
  primaryBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.sm },
  primaryLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
});

// ── Countdown for featured card (HH:MM:SS until start, or "Live" / "Ended")
function useFeaturedCountdown(event: EventListItem | null) {
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [isLive, setIsLive] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!event) return;
    const start = event.eventDate.getTime();
    const end = start + (event.duration_minutes ?? 60) * 60 * 1000;
    const tick = () => {
      const now = Date.now();
      if (now >= end) {
        setExpired(true);
        setIsLive(false);
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      if (now >= start) {
        setIsLive(true);
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      const diff = Math.floor((start - now) / 1000);
      setTimeLeft({
        hours: Math.floor(diff / 3600),
        minutes: Math.floor((diff % 3600) / 60),
        seconds: diff % 60,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [event?.id, event?.eventDate?.getTime(), event?.duration_minutes]);
  return { timeLeft, isLive, expired };
}

// ── Featured hero card (first/upcoming event; web FeaturedEventCard parity — taller, countdown, View Ticket)
function FeaturedEventCard({
  event,
  theme,
  onPress,
  isRegistered,
  attendees,
}: {
  event: EventListItem;
  theme: (typeof Colors)[keyof typeof Colors];
  onPress: () => void;
  isRegistered?: boolean;
  attendees?: EventAttendee[];
}) {
  const { timeLeft, isLive, expired } = useFeaturedCountdown(event);
  const avatarUrls = (attendees ?? []).slice(0, 3).map((a) => a.avatar_url ?? a.photos?.[0]).filter(Boolean) as string[];
  return (
    <Pressable
      style={({ pressed }) => [
        featuredStyles.wrapper,
        { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
        shadows.card,
        pressed && { opacity: 0.92 },
      ]}
      onPress={onPress}
    >
      <Image
        source={{ uri: eventCoverUrl(event.image) }}
        style={featuredStyles.image}
        resizeMode="cover"
      />
      <View style={featuredStyles.gradientOverlay} />
      <View style={featuredStyles.content}>
        <View style={featuredStyles.badges}>
          {expired ? (
            <View style={[featuredStyles.endedBadge, { backgroundColor: withAlpha(theme.surface, 0.8), borderColor: theme.border }]}>
              <View style={[featuredStyles.liveDot, { backgroundColor: theme.textSecondary }]} />
              <Text style={[featuredStyles.endedText, { color: theme.textSecondary }]}>Event Ended</Text>
            </View>
          ) : isLive ? (
            <View style={featuredStyles.liveBadge}>
              <View style={featuredStyles.liveDot} />
              <Text style={featuredStyles.liveText}>Live Now</Text>
            </View>
          ) : (
            <View style={[featuredStyles.featuredBadge, { backgroundColor: theme.accentSoft, borderColor: theme.tint }]}>
              <Ionicons name="sparkles" size={14} color={theme.tint} />
              <Text style={[featuredStyles.featuredText, { color: theme.tint }]}>Featured Event</Text>
            </View>
          )}
        </View>
        {!isLive && !expired && (
          <View style={[featuredStyles.countdown, { backgroundColor: withAlpha(theme.background, 0.4), borderColor: 'rgba(255,255,255,0.1)' }]}>
            <Ionicons name="time-outline" size={16} color={theme.neonCyan} />
            <Text style={[featuredStyles.countdownText, { color: theme.text }]}>
              {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:{String(timeLeft.seconds).padStart(2, '0')}
            </Text>
          </View>
        )}
        {event.tags.length > 0 && (
          <View style={featuredStyles.tags}>
            {event.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={[featuredStyles.tag, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
                <Text style={[featuredStyles.tagText, { color: theme.tint }]}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={[featuredStyles.title, { color: theme.text }]} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={[featuredStyles.metaDate, { color: theme.textSecondary }]}>
          {event.date} · {event.time}
        </Text>
        {(() => {
          const lang = getLanguageLabel(event.language);
          return lang ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontSize: 12 }}>{lang.flag}</Text>
              <Text style={{ fontSize: 11, color: theme.textSecondary }}>{lang.label}</Text>
            </View>
          ) : null;
        })()}
        {event.description ? (
          <Text style={[featuredStyles.desc, { color: theme.textSecondary }]} numberOfLines={2}>
            {event.description}
          </Text>
        ) : null}
        <View style={featuredStyles.footer}>
          <View style={featuredStyles.attendees}>
            <View style={featuredStyles.avatarStack}>
              {avatarUrls.length > 0
                ? avatarUrls.map((uri, i) => (
                    <Image key={i} source={{ uri: avatarUrl(uri) }} style={[featuredStyles.avatar, { borderColor: theme.background }]} />
                  ))
                : [1, 2, 3].map((i) => (
                    <View key={i} style={[featuredStyles.avatar, { backgroundColor: theme.accentSoft, borderColor: theme.background }]} />
                  ))}
            </View>
            <Text style={[featuredStyles.attendeesText, { color: theme.textSecondary }]}>
              +{event.attendees} going
            </Text>
          </View>
          <View style={[featuredStyles.cta, { backgroundColor: isRegistered ? theme.neonCyan : theme.accent }]}>
            <Text style={featuredStyles.ctaLabel}>{isRegistered ? 'View Ticket' : 'Get Tickets'}</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const featuredStyles = StyleSheet.create({
  wrapper: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radius['3xl'],
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    height: 420,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  gradientOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '78%',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomLeftRadius: radius['3xl'],
    borderBottomRightRadius: radius['3xl'],
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.xl,
    paddingBottom: spacing.xl + 8,
  },
  badges: { position: 'absolute', top: spacing.lg, left: spacing.lg },
  endedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  endedText: { fontSize: 12, fontWeight: '600' },
  countdown: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  countdownText: { fontSize: 16, fontWeight: '700' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(239,68,68,0.9)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  liveText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  featuredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  featuredText: { fontSize: 12, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tagText: { fontSize: 14, fontWeight: '500' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  metaDate: { fontSize: 14, fontWeight: '500', marginBottom: 6 },
  desc: { fontSize: 15, marginBottom: spacing.md, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  attendees: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarStack: { flexDirection: 'row' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginLeft: -6,
    borderWidth: 2,
  },
  attendeesText: { fontSize: 14, fontWeight: '600' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.xl + 4,
    paddingVertical: 14,
    borderRadius: radius.pill,
    borderWidth: 0,
  },
  ctaLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

// ── Rail card (EventCardPremium-style)
const CARD_WIDTH = Math.min(Dimensions.get('window').width - spacing.lg * 2 - spacing.md * 2, 320);

function EventRailCard({
  event,
  theme,
  onPress,
}: {
  event: EventListItem;
  theme: (typeof Colors)[keyof typeof Colors];
  onPress: () => void;
}) {
  const isLive = event.status === 'live';
  return (
    <Pressable
      style={({ pressed }) => [
        railCardStyles.card,
        { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
        shadows.card,
        pressed && { opacity: 0.92 },
      ]}
      onPress={onPress}
    >
      <View style={railCardStyles.imageWrap}>
        <Image source={{ uri: eventCoverUrl(event.image, 'event_image') }} style={railCardStyles.image} />
        <View style={railCardStyles.imageOverlay} />
        {isLive && (
          <View style={railCardStyles.liveBadge}>
            <View style={railCardStyles.liveDot} />
            <Text style={railCardStyles.liveText}>Live</Text>
          </View>
        )}
        {event.tags.length > 0 && (
          <View style={railCardStyles.tags}>
            {event.tags.slice(0, 2).map((tag) => (
              <View key={tag} style={railCardStyles.tag}>
                <Text style={railCardStyles.tagText}>✨ {tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={railCardStyles.body}>
        <Text style={[railCardStyles.title, { color: theme.text }]} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={[railCardStyles.meta, { color: theme.textSecondary }]}>
          {event.date} · {event.time}
        </Text>
        {(() => {
          const lang = getLanguageLabel(event.language);
          return lang ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontSize: 11 }}>{lang.flag}</Text>
              <Text style={{ fontSize: 10, color: theme.textSecondary }}>{lang.label}</Text>
            </View>
          ) : null;
        })()}
        <View style={railCardStyles.row}>
          <View style={railCardStyles.avatars}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[railCardStyles.avatar, { backgroundColor: theme.accentSoft, borderColor: theme.surface }]} />
            ))}
          </View>
          <Text style={[railCardStyles.attendees, { color: theme.textSecondary }]}>+{event.attendees}</Text>
        </View>
        <View style={[railCardStyles.cta, { backgroundColor: theme.tint }]}>
          <Text style={railCardStyles.ctaLabel}>Register</Text>
        </View>
      </View>
    </Pressable>
  );
}

const railCardStyles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: spacing.md,
  },
  imageWrap: {
    aspectRatio: 16 / 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  image: { width: '100%', height: '100%' },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  liveBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(239,68,68,0.9)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  tags: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '500' },
  body: { padding: spacing.md + 2, gap: 4 },
  title: { ...typography.titleMD, fontSize: 15, marginBottom: 4 },
  meta: { fontSize: 11, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -6,
    borderWidth: 1,
  },
  attendees: { fontSize: 11, fontWeight: '500' },
  cta: {
    paddingVertical: 10,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginTop: 2,
  },
  ctaLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

// ── Rail section
function EventsRail({
  title,
  emoji,
  events,
  theme,
  accentColor,
  onEventPress,
}: {
  title: string;
  emoji?: string;
  events: EventListItem[];
  theme: (typeof Colors)[keyof typeof Colors];
  accentColor: 'pink' | 'violet' | 'cyan';
  onEventPress: (id: string) => void;
}) {
  if (events.length === 0) return null;
  const accent = accentColor === 'pink' ? theme.accent : accentColor === 'cyan' ? theme.neonCyan : theme.tint;
  return (
    <View style={railStyles.section}>
      <View style={[railStyles.header, { flexDirection: 'row' as const, alignItems: 'baseline', flexWrap: 'wrap' }]}>
        {emoji ? <Text style={[railStyles.title, { color: theme.text }]}>{emoji} </Text> : null}
        <Text style={[railStyles.title, { color: accent }]}>{title}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={railStyles.scrollContent}
      >
        {events.map((event) => (
          <EventRailCard
            key={event.id}
            event={event}
            theme={theme}
            onPress={() => onEventPress(event.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const railStyles = StyleSheet.create({
  section: { marginBottom: spacing.xl },
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.md + 2 },
  title: { fontSize: 20, fontWeight: '700' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});

// ── Loading skeleton (uses shared Skeleton primitive; themed for parity)
function EventsSkeleton() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  return (
    <View style={skeletonStyles.wrapper}>
      <Skeleton style={skeletonStyles.hero} height={380} borderRadius={radius['3xl']} backgroundColor={theme.muted} />
      <View style={skeletonStyles.rail}>
        <Skeleton width={140} height={24} borderRadius={8} style={skeletonStyles.railTitle} backgroundColor={theme.muted} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width={CARD_WIDTH} height={220} borderRadius={radius['2xl']} style={skeletonStyles.railCard} backgroundColor={theme.muted} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.lg },
  hero: {
    height: 380,
    borderRadius: radius['3xl'],
    marginBottom: spacing.xl,
  },
  rail: { marginBottom: spacing.xl },
  railTitle: { width: 140, height: 24, borderRadius: 8, marginBottom: spacing.md },
  railCard: { marginRight: spacing.md },
});

export default function EventsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { isPremium } = useBackendSubscription(user?.id);
  const { data: events = [], isLoading, error, refetch, isRefetching } = useEvents(user?.id ?? null, isPremium);
  const { data: registeredEventIds = [] } = useRegisteredEventIds(user?.id);
  const { data: otherCities = [] } = useOtherCityEvents(user?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDismissed, setLocationDismissed] = useState(false);
  const { data: profileLocation } = useQuery({
    queryKey: ['profile-location', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      try {
        const { data, error } = await supabase.from('profiles').select('location_data').eq('id', user.id).maybeSingle();
        if (error) {
          if (__DEV__) console.warn('[events] profile location:', error.message);
          return null;
        }
        return data as { location_data?: { lat?: number; lng?: number } | null } | null;
      } catch (e) {
        if (__DEV__) console.warn('[events] profile location fetch failed:', e);
        return null;
      }
    },
    enabled: !!user?.id,
  });
  const hasLocation = !!(profileLocation?.location_data && (profileLocation.location_data.lat != null || profileLocation.location_data.lng != null));
  const showLocationPrompt = !hasLocation;

  useEffect(() => {
    if (userCoords) return;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch (error) {
        if (__DEV__) console.warn('[events] getCurrentPosition failed:', error);
      }
    })();
  }, [userCoords]);

  const sheetFilterCount = countActiveFilters(filters);
  const totalActiveCount = sheetFilterCount + (timeFilter ? 1 : 0);
  const isFiltering = searchQuery.length > 0 || timeFilter !== null || sheetFilterCount > 0;
  const liveEvents = useMemo(() => events.filter((e) => e.status === 'live'), [events]);
  const upcomingEvents = useMemo(() => events.filter((e) => e.status !== 'live'), [events]);

  const filteredEvents = useMemo(() => {
    const registered = new Set(registeredEventIds);
    const now = new Date();
    let list: EventListItem[] = [...events];

    // 1. Upcoming-only filter (default ON — hides ended events)
    if (filters.upcomingOnly) {
      list = list.filter(event => {
        const eventEnd = new Date(event.eventDate.getTime() + (event.duration_minutes ?? 60) * 60 * 1000);
        return eventEnd > now;
      });
    }

    // 2. Hide already-registered events
    list = list.filter(e => !registered.has(e.id));

    // 3. Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }

    // 4. Time filter
    if (timeFilter) {
      list = list.filter(event => {
        const ed = event.eventDate;
        switch (timeFilter) {
          case 'tonight': return isTonight(ed, now) && ed.getTime() > now.getTime();
          case 'this_weekend': return isThisWeekend(ed, now);
          case 'this_week': return isThisWeek(ed, now);
          case 'upcoming': return ed > now;
          default: return true;
        }
      });
    }

    // 5. Category filter (match against event tags)
    if (filters.categories.length > 0) {
      const cats = new Set(filters.categories.map(c => c.toLowerCase()));
      list = list.filter(e =>
        (e.tags ?? []).some(t => cats.has(t.toLowerCase()))
      );
    }

    // 6. Language filter
    if (filters.language) {
      list = list.filter(e => e.language === filters.language);
    }

    // 7. Location filter (client-side haversine)
    const locationCoords = (filters.locationMode === 'city' && filters.selectedCity)
      ? { lat: filters.selectedCity.lat, lng: filters.selectedCity.lng }
      : (filters.locationMode === 'nearby' ? userCoords : null);
    if (locationCoords && filters.distanceKm > 0) {
      list = list.filter(e => {
        const row = e as any;
        if (row.latitude == null || row.longitude == null) return true;
        const d = haversineKm(locationCoords.lat, locationCoords.lng, row.latitude, row.longitude);
        return d <= filters.distanceKm;
      });
    }

    return list;
  }, [events, registeredEventIds, searchQuery, timeFilter, filters, userCoords]);
  const discoverUpcomingEvents = useMemo(() => {
    const now = new Date();
    const registered = new Set(registeredEventIds);
    return upcomingEvents.filter((e) => {
      if (registered.has(e.id)) return false;
      const end = new Date(e.eventDate.getTime() + e.duration_minutes * 60 * 1000);
      return end > now;
    });
  }, [upcomingEvents, registeredEventIds]);
  const featuredEvent = liveEvents[0] ?? upcomingEvents[0] ?? null;
  const { data: isRegisteredForFeatured } = useIsRegisteredForEvent(featuredEvent?.id, user?.id);
  const { data: featuredAttendees = [] } = useEventAttendees(featuredEvent?.id);

  const toggleTimeFilter = (key: string) => {
    setTimeFilter(prev => prev === key ? null : key);
  };

  const clearAllFilters = () => {
    setTimeFilter(null);
    setFilters(DEFAULT_FILTERS);
    setSearchQuery('');
  };

  const handleEventPress = (id: string) => {
    router.push(`/events/${id}` as const);
  };

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          message="We couldn't load events. Check your connection and try again."
          onActionPress={() => refetch()}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching && !isLoading}
          onRefresh={() => refetch()}
          tintColor={theme.tint}
        />
      }
    >
      {/* Header */}
      <GlassHeaderBar insets={insets}>
        <View style={styles.header}>
          <View style={[styles.headerIconBox, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="calendar" size={24} color={theme.tint} />
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Discover Events</Text>
            <Text style={[styles.headerSub, { color: theme.textSecondary }]}>Find your next vibe match</Text>
          </View>
        </View>
      </GlassHeaderBar>

      {/* Location prompt: show when profile has no location and not dismissed */}
      {showLocationPrompt && !locationDismissed && (
        <LocationPromptBanner
          theme={theme}
          onDismiss={() => setLocationDismissed(true)}
          onEnable={() => Linking.openURL('https://vibelymeet.com/profile').catch(() => {})}
        />
      )}

      {/* Filter bar */}
      <View style={[styles.filterBar, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
        <View style={[styles.searchWrap, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search events, vibes, or communities..."
            placeholderTextColor={theme.textSecondary}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} style={styles.clearSearch}>
              <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {/* Filters button */}
          <Pressable
            onPress={() => setShowFilterSheet(true)}
            style={[
              styles.filterBtn,
              sheetFilterCount > 0
                ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(139,92,246,0.4)' },
            ]}
          >
            <Ionicons name="options-outline" size={16} color={sheetFilterCount > 0 ? '#fff' : '#8B5CF6'} />
            <Text style={[styles.filterBtnText, { color: sheetFilterCount > 0 ? '#fff' : '#8B5CF6' }]}>
              Filters
            </Text>
            {sheetFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{sheetFilterCount}</Text>
              </View>
            )}
          </Pressable>

          {/* Time filter pills */}
          {TIME_FILTERS.map(tf => {
            const active = timeFilter === tf.key;
            return (
              <Pressable
                key={tf.key}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                    : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                ]}
                onPress={() => toggleTimeFilter(tf.key)}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : theme.textSecondary }]}>
                  {tf.label}
                </Text>
              </Pressable>
            );
          })}

          {totalActiveCount > 0 && (
            <Pressable style={styles.clearChips} onPress={clearAllFilters}>
              <Text style={[styles.clearChipsText, { color: theme.accent }]}>Clear all</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>

      {/* Filter sheet */}
      <EventFilterSheet
        visible={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        filters={filters}
        onApply={setFilters}
        isPremium={isPremium}
        onPremiumUpgrade={() => router.push('/premium')}
      />

      {/* Content — max width for tablet parity */}
      <View style={[styles.content, { maxWidth: layout.contentWidth, alignSelf: 'center', width: '100%' }]}>
        {isLoading && !events.length ? (
          <EventsSkeleton />
        ) : isFiltering ? (
          <View style={styles.filteredContent}>
            <View style={styles.filteredHeader}>
              <Ionicons name="sparkles" size={20} color={theme.tint} />
              <Text style={[styles.filteredCount, { color: theme.textSecondary }]}>
                {filteredEvents.length} events found
              </Text>
            </View>
            {filteredEvents.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filteredScroll}>
                {filteredEvents.map((event) => (
                  <EventRailCard
                    key={event.id}
                    event={event}
                    theme={theme}
                    onPress={() => handleEventPress(event.id)}
                  />
                ))}
              </ScrollView>
            ) : (
              <View style={styles.filteredEmpty}>
                <View style={[styles.filteredEmptyIcon, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="calendar-outline" size={32} color={theme.textSecondary} />
                </View>
                <Text style={[styles.filteredEmptyTitle, { color: theme.text }]}>No events found</Text>
                <Text style={[styles.filteredEmptyMessage, { color: theme.textSecondary }]}>
                  Try adjusting your filters or search terms
                </Text>
              </View>
            )}
          </View>
        ) : (
          <>
            {featuredEvent && (
              <FeaturedEventCard
                event={featuredEvent}
                theme={theme}
                onPress={() => handleEventPress(featuredEvent.id)}
                isRegistered={!!isRegisteredForFeatured}
                attendees={featuredAttendees}
              />
            )}

            {liveEvents.length > 0 && (
              <EventsRail
                title="Live Now"
                emoji="🔴"
                events={liveEvents}
                theme={theme}
                accentColor="pink"
                onEventPress={handleEventPress}
              />
            )}

            {discoverUpcomingEvents.length > 0 && (
              <EventsRail
                title={liveEvents.length > 0 ? 'Upcoming' : 'Discover'}
                emoji="📍"
                events={discoverUpcomingEvents}
                theme={theme}
                accentColor="cyan"
                onEventPress={handleEventPress}
              />
            )}

            {events.length === 0 && !isLoading && (
              <View style={styles.emptyLocalWrap}>
                <View style={[styles.emptyLocalIcon, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="calendar-outline" size={32} color={theme.textSecondary} />
                </View>
                <Text style={[styles.emptyLocalTitle, { color: theme.text }]}>No events near you yet 💫</Text>
                <Text style={[styles.emptyLocalSub, { color: theme.textSecondary }]}>
                  But there are events happening in other cities!
                </Text>
                <Pressable
                  onPress={() => router.push('/premium')}
                  style={({ pressed }) => [styles.emptyLocalCta, { backgroundColor: theme.tint }, pressed && { opacity: 0.9 }]}
                >
                  <Ionicons name="sparkles" size={16} color="#fff" />
                  <Text style={styles.emptyLocalCtaText}>Go Premium to explore →</Text>
                </Pressable>
              </View>
            )}

            {/* Happening Elsewhere — web parity: only when otherCities.length > 0 */}
            {otherCities.length > 0 && (
              <View style={styles.elsewhere}>
                <View style={styles.elsewhereHeader}>
                  <Ionicons name="sparkles" size={16} color={theme.tint} />
                  <Text style={[styles.elsewhereTitle, { color: theme.text }]}>Happening Elsewhere</Text>
                </View>
                <Text style={[styles.elsewhereSub, { color: theme.textSecondary }]}>
                  Events in cities you can explore with Premium
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.elsewhereRail}
                >
                  {otherCities.map((city) => (
                    <View
                      key={city.city}
                      style={[styles.elsewhereCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                    >
                      {city.sample_cover ? (
                        <Image
                          source={{ uri: city.sample_cover }}
                          style={styles.elsewhereCardImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={[styles.elsewhereCardPlaceholder, { backgroundColor: theme.surface }]}>
                          <Ionicons name="globe-outline" size={32} color={theme.textSecondary} />
                        </View>
                      )}
                      <View style={styles.elsewhereCardOverlay} />
                      <View style={styles.elsewhereCardCaption}>
                        <Text style={[styles.elsewhereCardCity, { color: theme.text }]} numberOfLines={1}>
                          🔒 {city.city}
                        </Text>
                        <Text style={[styles.elsewhereCardCount, { color: theme.textSecondary }]}>
                          {city.event_count} events
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
                <Card variant="glass" style={[styles.premiumCard, { borderColor: withAlpha(theme.tint, 0.2) }]}>
                  <View style={styles.premiumCardInner}>
                    <Text style={styles.premiumEmoji}>💎</Text>
                    <View style={styles.premiumCardCopy}>
                      <Text style={[styles.premiumCardTitle, { color: theme.text }]}>Unlock Vibely Premium</Text>
                      <Text style={[styles.premiumCardDesc, { color: theme.textSecondary }]}>
                        Explore events in any city, match with people worldwide, and never miss a vibe.
                      </Text>
                      <VibelyButton
                        label="Explore with Premium →"
                        onPress={() => router.push('/premium')}
                        variant="primary"
                        size="sm"
                        style={styles.premiumCardCta}
                      />
                    </View>
                  </View>
                </Card>
              </View>
            )}
          </>
        )}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerIconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 2 },
  filterBar: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  searchIcon: { marginLeft: spacing.md },
  searchInput: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  clearSearch: { padding: spacing.sm, marginRight: spacing.sm },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingBottom: 4 },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterBtnText: { fontSize: 13, fontWeight: '600' },
  filterBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EC4899',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  clearChips: { paddingVertical: 8, paddingHorizontal: spacing.sm },
  clearChipsText: { fontSize: 14, fontWeight: '500' },
  content: { paddingTop: layout.mainContentPaddingTop },
  filteredContent: { paddingHorizontal: spacing.lg },
  filteredHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  filteredCount: { fontSize: 14 },
  filteredScroll: { paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  filteredEmpty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: spacing.lg },
  filteredEmptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  filteredEmptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.sm },
  filteredEmptyMessage: { fontSize: 14, textAlign: 'center' },
  emptyLocalWrap: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: spacing.lg },
  emptyLocalIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyLocalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  emptyLocalSub: { fontSize: 14, marginBottom: spacing.lg, textAlign: 'center' },
  emptyLocalCta: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: spacing.xl, borderRadius: radius.pill },
  emptyLocalCtaText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  elsewhere: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  elsewhereHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  elsewhereTitle: { fontSize: 16, fontWeight: '700' },
  elsewhereSub: { fontSize: 12, marginBottom: spacing.md },
  elsewhereRail: { flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.md },
  elsewhereCard: { width: 160, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, position: 'relative' },
  elsewhereCardImage: { width: '100%', height: 96 },
  elsewhereCardPlaceholder: { width: '100%', height: 96, alignItems: 'center', justifyContent: 'center' },
  elsewhereCardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 96, backgroundColor: 'rgba(0,0,0,0.35)' },
  elsewhereCardCaption: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10 },
  elsewhereCardCity: { fontSize: 12, fontWeight: '600' },
  elsewhereCardCount: { fontSize: 10, marginTop: 2 },
  premiumCard: { padding: spacing.lg },
  premiumCardInner: { flexDirection: 'row', gap: spacing.md },
  premiumEmoji: { fontSize: 24 },
  premiumCardCopy: { flex: 1 },
  premiumCardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  premiumCardDesc: { fontSize: 14, marginBottom: spacing.md },
  premiumCardCta: { alignSelf: 'flex-start' },
});
