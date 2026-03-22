import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, SlidersHorizontal, MapPin, ChevronDown, Globe, Lock, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_LANGUAGES } from "@/lib/eventLanguages";
import { supabase } from "@/integrations/supabase/client";

export interface SelectedCity {
  name: string;
  country: string;
  lat: number;
  lng: number;
  /** State / province when useful for disambiguation */
  region?: string | null;
}

interface EventsFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilters: string[];
  onFiltersChange: (filters: string[]) => void;
  selectedLanguage: string | null;
  onLanguageChange: (code: string | null) => void;
  locationMode: 'nearby' | 'city';
  onLocationModeChange: (mode: 'nearby' | 'city') => void;
  selectedCity: SelectedCity | null;
  onSelectedCityChange: (city: SelectedCity | null) => void;
  distanceKm: number;
  onDistanceChange: (km: number) => void;
  upcomingOnly: boolean;
  onUpcomingOnlyChange: (val: boolean) => void;
  extraFilterCount: number;
  isPremium: boolean;
  onPremiumUpgrade: () => void;
}

const dateFilters = ["Tonight", "This Weekend", "This Week", "Upcoming"];
const interestFilters = ["Music", "Tech", "Art", "Gaming", "Food", "Wellness", "Outdoor"];
const distanceOptions = [
  { km: 10, label: "10 km" },
  { km: 25, label: "25 km" },
  { km: 50, label: "50 km" },
  { km: 100, label: "100 km" },
];

interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  country: string;
  region?: string;
  display_name: string;
}

