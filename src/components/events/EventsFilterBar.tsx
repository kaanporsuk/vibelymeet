import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventsFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilters: string[];
  onFiltersChange: (filters: string[]) => void;
}

const dateFilters = ["Tonight", "This Weekend", "This Week", "Upcoming"];
const interestFilters = ["Music", "Tech", "Art", "Gaming", "Food", "Wellness", "Outdoor"];

export const EventsFilterBar = ({
  searchQuery,
  onSearchChange,
  activeFilters,
  onFiltersChange,
}: EventsFilterBarProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [showInterests, setShowInterests] = useState(false);

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

  const toggleFilter = (filter: string) => {
    if (activeFilters.includes(filter)) {
      onFiltersChange(activeFilters.filter((f) => f !== filter));
    } else {
      onFiltersChange([...activeFilters, filter]);
    }
  };

  const clearFilters = () => {
    onFiltersChange([]);
    onSearchChange("");
  };

  return (
    <motion.div
      initial={{ y: 0, opacity: 1 }}
      animate={{
        y: isVisible ? 0 : -100,
        opacity: isVisible ? 1 : 0,
      }}
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
          {/* Toggle Interests Button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowInterests(!showInterests)}
            className={cn(
              "flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full",
              "border transition-all duration-200",
              showInterests
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-muted/50 border-border/50 text-muted-foreground hover:border-primary/30"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="text-sm font-medium">Filters</span>
            {activeFilters.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">
                {activeFilters.length}
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

          {/* Clear All */}
          <AnimatePresence>
            {activeFilters.length > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={clearFilters}
                className="flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium text-neon-pink hover:bg-neon-pink/10 transition-colors"
              >
                Clear all
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Interest Filters (Expandable) */}
        <AnimatePresence>
          {showInterests && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-2 pt-2">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
