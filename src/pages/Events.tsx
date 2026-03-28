import { useState, useMemo, useEffect, useCallback } from "react";
import type { UseVisibleEventsOptions } from "@/hooks/useVisibleEvents";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Sparkles, MapPin, Globe, Lock } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import type { SelectedCity } from "@/components/events/EventsFilterBar";
import { useVisibleEvents, useOtherCityEvents } from "@/hooks/useVisibleEvents";
import { useUserProfile } from "@/contexts/AuthContext";
import { BottomNav } from "@/components/BottomNav";
import { FeaturedEventCard } from "@/components/events/FeaturedEventCard";
import { EventsFilterBar } from "@/components/events/EventsFilterBar";
import { EventsRail } from "@/components/events/EventsRail";
import { EventCardPremium } from "@/components/events/EventCardPremium";
import { FeaturedEventSkeleton, EventsRailSkeleton } from "@/components/ShimmerSkeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// ── Location Prompt ───────────────────────────────────────────────────────────
const LocationPromptBanner = () => {
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  if (dismissed) return null;

  const handleEnable = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej)
      );
      const { lat, lng } = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      // Reverse geocode to get country
      let country: string | null = null;
      try {
        const { data: geoData } = await supabase.functions.invoke('geocode', {
          body: { lat, lng }
        });
        country = geoData?.country || null;
      } catch { /* ignore geocode errors */ }

      await supabase.from("profiles").update({
        location_data: { lat, lng } as any,
        ...(country ? { country } : {}),
      }).eq("id", user.id);

      // Refresh event lists with new location
      queryClient.invalidateQueries({ queryKey: ["visible-events"] });
      queryClient.invalidateQueries({ queryKey: ["other-city-events"] });

      toast.success("Location saved! Discovering events near you…");
      setDismissed(true);
    } catch {
      toast.error("Could not get location. Please check your browser permissions.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-4 rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <MapPin className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">Share your location to see events near you</p>
        <p className="text-xs text-muted-foreground mt-0.5">We'll show local events matched to your city</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setDismissed(true)}>
          Not now
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleEnable} disabled={loading}>
          {loading ? "Locating…" : "Enable"}
        </Button>
      </div>
    </motion.div>
  );
};