export const EventsFilterBar = ({
  searchQuery,
  onSearchChange,
  activeFilters,
  onFiltersChange,
  selectedLanguage,
  onLanguageChange,
  locationMode,
  onLocationModeChange,
  selectedCity,
  onSelectedCityChange,
  distanceKm,
  onDistanceChange,
  upcomingOnly,
  onUpcomingOnlyChange,
  extraFilterCount,
  isPremium,
  onPremiumUpgrade,
}: EventsFilterBarProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  // City search state
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<GeoResult[]>([]);
  const [isCitySearching, setIsCitySearching] = useState(false);
  const geocodeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY < 100) {
        setIsVisible(true);
      } else if (currentScrollY > lastScrollY) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }
      setLastScrollY(currentScrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    if (langOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [langOpen]);

  const toggleFilter = (filter: string) => {
    if (activeFilters.includes(filter)) {
      onFiltersChange(activeFilters.filter((f) => f !== filter));
    } else {
      onFiltersChange([...activeFilters, filter]);
    }
  };

  const clearAll = () => {
    onFiltersChange([]);
    onSearchChange("");
    onLanguageChange(null);
    onLocationModeChange('nearby');
    onSelectedCityChange(null);
    onDistanceChange(50);
    onUpcomingOnlyChange(true);
    setCityQuery('');
    setCityResults([]);
  };

  const handleCitySearch = useCallback((q: string) => {
    setCityQuery(q);
    if (geocodeRef.current) clearTimeout(geocodeRef.current);
    if (q.length < 2) { setCityResults([]); return; }
    geocodeRef.current = setTimeout(async () => {
      setIsCitySearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('forward-geocode', { body: { query: q } });
        if (!error && Array.isArray(data)) setCityResults(data);
        else setCityResults([]);
      } catch {
        setCityResults([]);
      }
      setIsCitySearching(false);
    }, 300);
  }, []);

  const selectCity = useCallback((result: GeoResult) => {
    onSelectedCityChange({
      name: result.city,
      country: result.country,
      lat: result.lat,
      lng: result.lng,
      region: result.region?.trim() || null,
    });
    setCityQuery('');
    setCityResults([]);
  }, [onSelectedCityChange]);

  const totalBadge = activeFilters.length + extraFilterCount;
  const langEntry = selectedLanguage
    ? EVENT_LANGUAGES.find(l => l.code === selectedLanguage)
    : null;

  return (
    <motion.div
      initial={{ y: 0, opacity: 1 }}
      animate={{ y: isVisible ? 0 : -100, opacity: isVisible ? 1 : 0 }}
      transition={{ duration: 0.3 }}
      className="sticky top-0 z-40 py-4 bg-background/80 backdrop-blur-xl border-b border-border/50"
    >
      <div className="container px-4 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events, vibes, or communities..."
            className={cn(
              "w-full pl-12 pr-12 py-3 rounded-2xl",
              "bg-muted/50 border border-border/50",
              "text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
              "transition-all duration-200"
            )}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filter Chips Row */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {/* Filters toggle */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowPanel(!showPanel)}
            className={cn(
              "flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full",
              "border transition-all duration-200",
              showPanel || totalBadge > 0
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-muted/50 border-border/50 text-muted-foreground hover:border-primary/30"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="text-sm font-medium">Filters</span>
            {totalBadge > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                {totalBadge}
              </span>
            )}
          </motion.button>

          {/* Date Filters */}
          {dateFilters.map((filter) => (
            <motion.button
              key={filter}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggleFilter(filter)}
              className={cn(
                "flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium",
                "border transition-all duration-200",
                activeFilters.includes(filter)
                  ? "bg-neon-violet/20 border-neon-violet/50 text-neon-violet shadow-[0_0_10px_rgba(139,92,246,0.2)]"
                  : "bg-muted/50 border-border/50 text-muted-foreground hover:border-neon-violet/30"
              )}
            >
              {filter}
            </motion.button>
          ))}

          {/* Language dropdown trigger (inline) */}
          <div className="relative flex-shrink-0" ref={langRef}>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setLangOpen(!langOpen)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium",
                "border transition-all duration-200",
                selectedLanguage
                  ? "bg-neon-cyan/15 border-neon-cyan/50 text-neon-cyan"
                  : "bg-muted/50 border-border/50 text-muted-foreground hover:border-neon-cyan/30"
              )}
            >
              {langEntry ? (
                <><span>{langEntry.flag}</span><span>{langEntry.label}</span></>
              ) : (
                <span>Language</span>
              )}
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", langOpen && "rotate-180")} />
            </motion.button>

            <AnimatePresence>
              {langOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-2 w-56 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50"
                >
                  <button
                    onClick={() => { onLanguageChange(null); setLangOpen(false); }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-sm transition-colors",
                      !selectedLanguage
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-muted/50"
                    )}
                  >
                    Any language
                  </button>
                  {EVENT_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => { onLanguageChange(lang.code); setLangOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2",
                        selectedLanguage === lang.code
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground hover:bg-muted/50"
                      )}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Clear All */}
          <AnimatePresence>
            {totalBadge > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={clearAll}
                className="flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium text-neon-pink hover:bg-neon-pink/10 transition-colors"
              >
                Clear all
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Expandable Panel: Categories + Location + Upcoming */}
        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-5 pt-2">
                {/* Categories */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Categories</p>
                  <div className="flex flex-wrap gap-2">
                    {interestFilters.map((filter, index) => (
                      <motion.button
                        key={filter}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => toggleFilter(filter)}
                        className={cn(
                          "px-4 py-2 rounded-full text-sm font-medium",
                          "border transition-all duration-200",
                          activeFilters.includes(filter)
                            ? "bg-neon-pink/20 border-neon-pink/50 text-neon-pink shadow-[0_0_10px_rgba(236,72,153,0.2)]"
                            : "bg-muted/30 border-border/30 text-muted-foreground hover:border-neon-pink/30"
                        )}
                      >
                        {filter}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Location */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Location</p>

                  {/* Mode pills */}
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => onLocationModeChange('nearby')}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200",
                        locationMode === 'nearby'
                          ? "bg-neon-cyan/15 border-neon-cyan/50 text-neon-cyan"
                          : "bg-muted/30 border-border/30 text-muted-foreground hover:border-neon-cyan/30"
                      )}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Nearby
                    </button>
                    <button
                      onClick={() => onLocationModeChange('city')}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200",
                        locationMode === 'city'
                          ? "bg-neon-cyan/15 border-neon-cyan/50 text-neon-cyan"
                          : "bg-muted/30 border-border/30 text-muted-foreground hover:border-neon-cyan/30"
                      )}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Choose a city
                      {!isPremium && <Lock className="w-3 h-3 opacity-60" />}
                    </button>
                  </div>

                  {/* City mode: upsell for free users */}
                  {locationMode === 'city' && !isPremium && (
                    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-accent/10 p-4 mb-3">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">💎</span>
                        <div className="flex-1">
                          <p className="font-semibold text-foreground text-sm">Discover events in other cities</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Search and join events anywhere in the world with Vibely Premium
                          </p>
                          <button
                            onClick={onPremiumUpgrade}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-primary to-accent text-primary-foreground"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Upgrade to Premium
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* City mode: search (premium users) */}
                  {locationMode === 'city' && isPremium && (
                    <div className="mb-3">
                      {selectedCity ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
                          <MapPin className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-medium text-foreground flex-1 truncate">
                            📍 {selectedCity.name}
                            {selectedCity.region ? `, ${selectedCity.region}` : ''}, {selectedCity.country}
                          </span>
                          <button
                            onClick={() => { onSelectedCityChange(null); setCityQuery(''); setCityResults([]); }}
                            className="p-0.5 rounded-full hover:bg-muted transition-colors shrink-0"
                          >
                            <X className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
                            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                            <input
                              type="text"
                              value={cityQuery}
                              onChange={(e) => handleCitySearch(e.target.value)}
                              placeholder="Search for a city..."
                              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                            />
                            {isCitySearching && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                          </div>
                          {cityResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-xl z-50 max-h-48 overflow-y-auto">
                              {cityResults.map((result, i) => (
                                <button
                                  key={`${result.lat}-${result.lng}-${i}`}
                                  onClick={() => selectCity(result)}
                                  className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-muted/50 transition-colors text-sm"
                                >
                                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium text-foreground">{result.city}</span>
                                    <span className="text-muted-foreground ml-1.5">
                                      {result.region ? `${result.region}, ` : ''}{result.country}
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          {cityQuery.length >= 2 && !isCitySearching && cityResults.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-2">No cities found</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Distance pills */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {distanceOptions.map(opt => (
                      <button
                        key={opt.km}
                        onClick={() => onDistanceChange(opt.km)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200",
                          distanceKm === opt.km
                            ? "bg-neon-cyan/15 border-neon-cyan/50 text-neon-cyan"
                            : "bg-muted/30 border-border/30 text-muted-foreground hover:border-neon-cyan/30"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upcoming only */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Event Status</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {upcomingOnly ? "Ended events are hidden" : "Showing all events including ended"}
                    </p>
                  </div>
                  <button
                    onClick={() => onUpcomingOnlyChange(!upcomingOnly)}
                    className={cn(
                      "relative w-11 h-6 rounded-full transition-colors duration-200",
                      upcomingOnly ? "bg-neon-violet" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200",
                        upcomingOnly && "translate-x-5"
                      )}
                    />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
