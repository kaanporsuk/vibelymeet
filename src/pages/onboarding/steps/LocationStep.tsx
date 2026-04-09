import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { hasConfirmedOnboardingLocation, isValidLocationData } from "@shared/onboardingTypes";

interface LocationPayload {
  location: string;
  locationData: { lat: number; lng: number } | null;
  country: string;
}

interface SearchResult extends LocationPayload {
  city: string;
  detail: string;
}

interface LocationStepProps {
  location: string;
  locationData: { lat: number; lng: number } | null;
  country: string;
  onLocationChange: (payload: LocationPayload) => void;
  onNext: () => void;
}

type FeedbackTone = "info" | "error";
type FeedbackState = { tone: FeedbackTone; text: string } | null;
type SearchState = "idle" | "loading" | "results" | "empty" | "error";

const MIN_SEARCH_CHARS = 2;
const EMPTY_LOCATION_PAYLOAD: LocationPayload = {
  location: "",
  locationData: null,
  country: "",
};

type ForwardGeocodeResult = {
  formatted?: string;
  display_name?: string;
  city?: string;
  country?: string;
  region?: string;
  lat?: number;
  lng?: number;
};

function buildSearchResult(raw: ForwardGeocodeResult): SearchResult | null {
  const city = typeof raw.city === "string" ? raw.city.trim() : "";
  const country = typeof raw.country === "string" ? raw.country.trim() : "";
  const region = typeof raw.region === "string" ? raw.region.trim() : "";
  const location = [raw.formatted, raw.display_name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim()
    ?? (city && country ? `${city}, ${country}` : "");
  const lat = typeof raw.lat === "number" ? raw.lat : Number.NaN;
  const lng = typeof raw.lng === "number" ? raw.lng : Number.NaN;

  if (!city || !country || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    city,
    country,
    detail: [region, country].filter(Boolean).join(", "),
    location,
    locationData: { lat, lng },
  };
}

function buildConfirmedLocationLabel(location: string, country: string): string {
  const trimmedLocation = location.trim();
  const trimmedCountry = country.trim();

  if (!trimmedLocation) return trimmedCountry;
  if (!trimmedCountry) return trimmedLocation;

  return trimmedLocation.toLowerCase().includes(trimmedCountry.toLowerCase())
    ? trimmedLocation
    : `${trimmedLocation}, ${trimmedCountry}`;
}

export const LocationStep = ({
  location,
  locationData,
  country,
  onLocationChange,
  onNext,
}: LocationStepProps) => {
  const [detecting, setDetecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState(location);
  const [searching, setSearching] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const confirmedLocation = useMemo(() => {
    if (
      !hasConfirmedOnboardingLocation({ location, locationData, country })
      || !isValidLocationData(locationData)
    ) {
      return null;
    }

    return {
      label: buildConfirmedLocationLabel(location, country),
      country: country.trim(),
      locationData,
    };
  }, [country, location, locationData]);

  useEffect(() => {
    if (confirmedLocation && !searchQuery.trim()) {
      setSearchQuery(confirmedLocation.label);
    }
  }, [confirmedLocation, searchQuery]);

  const continueHint = useMemo(() => {
    if (confirmedLocation) {
      return "Location confirmed. You can continue, or edit the text to pick a different city.";
    }
    if (searchState === "loading") {
      return "Searching for city matches...";
    }
    if (searchQuery.trim()) {
      return "Choose one result below to confirm your city.";
    }
    return "Use current location or search for your city, then confirm one result to continue.";
  }, [confirmedLocation, searchQuery, searchState]);

  const applyLocation = (payload: LocationPayload) => {
    onLocationChange(payload);
    setSearchQuery(buildConfirmedLocationLabel(payload.location, payload.country));
    setResults([]);
    setSearchState("idle");
    setFeedback(null);
  };

  const autoDetect = async () => {
    if (!navigator.geolocation) {
      setSearchState("error");
      setFeedback({
        tone: "error",
        text: "Location is not available in this browser. Search for your city instead.",
      });
      return;
    }

    setDetecting(true);
    setSearchState("idle");
    setResults([]);
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
        setSearchState("error");
        setFeedback({
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
        setSearchState("error");
        setFeedback({
          tone: "error",
          text: "Location permission was denied. Search for your city instead, or enable access and try again.",
        });
        return;
      }

      setSearchState("error");
      setFeedback({
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
      setSearchState("error");
      setFeedback({
        tone: "error",
        text: `Enter at least ${MIN_SEARCH_CHARS} characters to search.`,
      });
      return;
    }

    setSearching(true);
    setSearchState("loading");
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke("forward-geocode", {
        body: { query, context: "onboarding" },
      });
      if (error) throw error;

      const items = Array.isArray(data) ? data : data?.results ?? [];
      const nextResults = items
        .slice(0, 5)
        .map((result: ForwardGeocodeResult) => buildSearchResult(result))
        .filter((result): result is SearchResult => result !== null);

      setResults(nextResults);
      if (nextResults.length === 0) {
        setSearchState("empty");
      } else {
        setSearchState("results");
      }
    } catch {
      setResults([]);
      setSearchState("error");
      setFeedback({
        tone: "error",
        text: "We couldn't search right now. Check your connection and try again.",
      });
    } finally {
      setSearching(false);
    }
  };

  const handleSearchQueryChange = (nextValue: string) => {
    const changedConfirmedLocation =
      !!confirmedLocation && nextValue.trim() !== confirmedLocation.label.trim();

    setSearchQuery(nextValue);
    setResults([]);
    setSearchState("idle");

    if (changedConfirmedLocation) {
      onLocationChange(EMPTY_LOCATION_PAYLOAD);
      setFeedback({
        tone: "info",
        text: "Location changed. Choose a new result to confirm it before you continue.",
      });
      return;
    }

    setFeedback(null);
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

      {confirmedLocation ? (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-400" />
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-green-300">
                Confirmed location
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {confirmedLocation.label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Coordinates confirmed for nearby matches and event discovery.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          No location confirmed yet. Search for a city and choose one result, or use your current location.
        </div>
      )}

      <Button
        type="button"
        onClick={autoDetect}
        disabled={detecting || searching}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        {detecting ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Detecting...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> {confirmedLocation ? "Use current location again" : "Use current location"}
          </span>
        )}
      </Button>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="onboarding-location-search"
            className="text-sm font-medium text-foreground"
          >
            Search for your city
          </label>
          <span className="text-xs text-muted-foreground">Pick one result to confirm it</span>
        </div>
        <div className="flex gap-2">
          <Input
            id="onboarding-location-search"
            autoFocus
            placeholder="Search city or country"
            value={searchQuery}
            onChange={(e) => {
              handleSearchQueryChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSearch();
              }
            }}
            className="flex-1 border-secondary bg-secondary/50"
          />
          <Button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching || detecting}
            variant="secondary"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

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

      {searchState === "loading" ? (
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p>Searching for matching cities...</p>
        </div>
      ) : null}

      {searchState === "empty" ? (
        <div className="rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          No cities matched that search. Try a nearby city or include the country.
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Select a result to confirm
          </p>
          <div className="space-y-2">
            {results.map((result, index) => (
              <button
                key={`${result.location}-${index}`}
                type="button"
                onClick={() => applyLocation(result)}
                className="w-full rounded-xl border border-border/70 bg-secondary/20 p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
              >
                <span className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">{result.city}</span>
                    <span className="block text-xs text-muted-foreground">
                      {result.detail || result.country}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-primary">Tap to confirm</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground text-center">
        {continueHint}
      </p>

      <Button
        onClick={onNext}
        disabled={!confirmedLocation}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>
    </div>
  );
};
