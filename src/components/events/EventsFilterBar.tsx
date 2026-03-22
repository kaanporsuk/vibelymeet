import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, SlidersHorizontal, MapPin, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_LANGUAGES } from "@/lib/eventLanguages";

interface EventsFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilters: string[];
  onFiltersChange: (filters: string[]) => void;
  selectedLanguage: string | null;
  onLanguageChange: (code: string | null) => void;
  locationEnabled: boolean;
  onLocationEnabledChange: (enabled: boolean) => void;
  distanceKm: number;
  onDistanceChange: (km: number) => void;
  upcomingOnly: boolean;
  onUpcomingOnlyChange: (val: boolean) => void;
  extraFilterCount: number;
}

const dateFilters = ["Tonight", "This Weekend", "This Week", "Upcoming"];
const interestFilters = ["Music", "Tech", "Art", "Gaming", "Food", "Wellness", "Outdoor"];
const distanceOptions = [
  { km: 0, label: "Anywhere" },
  { km: 10, label: "10 km" },
  { km: 25, label: "25 km" },
  { km: 50, label: "50 km" },
  { km: 100, label: "100 km" },
];

export const EventsFilterBar = ({
  searchQuery,
  onSearchChange,
  activeFilters,
  onFiltersChange,
  selectedLanguage,
  onLanguageChange,
  locationEnabled,
  onLocationEnabledChange,
  distanceKm,
  onDistanceChange,
  upcomingOnly,
  onUpcomingOnlyChange,
  extraFilterCount,
}: EventsFilterBarProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

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
    onLocationEnabledChange(false);
    onDistanceChange(0);
    onUpcomingOnlyChange(true);
  };

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
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => onLocationEnabledChange(!locationEnabled)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200",
                        locationEnabled
                          ? "bg-neon-cyan/15 border-neon-cyan/50 text-neon-cyan"
                          : "bg-muted/30 border-border/30 text-muted-foreground hover:border-neon-cyan/30"
                      )}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Near me
                    </button>
                    {locationEnabled && distanceOptions.map(opt => (
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
