import { useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface LocationPayload {
  location: string;
  locationData: { lat: number; lng: number } | null;
  country: string;
}

interface LocationStepProps {
  location: string;
  onLocationChange: (payload: LocationPayload) => void;
  onNext: () => void;
}

type FeedbackTone = "info" | "error";
type FeedbackState = { tone: FeedbackTone; text: string } | null;

const MIN_SEARCH_CHARS = 2;

export const LocationStep = ({ location, onLocationChange, onNext }: LocationStepProps) => {
  const [detecting, setDetecting] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LocationPayload[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const continueHint = useMemo(() => {
    if (location) {
      return "You can continue now, or change this city first.";
    }
    if (showSearch) {
      return "Search for your city and tap a result to continue.";
    }
    return "Enable location or search for your city to continue.";
  }, [location, showSearch]);

  const openManualSearch = (nextFeedback?: FeedbackState) => {
    setShowSearch(true);
    setResults([]);
    setFeedback(nextFeedback ?? null);
  };

  const applyLocation = (payload: LocationPayload) => {
    onLocationChange(payload);
    setShowSearch(false);
    setSearchQuery("");
    setResults([]);
    setFeedback(null);
  };

  const autoDetect = async () => {
    if (!navigator.geolocation) {
      openManualSearch({
        tone: "error",
        text: "Location is not available in this browser. Search for your city instead.",
      });
      return;
    }

    setDetecting(true);
    setFeedback(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 300000,
        })
      );

      const { latitude: lat, longitude: lng } = position.coords;
      const { data, error } = await supabase.functions.invoke("geocode", {
        body: { lat, lng },
      });
      if (error) throw error;
      if (data?.error || !data?.city || !data?.country) {
        openManualSearch({
          tone: "error",
          text: "We couldn't match your current location to a city. Search manually instead.",
        });
        return;
      }

      applyLocation({
        location: data.formatted || `${data.city}, ${data.country}`,
        locationData: {
          lat: Number(data.lat ?? lat),
          lng: Number(data.lng ?? lng),
        },
        country: data.country,
      });
    } catch (error) {
      const geoError = error as GeolocationPositionError | undefined;
      if (geoError?.code === 1) {
        openManualSearch({
          tone: "error",
          text: "Location permission was denied. Search for your city instead, or enable access and try again.",
        });
        return;
      }

      openManualSearch({
        tone: "error",
        text: "We couldn't determine your city right now. Search for your city instead, or try again.",
      });
    } finally {
      setDetecting(false);
    }
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (query.length < MIN_SEARCH_CHARS) {
      setResults([]);
      setFeedback({
        tone: "error",
        text: `Enter at least ${MIN_SEARCH_CHARS} characters to search.`,
      });
      return;
    }

    setSearching(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke("forward-geocode", {
        body: { query, context: "onboarding" },
      });
      if (error) throw error;

      const items = Array.isArray(data) ? data : data?.results ?? [];
      const nextResults = items.slice(0, 5).map((r: any) => ({
        location: r.formatted || `${r.city}, ${r.country}`,
        locationData: r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
        country: r.country || "",
      }));

      setResults(nextResults);
      if (nextResults.length === 0) {
        setFeedback({
          tone: "info",
          text: "No cities matched that search. Try a nearby city or include the country.",
        });
      }
    } catch {
      setResults([]);
      setFeedback({
        tone: "error",
        text: "We couldn't search right now. Check your connection and try again.",
      });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Where are you based?
        </h1>
        <p className="text-muted-foreground mt-2">
          We use this to show events and people nearby.
        </p>
      </div>

      {location ? (
        <>
          <div className="flex items-center gap-3 p-4 rounded-xl glass-card">
            <MapPin className="w-5 h-5 text-primary flex-shrink-0" />
            <span className="text-foreground font-medium">{location}</span>
            <Check className="w-5 h-5 text-green-400 ml-auto flex-shrink-0" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                openManualSearch({
                  tone: "info",
                  text: "Search for a different city and tap a result to replace this one.",
                })
              }
              className="flex-1"
            >
              Search manually
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={autoDetect}
              disabled={detecting || searching}
              className="flex-1"
            >
              {detecting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Detecting...
                </span>
              ) : (
                "Use current location again"
              )}
            </Button>
          </div>
        </>
      ) : (
        <>
          {!showSearch ? (
            <>
              <Button
                type="button"
                onClick={autoDetect}
                disabled={detecting}
                className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
              >
                {detecting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Detecting...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Enable location
                  </span>
                )}
              </Button>
              <button
                type="button"
                onClick={() =>
                  openManualSearch({
                    tone: "info",
                    text: "Search for your city and tap a result to continue.",
                  })
                }
                className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
              >
                Search for your city instead
              </button>
            </>
          ) : null}
        </>
      )}

      {feedback ? (
        <div
          className={[
            "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
            feedback.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-foreground"
              : "border-border/70 bg-secondary/40 text-muted-foreground",
          ].join(" ")}
        >
          <AlertCircle
            className={
              feedback.tone === "error"
                ? "w-4 h-4 mt-0.5 text-destructive flex-shrink-0"
                : "w-4 h-4 mt-0.5 text-primary flex-shrink-0"
            }
          />
          <p>{feedback.text}</p>
        </div>
      ) : null}

      {showSearch ? (
        <>
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Search city"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setResults([]);
                setFeedback(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
              className="bg-secondary/50 border-secondary flex-1"
            />
            <Button
              type="button"
              onClick={() => void handleSearch()}
              disabled={searching}
              variant="secondary"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>

          <button
            type="button"
            onClick={autoDetect}
            disabled={detecting || searching}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left disabled:opacity-60"
          >
            {detecting ? "Trying your current location..." : "Try current location again"}
          </button>

          {results.length > 0 ? (
            <div className="space-y-1">
              {results.map((result, index) => (
                <button
                  key={`${result.location}-${index}`}
                  type="button"
                  onClick={() => applyLocation(result)}
                  className="w-full text-left p-3 rounded-lg hover:bg-secondary/50 transition-colors text-sm text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>{result.location}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <p className="text-xs text-muted-foreground text-center">
        {continueHint}
      </p>

      <Button
        onClick={onNext}
        disabled={!location}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>
    </div>
  );
};
