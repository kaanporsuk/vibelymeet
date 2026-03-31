import { useState } from "react";
import { MapPin, Search, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface LocationPayload {
  location: string;
  locationData: { lat: number; lng: number } | null;
  city: string;
  country: string;
}

interface LocationStepProps {
  location: string;
  onLocationChange: (payload: LocationPayload) => void;
  onNext: () => void;
}

export const LocationStep = ({ location, onLocationChange, onNext }: LocationStepProps) => {
  const [detecting, setDetecting] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LocationPayload[]>([]);

  const autoDetect = async () => {
    setDetecting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 300000,
        })
      );

      const { latitude: lat, longitude: lng } = position.coords;
      const { data } = await supabase.functions.invoke("geocode", {
        body: { lat, lng },
      });

      if (data?.city) {
        onLocationChange({
          location: `${data.city}, ${data.country}`,
          locationData: { lat, lng },
          city: data.city,
          country: data.country,
        });
      }
    } catch {
      setShowSearch(true);
    } finally {
      setDetecting(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const { data } = await supabase.functions.invoke("forward-geocode", {
        body: { query: searchQuery.trim(), context: "onboarding" },
      });
      const items = Array.isArray(data) ? data : data?.results ?? [];
      setResults(
        items.slice(0, 5).map((r: any) => ({
          location: r.formatted || `${r.city}, ${r.country}`,
          locationData: r.lat && r.lng ? { lat: r.lat, lng: r.lng } : null,
          city: r.city || "",
          country: r.country || "",
        }))
      );
    } catch {
      setResults([]);
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
        <div className="flex items-center gap-3 p-4 rounded-xl glass-card">
          <MapPin className="w-5 h-5 text-primary flex-shrink-0" />
          <span className="text-foreground font-medium">{location}</span>
          <Check className="w-5 h-5 text-green-400 ml-auto flex-shrink-0" />
        </div>
      ) : (
        <>
          {!showSearch ? (
            <>
              <Button
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
                onClick={() => setShowSearch(true)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
              >
                Search for your city instead
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Search city"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  className="bg-secondary/50 border-secondary flex-1"
                />
                <Button onClick={handleSearch} disabled={searching} variant="secondary">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>
              {results.length > 0 && (
                <div className="space-y-1">
                  {results.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => onLocationChange(r)}
                      className="w-full text-left p-3 rounded-lg hover:bg-secondary/50 transition-colors text-sm text-foreground"
                    >
                      📍 {r.location}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

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