// ── Premium Upsell: Other Cities ──────────────────────────────────────────────
const HappeningElsewhere = () => {
  const { data: cities = [], isLoading } = useOtherCityEvents();
  if (isLoading || cities.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="px-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-foreground tracking-tight">Happening Elsewhere</h2>
        </div>
        <p className="text-xs text-muted-foreground">Events in cities you can explore with Premium</p>
      </div>

      {/* Blurred cards rail */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
        {cities.map((city) => (
          <div key={city.city} className="shrink-0 w-40 rounded-xl overflow-hidden border border-border bg-card relative">
            {city.sample_cover && (
              <div className="h-24 overflow-hidden">
                <img src={city.sample_cover} alt={city.city}
                  className="w-full h-full object-cover"
                  style={{ filter: "blur(8px)", transform: "scale(1.1)" }} />
              </div>
            )}
            {!city.sample_cover && (
              <div className="h-24 bg-secondary/50 flex items-center justify-center">
                <Globe className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-2.5">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" />📍 {city.city}
              </p>
              <p className="text-[10px] text-muted-foreground">{city.event_count} events</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA card */}
      <div className="mx-4 rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/10 to-accent/10 p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💎</span>
          <div className="flex-1">
            <h3 className="font-bold text-foreground text-base">Unlock Vibely Premium</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Explore events in any city, match with people worldwide, and never miss a vibe.
            </p>
            <Button size="sm" className="mt-3 bg-gradient-to-r from-primary to-accent text-primary-foreground gap-2">
              <Sparkles className="w-4 h-4" />Explore with Premium →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Scope Badge helper ────────────────────────────────────────────────────────
const ScopeLabel = ({ scope, city, country, distanceKm }: {
  scope?: string; city?: string | null; country?: string | null; distanceKm?: number | null;
}) => {
  if (scope === 'local' && city) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <MapPin className="w-3 h-3" />
        {city}{distanceKm != null ? ` · ${Math.round(distanceKm)}km away` : ''}
      </span>
    );
  }
  if (scope === 'regional' && country) {
    return <span className="text-xs text-muted-foreground">🏳️ {country}</span>;
  }
  return <span className="text-xs text-muted-foreground">🌍 Global Event</span>;
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const Events = () => {
  const { user } = useUserProfile();
  const { canCityBrowse } = useEntitlements();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<'nearby' | 'city'>('nearby');
  const [selectedCity, setSelectedCity] = useState<SelectedCity | null>(null);
  const [distanceKm, setDistanceKm] = useState(50);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [hasLocation, setHasLocation] = useState<boolean | null>(null);

  useEffect(() => {
    if (!canCityBrowse) {
      if (locationMode !== "nearby" || selectedCity) {
        setLocationMode("nearby");
        setSelectedCity(null);
        setDistanceKm(50);
      }
    }
  }, [canCityBrowse, locationMode, selectedCity]);

  const visibleOpts = useMemo((): UseVisibleEventsOptions => {
    const mode: "nearby" | "city" = !canCityBrowse ? "nearby" : locationMode;
    const city = mode === "city" && canCityBrowse ? selectedCity : null;
    const filterRadiusKm =
      distanceKm > 0 && (mode === "city" ? !!city : true) ? distanceKm : null;
    return {
      deviceLat: userCoords?.lat ?? null,
      deviceLng: userCoords?.lng ?? null,
      locationMode: mode,
      selectedCity: city,
      filterRadiusKm,
    };
  }, [canCityBrowse, locationMode, selectedCity, distanceKm, userCoords]);

  const { data: events = [], isLoading } = useVisibleEvents(visibleOpts);

  // Check if user has location set
  useEffect(() => {
    const checkLocation = async () => {
      if (!user?.id) return;
      const { data } = await supabase.from("profiles").select("location_data").eq("id", user.id).maybeSingle();
      const ld = data?.location_data as { lat?: number } | null;
      setHasLocation(!!(ld?.lat));
    };
    checkLocation();
  }, [user?.id]);

  useEffect(() => {
    if (userCoords) return;
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        if (result.state === 'granted') {
          navigator.geolocation.getCurrentPosition(
            (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => {}
          );
        }
      }).catch(() => {});
    }
  }, [userCoords]);

  const handleLocationModeChange = useCallback((mode: 'nearby' | 'city') => {
    setLocationMode(mode);
    if (mode === 'nearby') {
      setSelectedCity(null);
      setDistanceKm(50);
      if (!userCoords) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => { toast.error("Could not get location. Check your browser permissions."); }
        );
      }
    } else {
      setDistanceKm(25);
    }
  }, [userCoords]);

  const extraFilterCount = (selectedLanguage ? 1 : 0) + (locationMode === 'city' && selectedCity ? 1 : 0) + (!upcomingOnly ? 1 : 0);

  // Map to the shape EventCardPremium / EventsRail expect
  const mappedEvents = useMemo(() =>
    events.map(e => ({
      id: e.id,
      title: e.title,
      description: e.description,
      image: e.cover_image,
      date: new Date(e.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      time: new Date(e.event_date).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
      attendees: e.current_attendees,
      tags: e.tags || [],
      status: e.computed_status,
      eventDate: new Date(e.event_date),
      event_date_raw: e.event_date,
      duration_minutes: e.duration_minutes || 60,
      scope: e.scope,
      city: e.city,
      country: e.country,
      distance_km: e.distance_km,
      is_registered: e.is_registered,
      language: e.language,
      latitude: e.latitude,
      longitude: e.longitude,
    })), [events]);

  // Filtered
  const filteredEvents = useMemo(() => {
    const now = new Date();
    let filtered = mappedEvents;

    // 1. Upcoming-only (default ON — hides ended events)
    if (upcomingOnly) {
      filtered = filtered.filter(event => {
        const eventEnd = new Date(event.eventDate.getTime() + (event.duration_minutes || 60) * 60 * 1000);
        return eventEnd > now;
      });
    }

    // 2. Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.title.toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // 3. Date + interest filters
    if (activeFilters.length > 0) {
      filtered = filtered.filter(event => {
        const ed = event.eventDate;
        const isTonight = ed.toDateString() === now.toDateString();
        const isThisWeekend = (() => {
          const dow = now.getDay();
          const sat = new Date(now); sat.setDate(now.getDate() + (6 - dow));
          const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
          return ed >= sat && ed <= sun;
        })();
        const isThisWeek = (() => {
          const end = new Date(now); end.setDate(now.getDate() + (7 - now.getDay()));
          return ed <= end;
        })();

        const dateFilterNames = ["Tonight","This Weekend","This Week","Upcoming"];
        const interestFilterNames = activeFilters.filter(f => !dateFilterNames.includes(f));
        const dateMatch = (activeFilters.includes("Tonight") && isTonight) ||
          (activeFilters.includes("This Weekend") && isThisWeekend) ||
          (activeFilters.includes("This Week") && isThisWeek) ||
          (activeFilters.includes("Upcoming") && ed > now);
        const interestMatch = interestFilterNames.length === 0 ||
          event.tags.some(t => interestFilterNames.includes(t));

        const hasDateFilter = activeFilters.some(f => dateFilterNames.includes(f));
        if (!hasDateFilter) return interestMatch;
        if (interestFilterNames.length === 0) return dateMatch;
        return dateMatch && interestMatch;
      });
    }

    // 4. Language filter
    if (selectedLanguage) {
      filtered = filtered.filter(e => e.language === selectedLanguage);
    }

    return filtered;
  }, [mappedEvents, searchQuery, activeFilters, selectedLanguage, upcomingOnly]);

  const isFiltering = searchQuery || activeFilters.length > 0 || selectedLanguage || (locationMode === 'city' && selectedCity) || !upcomingOnly;

  // Group for discovery
  const liveEvents = mappedEvents.filter(e => e.status === 'live');
  const nearYou = mappedEvents.filter(e => e.status !== 'live' && e.scope === 'local');
  const globalEvents = mappedEvents.filter(e => e.status !== 'live' && (e.scope === 'global' || !e.scope));
  const regionalEvents = mappedEvents.filter(e => e.status !== 'live' && e.scope === 'regional');
  const featuredEvent = [...liveEvents, ...nearYou, ...globalEvents][0] || null;

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      {/* Header */}
      <header className="pt-safe-top px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Calendar className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Discover Events</h1>
            <p className="text-muted-foreground text-sm">Find your next vibe match</p>
          </div>
        </div>
      </header>

      {/* Location prompt */}
      {hasLocation === false && <LocationPromptBanner />}

      {/* Filter Bar */}
      <EventsFilterBar
        searchQuery={searchQuery} onSearchChange={setSearchQuery}
        activeFilters={activeFilters} onFiltersChange={setActiveFilters}
        selectedLanguage={selectedLanguage} onLanguageChange={setSelectedLanguage}
        locationMode={locationMode} onLocationModeChange={handleLocationModeChange}
        selectedCity={selectedCity} onSelectedCityChange={setSelectedCity}
        distanceKm={distanceKm} onDistanceChange={setDistanceKm}
        upcomingOnly={upcomingOnly} onUpcomingOnlyChange={setUpcomingOnly}
        extraFilterCount={extraFilterCount}
        canCityBrowse={canCityBrowse}
        onPremiumUpgrade={() => navigate('/premium')}
      />

      {/* Content */}
      <div className="space-y-8 pt-6">
        {isLoading ? (
          <div className="px-4 space-y-8">
            <FeaturedEventSkeleton />
            {[1, 2, 3].map((i) => <EventsRailSkeleton key={i} />)}
          </div>
        ) : isFiltering ? (
          <div className="px-4">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-muted-foreground">{filteredEvents.length} events found</span>
            </div>
            <AnimatePresence mode="popLayout">
              {filteredEvents.length > 0 ? (
                <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredEvents.map((event) => (
                    <motion.div key={event.id} layout initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2 }}>
                      <EventCardPremium id={event.id} title={event.title} image={event.image}
                        date={event.date} time={event.time} attendees={event.attendees}
                        tags={event.tags} status={event.status}
                        scope={(event as any).scope} city={(event as any).city}
                        country={(event as any).country} distanceKm={(event as any).distance_km}
                        language={(event as any).language} />
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  className="text-center py-16">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                    <Calendar className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">No events found</h3>
                  <p className="text-muted-foreground">Try adjusting your filters or search terms</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <>
            {/* Featured Event */}
            {featuredEvent && (
              <div className="px-4">
                <FeaturedEventCard id={featuredEvent.id} title={featuredEvent.title}
                  description={featuredEvent.description} image={featuredEvent.image}
                  eventDate={featuredEvent.eventDate} attendees={featuredEvent.attendees}
                  tags={featuredEvent.tags} language={(featuredEvent as any).language} />
              </div>
            )}

            {/* 🔴 Live Now */}
            {liveEvents.length > 0 && (
              <EventsRail title="Live Now" emoji="🔴" events={liveEvents} accentColor="pink" />
            )}

            {/* 📍 Near You */}
            {nearYou.length > 0 && (
              <EventsRail title="Near You" emoji="📍" events={nearYou} accentColor="cyan" />
            )}

            {/* 🌍 Global Events */}
            {globalEvents.length > 0 && (
              <EventsRail title="Global Events" emoji="🌍" events={globalEvents} accentColor="violet" />
            )}

            {/* 🏳️ In Your Region */}
            {regionalEvents.length > 0 && (
              <EventsRail title="In Your Region" emoji="🏳️" events={regionalEvents} accentColor="pink" />
            )}

            {/* Empty local state with premium nudge */}
            {nearYou.length === 0 && globalEvents.length === 0 && liveEvents.length === 0 && !isLoading && !canCityBrowse && (
              <div className="px-4 text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
                  <Calendar className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1">No events near you yet 💫</h3>
                <p className="text-sm text-muted-foreground mb-4">But there are events happening in other cities!</p>
                <Button className="bg-gradient-to-r from-primary to-accent gap-2">
                  <Sparkles className="w-4 h-4" />Go Premium to explore →
                </Button>
              </div>
            )}

            {/* Premium Upsell */}
            <HappeningElsewhere />
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Events;
