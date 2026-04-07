import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Loader2, Lock, MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyProfile, updateMyProfile } from "@/services/profileService";
import { RelationshipIntent } from "@/components/RelationshipIntent";
import { useEntitlements } from "@/hooks/useEntitlements";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_EVENT_DISCOVERY_PREFS,
  DISTANCE_PRESETS,
  type EventDiscoveryPrefs,
  type EventDiscoverySelectedCity,
  firstInterestedInFromProfile,
  normalizeInterestedInForProfile,
  validateAgePreferencePair,
  clampAgePreference,
} from "@shared/eventDiscoveryContracts";

interface DiscoveryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPremiumNavigate?: () => void;
}

interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  country: string;
  region?: string;
  display_name: string;
}

const INTEREST_OPTIONS: { label: string; value: string }[] = [
  { label: "Men", value: "men" },
  { label: "Women", value: "women" },
  { label: "Everyone", value: "everyone" },
];

export function DiscoveryDrawer({ open, onOpenChange, onPremiumNavigate }: DiscoveryDrawerProps) {
  const { user } = useUserProfile();
  const { canCityBrowse, isLoading: entLoading } = useEntitlements();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [interested, setInterested] = useState<string>("everyone");
  const [relationshipIntent, setRelationshipIntent] = useState<string>("");
  const [ageMinStr, setAgeMinStr] = useState("");
  const [ageMaxStr, setAgeMaxStr] = useState("");
  const [eventPrefs, setEventPrefs] = useState<EventDiscoveryPrefs>(DEFAULT_EVENT_DISCOVERY_PREFS);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<GeoResult[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const geocodeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await fetchMyProfile();
      if (!data) {
        toast.error("Could not load profile");
        return;
      }
      setInterested(firstInterestedInFromProfile(data.interestedIn));
      setRelationshipIntent(data.relationshipIntent ?? data.lookingFor ?? "");
      setAgeMinStr(data.preferredAgeMin != null ? String(data.preferredAgeMin) : "");
      setAgeMaxStr(data.preferredAgeMax != null ? String(data.preferredAgeMax) : "");
      setEventPrefs(data.eventDiscoveryPrefs ?? DEFAULT_EVENT_DISCOVERY_PREFS);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const handleCitySearch = useCallback((q: string) => {
    setCityQuery(q);
    if (geocodeRef.current) clearTimeout(geocodeRef.current);
    if (q.length < 2) {
      setCityResults([]);
      return;
    }
    geocodeRef.current = setTimeout(async () => {
      setCitySearching(true);
      try {
        const { data, error } = await supabase.functions.invoke("forward-geocode", { body: { query: q } });
        if (!error && Array.isArray(data)) setCityResults(data as GeoResult[]);
        else setCityResults([]);
      } catch {
        setCityResults([]);
      }
      setCitySearching(false);
    }, 300);
  }, []);

  const selectCity = useCallback((result: GeoResult) => {
    const next: EventDiscoverySelectedCity = {
      name: result.city,
      country: result.country,
      lat: result.lat,
      lng: result.lng,
      region: result.region?.trim() || null,
    };
    setEventPrefs((p) => ({ ...p, selectedCity: next, locationMode: "city" }));
    setCityQuery("");
    setCityResults([]);
  }, []);

  const handleSave = async () => {
    if (!user?.id) return;
    const minP = clampAgePreference(ageMinStr.trim() === "" ? null : ageMinStr);
    const maxP = clampAgePreference(ageMaxStr.trim() === "" ? null : ageMaxStr);
    const { min: amin, max: amax } = validateAgePreferencePair(minP, maxP);
    if ((ageMinStr.trim() !== "" && minP === null) || (ageMaxStr.trim() !== "" && maxP === null)) {
      toast.error("Age preferences must be between 18 and 99, or left blank.");
      return;
    }

    setSaving(true);
    try {
      const interestedArr = normalizeInterestedInForProfile(interested);
      await updateMyProfile({
        interestedIn: interestedArr,
        relationshipIntent: relationshipIntent.trim() ? relationshipIntent.trim() : null,
        preferredAgeMin: amin,
        preferredAgeMax: amax,
        eventDiscoveryPrefs: eventPrefs,
      });
      await queryClient.invalidateQueries({ queryKey: ["visible-events"] });
      await queryClient.invalidateQueries({ queryKey: ["other-city-events"] });
      await queryClient.invalidateQueries({ queryKey: ["event-discovery-prefs"] });
      toast.success("Discovery preferences saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle className="font-display flex items-center gap-2">
            <Compass className="w-5 h-5 text-primary" />
            Discovery preferences
          </DrawerTitle>
          <DrawerDescription>
            Control who you see in event decks and your default event list filters. City browse still requires Premium at
            runtime — saved city is kept for when you upgrade.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 overflow-y-auto space-y-6 max-h-[60vh]">
          {loading || entLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Interested in</h3>
                <p className="text-xs text-muted-foreground">Used for event lobby / deck matching</p>
                <div className="flex flex-wrap gap-2">
                  {INTEREST_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setInterested(opt.value)}
                      className={cn(
                        "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                        interested === opt.value
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-muted/40 border-border text-muted-foreground hover:border-primary/30",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Relationship intent</h3>
                <RelationshipIntent
                  selected={relationshipIntent}
                  onSelect={setRelationshipIntent}
                  editable
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Age range in decks</h3>
                <p className="text-xs text-muted-foreground">Optional. People without an age may still appear.</p>
                <div className="flex gap-3 items-center">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Min</label>
                    <input
                      type="number"
                      min={18}
                      max={99}
                      placeholder="Any"
                      value={ageMinStr}
                      onChange={(e) => setAgeMinStr(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Max</label>
                    <input
                      type="number"
                      min={18}
                      max={99}
                      placeholder="Any"
                      value={ageMaxStr}
                      onChange={(e) => setAgeMaxStr(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Default event list</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEventPrefs((p) => ({ ...p, locationMode: "nearby", selectedCity: null }))}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium",
                      eventPrefs.locationMode === "nearby"
                        ? "bg-primary/15 border-primary text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    <MapPin className="w-4 h-4" />
                    Nearby
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventPrefs((p) => ({ ...p, locationMode: "city" }))}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium relative",
                      eventPrefs.locationMode === "city"
                        ? "bg-primary/15 border-primary text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {!canCityBrowse && <Lock className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 opacity-70" />}
                    <span className={cn(!canCityBrowse && "pl-4")}>City</span>
                  </button>
                </div>
                {!canCityBrowse && (
                  <button
                    type="button"
                    onClick={onPremiumNavigate}
                    className="w-full flex items-center gap-2 text-xs text-primary hover:underline"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Upgrade to use city browse in the events tab
                  </button>
                )}

                {eventPrefs.locationMode === "city" && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">City</label>
                    <input
                      type="text"
                      value={cityQuery}
                      onChange={(e) => handleCitySearch(e.target.value)}
                      placeholder="Search city…"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                    {citySearching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    {cityResults.length > 0 && (
                      <ul className="rounded-lg border border-border divide-y max-h-36 overflow-y-auto">
                        {cityResults.map((r, i) => (
                          <li key={`${r.lat}-${r.lng}-${i}`}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                              onClick={() => selectCity(r)}
                            >
                              {r.display_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {eventPrefs.selectedCity && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {eventPrefs.selectedCity.name}, {eventPrefs.selectedCity.country}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Radius</p>
                  <div className="flex flex-wrap gap-2">
                    {DISTANCE_PRESETS.map((km) => (
                      <button
                        key={km}
                        type="button"
                        onClick={() => setEventPrefs((p) => ({ ...p, distanceKm: km }))}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-semibold border",
                          eventPrefs.distanceKm === km
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {km} km
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <DrawerFooter>
          <Button variant="gradient" onClick={() => void handleSave()} disabled={saving || loading}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
