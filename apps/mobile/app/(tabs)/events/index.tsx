/**
 * Events list screen — web parity: header, location prompt shell, filter bar,
 * featured hero, Live Now / Upcoming rails, empty state, Happening Elsewhere shell.
 * Uses existing useEvents and event-detail navigation; no new backend contracts.
 */

import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Card } from '@/components/ui';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEvents } from '@/lib/eventsApi';
import type { EventListItem } from '@/lib/eventsApi';
import { eventCoverUrl } from '@/lib/imageUrl';

const DATE_FILTERS = ['Tonight', 'This Weekend', 'This Week', 'Upcoming'] as const;

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

// ── Location prompt banner (shell: no geolocation in this pass)
function LocationPromptBanner({
  onDismiss,
  theme,
}: {
  onDismiss: () => void;
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
        <Pressable style={[locationStyles.primaryBtn, { backgroundColor: theme.tint }]}>
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

// ── Featured hero card (first event; web FeaturedEventCard parity)
function FeaturedEventCard({
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
    <Pressable style={[featuredStyles.wrapper, { backgroundColor: theme.surface }]} onPress={onPress}>
      <Image
        source={{ uri: eventCoverUrl(event.image) }}
        style={featuredStyles.image}
        resizeMode="cover"
      />
      <View style={featuredStyles.gradientOverlay} />
      <View style={featuredStyles.content}>
        <View style={featuredStyles.badges}>
          {isLive ? (
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
        {event.tags.length > 0 && (
          <View style={featuredStyles.tags}>
            {event.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={[featuredStyles.tag, { backgroundColor: 'rgba(139,92,246,0.2)', borderColor: 'rgba(139,92,246,0.3)' }]}>
                <Text style={[featuredStyles.tagText, { color: theme.tint }]}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={[featuredStyles.title, { color: theme.text }]} numberOfLines={2}>
          {event.title}
        </Text>
        {event.description ? (
          <Text style={[featuredStyles.desc, { color: theme.textSecondary }]} numberOfLines={2}>
            {event.description}
          </Text>
        ) : null}
        <View style={featuredStyles.footer}>
          <View style={featuredStyles.attendees}>
            <View style={featuredStyles.avatarStack}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={[featuredStyles.avatar, { backgroundColor: theme.accentSoft }]} />
              ))}
            </View>
            <Text style={[featuredStyles.attendeesText, { color: theme.textSecondary }]}>
              +{event.attendees} going
            </Text>
          </View>
          <View style={[featuredStyles.cta, { backgroundColor: theme.accent }]}>
            <Text style={featuredStyles.ctaLabel}>Get Tickets</Text>
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
    borderColor: 'rgba(255,255,255,0.16)',
    height: 368,
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
    height: '72%',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.xl,
    paddingBottom: spacing.xl + 4,
  },
  badges: { position: 'absolute', top: spacing.lg, left: spacing.lg },
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
  liveText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
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
  title: { fontSize: 23, fontWeight: '700', marginBottom: 6 },
  desc: { fontSize: 15, marginBottom: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  attendees: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarStack: { flexDirection: 'row' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: -6,
    borderWidth: 2,
    borderColor: 'hsl(240, 10%, 4%)',
  },
  attendeesText: { fontSize: 14, fontWeight: '500' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.pill,
    borderWidth: 0,
  },
  ctaLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
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
      style={[railCardStyles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={onPress}
    >
      <View style={railCardStyles.imageWrap}>
        <Image source={{ uri: eventCoverUrl(event.image) }} style={railCardStyles.image} />
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
          {event.date} • {event.time}
        </Text>
        <View style={railCardStyles.row}>
          <View style={railCardStyles.avatars}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[railCardStyles.avatar, { backgroundColor: theme.accentSoft }]} />
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
  body: { padding: spacing.md },
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
    borderColor: 'hsl(240, 10%, 8%)',
  },
  attendees: { fontSize: 11 },
  cta: {
    paddingVertical: 10,
    borderRadius: radius.lg,
    alignItems: 'center',
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
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: '700' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});

// ── Loading skeleton
function EventsSkeleton({ theme }: { theme: (typeof Colors)[keyof typeof Colors] }) {
  return (
    <View style={skeletonStyles.wrapper}>
      <View style={[skeletonStyles.hero, { backgroundColor: theme.surfaceSubtle }]} />
      <View style={skeletonStyles.rail}>
        <View style={[skeletonStyles.railTitle, { backgroundColor: theme.surfaceSubtle }]} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={[skeletonStyles.railCard, { backgroundColor: theme.surfaceSubtle }]} />
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
  railCard: {
    width: CARD_WIDTH,
    height: 220,
    borderRadius: radius['2xl'],
    marginRight: spacing.md,
  },
});

export default function EventsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { data: events = [], isLoading, error, refetch, isRefetching } = useEvents(user?.id ?? null);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [locationDismissed, setLocationDismissed] = useState(false);
  const [showLocationPrompt] = useState(false); // Set true to show; no profile location check in this pass

  const now = useMemo(() => new Date(), []);

  const filteredEvents = useMemo(() => {
    let list = events;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (activeFilters.length > 0) {
      list = list.filter((event) => {
        const ed = event.eventDate;
        const dateMatch =
          (activeFilters.includes('Tonight') && isTonight(ed, now)) ||
          (activeFilters.includes('This Weekend') && isThisWeekend(ed, now)) ||
          (activeFilters.includes('This Week') && isThisWeek(ed, now)) ||
          (activeFilters.includes('Upcoming') && ed > now);
        return dateMatch;
      });
    }
    return list;
  }, [events, searchQuery, activeFilters, now]);

  const isFiltering = searchQuery.length > 0 || activeFilters.length > 0;
  const liveEvents = useMemo(() => events.filter((e) => e.status === 'live'), [events]);
  const upcomingEvents = useMemo(() => events.filter((e) => e.status !== 'live'), [events]);
  const featuredEvent = liveEvents[0] ?? upcomingEvents[0] ?? null;

  const toggleFilter = (filter: string) => {
    if (activeFilters.includes(filter)) {
      setActiveFilters(activeFilters.filter((f) => f !== filter));
    } else {
      setActiveFilters([...activeFilters, filter]);
    }
  };

  const clearFilters = () => {
    setActiveFilters([]);
    setSearchQuery('');
  };

  const handleEventPress = (id: string) => {
    router.push(`/events/${id}` as const);
  };

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorText, { color: theme.danger }]}>Failed to load events</Text>
        <Pressable style={[styles.retryBtn, { backgroundColor: theme.tint }]} onPress={() => refetch()}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
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
          onRefresh={refetch}
        />
      }
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={[styles.headerIconBox, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="calendar" size={24} color={theme.tint} />
        </View>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Discover Events</Text>
          <Text style={[styles.headerSub, { color: theme.textSecondary }]}>Find your next vibe match</Text>
        </View>
      </View>

      {/* Location prompt (shell) */}
      {showLocationPrompt && !locationDismissed && (
        <LocationPromptBanner theme={theme} onDismiss={() => setLocationDismissed(true)} />
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
          {DATE_FILTERS.map((filter) => {
            const active = activeFilters.includes(filter);
            return (
              <Pressable
                key={filter}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: theme.accentSoft, borderColor: theme.tint }
                    : { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                ]}
                onPress={() => toggleFilter(filter)}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? theme.tint : theme.textSecondary },
                  ]}
                >
                  {filter}
                </Text>
              </Pressable>
            );
          })}
          {activeFilters.length > 0 && (
            <Pressable style={styles.clearChips} onPress={clearFilters}>
              <Text style={[styles.clearChipsText, { color: theme.accent }]}>Clear all</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {isLoading && !events.length ? (
          <EventsSkeleton theme={theme} />
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
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="calendar-outline" size={32} color={theme.textSecondary} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No events found</Text>
                <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
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

            {upcomingEvents.length > 0 && (
              <EventsRail
                title={liveEvents.length > 0 ? 'Upcoming' : 'Discover'}
                emoji="📍"
                events={upcomingEvents}
                theme={theme}
                accentColor="cyan"
                onEventPress={handleEventPress}
              />
            )}

            {events.length === 0 && !isLoading && (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="calendar-outline" size={32} color={theme.textSecondary} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No events near you yet 💫</Text>
                <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
                  But there are events happening in other cities!
                </Text>
                <Pressable style={[styles.premiumCta, { backgroundColor: theme.tint }]}>
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.premiumCtaLabel}>Go Premium to explore →</Text>
                </Pressable>
              </View>
            )}

            {/* Happening Elsewhere shell (premium upsell) */}
            <View style={styles.elsewhere}>
              <View style={styles.elsewhereHeader}>
                <Ionicons name="sparkles" size={18} color={theme.tint} />
                <Text style={[styles.elsewhereTitle, { color: theme.text }]}>Happening Elsewhere</Text>
              </View>
              <Text style={[styles.elsewhereSub, { color: theme.textSecondary }]}>
                Events in cities you can explore with Premium
              </Text>
              <Card style={[styles.premiumCard, { borderColor: 'rgba(139,92,246,0.2)', backgroundColor: 'rgba(139,92,246,0.06)' }]}>
                <View style={styles.premiumCardInner}>
                  <Text style={styles.premiumEmoji}>💎</Text>
                  <View style={styles.premiumCardCopy}>
                    <Text style={[styles.premiumCardTitle, { color: theme.text }]}>Unlock Vibely Premium</Text>
                    <Text style={[styles.premiumCardDesc, { color: theme.textSecondary }]}>
                      Explore events in any city, match with people worldwide, and never miss a vibe.
                    </Text>
                    <Pressable
                      style={[styles.premiumCardCta, { backgroundColor: theme.tint }]}
                      onPress={() => router.push('/premium')}
                    >
                      <Ionicons name="sparkles" size={16} color="#fff" />
                      <Text style={styles.premiumCardCtaLabel}>Explore with Premium →</Text>
                    </Pressable>
                  </View>
                </View>
              </Card>
            </View>
          </>
        )}
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: { fontSize: 16, marginBottom: spacing.md },
  retryBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg },
  retryLabel: { color: '#fff', fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
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
    borderRadius: radius['2xl'],
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
  clearChips: { paddingVertical: 8, paddingHorizontal: spacing.sm },
  clearChipsText: { fontSize: 14, fontWeight: '500' },
  content: { paddingTop: spacing.xl },
  filteredContent: { paddingHorizontal: spacing.lg },
  filteredHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  filteredCount: { fontSize: 14 },
  filteredScroll: { paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.sm },
  emptySub: { fontSize: 14, marginBottom: spacing.lg },
  premiumCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  premiumCtaLabel: { color: '#fff', fontWeight: '600' },
  elsewhere: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  elsewhereHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  elsewhereTitle: { fontSize: 16, fontWeight: '700' },
  elsewhereSub: { fontSize: 12, marginBottom: spacing.md },
  premiumCard: { padding: spacing.lg, borderWidth: 1 },
  premiumCardInner: { flexDirection: 'row', gap: spacing.md },
  premiumEmoji: { fontSize: 24 },
  premiumCardCopy: { flex: 1 },
  premiumCardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  premiumCardDesc: { fontSize: 14, marginBottom: spacing.md },
  premiumCardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  premiumCardCtaLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  bottomSpacer: { height: 96 },
});
