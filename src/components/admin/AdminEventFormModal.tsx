import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Calendar, Clock, Users, Image, Save, Sparkles, MapPin, DollarSign,
  Eye, Crown, UserCircle, ChevronDown, ChevronUp, Upload, Loader2,
  Globe, Flag, RefreshCw, Search, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { EVENT_LANGUAGES } from "@/lib/eventLanguages";
import React from "react";
import { callAdminRpc, createAdminIdempotencyKey, createAdminTargetIdempotencyKey } from "@/lib/adminRpc";
import { formatAdminUtcDateTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";
import { resolveAdminErrorMessage, resolveAdminFunctionErrorMessage } from "@/lib/adminErrorResolver";
import { useEventCategories } from "@/hooks/useEventCategories";
import { inferEventCategoryKeysFromLegacyTags } from "@clientShared/eventCategories";
import { clientRequestIdForUploadFile } from "@/services/imageUploadService";

interface AdminEventFormModalProps {
  event?: AdminEventFormEvent | null;
  onClose: () => void;
}

const currencies = [
  { id: "EUR", label: "Euro", symbol: "€" },
  { id: "USD", label: "US Dollar", symbol: "$" },
  { id: "GBP", label: "British Pound", symbol: "£" },
  { id: "PLN", label: "Polish Złoty", symbol: "zł" },
];

const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Scope = "global" | "regional" | "local";
type RecurrenceType = "weekly" | "biweekly" | "monthly_day" | "monthly_weekday" | "yearly";
type RecurrenceEnd = "never" | "after" | "on_date";

type VibeTagRow = {
  id: string;
  label: string;
  emoji?: string | null;
};

type AdminEventFormEvent = {
  id: string;
  title?: string | null;
  description?: string | null;
  language?: string | null;
  cover_image?: string | null;
  cover_media_asset_id?: string | null;
  event_date?: string | null;
  duration_minutes?: number | null;
  tags?: string[] | null;
  category_keys?: string[] | null;
  vibes?: string[] | null;
  max_male_attendees?: number | null;
  max_female_attendees?: number | null;
  max_nonbinary_attendees?: number | null;
  current_attendees?: number | null;
  scope?: Scope | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_km?: number | null;
  visibility?: string | null;
  is_free?: boolean | null;
  price_amount?: number | null;
  price_currency?: string | null;
  is_recurring?: boolean | null;
  recurrence_type?: RecurrenceType | null;
  recurrence_days?: number[] | null;
};

type EventSavePayload = {
  title: string;
  description: string;
  cover_image: string;
  language: string | null;
  event_date: string;
  duration_minutes: number;
  max_attendees: number;
  tags: string[];
  category_keys: string[];
  vibes: string[];
  max_male_attendees: number | null;
  max_female_attendees: number | null;
  max_nonbinary_attendees: number | null;
  visibility: string;
  is_free: boolean;
  price_amount: number;
  price_currency: string;
  scope: Scope;
  latitude: number | null;
  longitude: number | null;
  radius_km: number | null;
  city: string | null;
  country: string | null;
  is_location_specific: boolean;
  is_recurring: boolean;
  recurrence_type: RecurrenceType | null;
  recurrence_days: number[] | null;
  recurrence_count: number | null;
  recurrence_ends_at: string | null;
  status?: string;
};

interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  country: string;
  display_name: string;
}

function isSupportedCoverImageFile(file: File): boolean {
  const declaredType = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (declaredType.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalEventStart(dateValue: string, timeValue: string): Date | null {
  if (!dateValue || !timeValue) return null;
  const date = new Date(`${dateValue}T${timeValue}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLocalEndOfDay(dateValue: string): Date | null {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ordinalSuffix(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return "th";
  const lastDigit = value % 10;
  if (lastDigit === 1) return "st";
  if (lastDigit === 2) return "nd";
  if (lastDigit === 3) return "rd";
  return "th";
}

function sameLocalClock(source: Date, target: Date): Date {
  const next = new Date(target);
  next.setHours(source.getHours(), source.getMinutes(), 0, 0);
  return next;
}

function addMonthsClamped(source: Date, monthsToAdd: number): Date {
  const target = new Date(source);
  const originalDay = source.getDate();
  target.setDate(1);
  target.setMonth(source.getMonth() + monthsToAdd);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return sameLocalClock(source, target);
}

function addYearsClamped(source: Date, yearsToAdd: number): Date {
  const target = new Date(source);
  const originalMonth = source.getMonth();
  const originalDay = source.getDate();
  target.setDate(1);
  target.setFullYear(source.getFullYear() + yearsToAdd);
  target.setMonth(originalMonth);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return sameLocalClock(source, target);
}

function getNthWeekdayOfMonth(source: Date, monthsToAdd: number): Date {
  const weekday = source.getDay();
  const nth = Math.ceil(source.getDate() / 7);
  const firstOfMonth = new Date(source.getFullYear(), source.getMonth() + monthsToAdd, 1);
  const offset = (weekday - firstOfMonth.getDay() + 7) % 7;
  const candidate = new Date(firstOfMonth);
  candidate.setDate(1 + offset + (nth - 1) * 7);
  if (candidate.getMonth() !== firstOfMonth.getMonth()) {
    candidate.setDate(candidate.getDate() - 7);
  }
  return sameLocalClock(source, candidate);
}

function buildRecurrencePreview({
  eventDate,
  eventTime,
  recurrenceType,
  generateCount,
  recurrenceEndsAt,
}: {
  eventDate: string;
  eventTime: string;
  recurrenceType: RecurrenceType;
  generateCount: number;
  recurrenceEndsAt?: Date | null;
}): Date[] {
  const start = parseLocalEventStart(eventDate, eventTime);
  if (!start) return [];
  const limit = Math.max(1, Math.min(5, Number.isFinite(generateCount) ? generateCount : 5));
  const isWithinEnd = (candidate: Date) => !recurrenceEndsAt || candidate.getTime() <= recurrenceEndsAt.getTime();

  if (recurrenceType === "weekly" || recurrenceType === "biweekly") {
    const intervalDays = recurrenceType === "biweekly" ? 14 : 7;
    const results: Date[] = [];
    for (let occurrence = 1; results.length < limit; occurrence += 1) {
      const candidate = sameLocalClock(start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + intervalDays * occurrence));
      if (!isWithinEnd(candidate)) break;
      results.push(candidate);
    }
    return results;
  }

  if (recurrenceType === "monthly_day") {
    const results: Date[] = [];
    let cursor = start;
    while (results.length < limit) {
      cursor = addMonthsClamped(cursor, 1);
      if (!isWithinEnd(cursor)) break;
      results.push(cursor);
    }
    return results;
  }

  if (recurrenceType === "monthly_weekday") {
    return Array.from({ length: limit }, (_, index) => getNthWeekdayOfMonth(start, index + 1)).filter(isWithinEnd);
  }

  const results: Date[] = [];
  let cursor = start;
  while (results.length < limit) {
    cursor = addYearsClamped(cursor, 1);
    if (!isWithinEnd(cursor)) break;
    results.push(cursor);
  }
  return results;
}

// ✅ CollapsibleSection defined OUTSIDE the component to prevent re-mount on parent re-render
interface CollapsibleSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  isOpen: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}

const CollapsibleSection = memo(({
  title,
  icon: Icon,
  isOpen,
  onToggle,
  badge,
  children,
}: CollapsibleSectionProps) => (
  <div className="rounded-xl border border-border overflow-hidden">
    <button type="button" onClick={onToggle}
      className="w-full flex items-center justify-between p-4 bg-secondary/30 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground uppercase tracking-wider">{title}</span>
        {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
      </div>
      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
    </button>
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
          <div className="p-4 space-y-4 bg-card">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
));
CollapsibleSection.displayName = "CollapsibleSection";

const AdminEventFormModal = ({ event, onClose }: AdminEventFormModalProps) => {
  const queryClient = useQueryClient();
  const isEditing = !!event;
  const createEventIntentIdRef = useRef(createAdminIdempotencyKey("admin_create_event_form"));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const formId = `admin-event-form-${event?.id ?? "new"}`;

  const [openSections, setOpenSections] = useState({
    dateTime: true,
    capacity: false,
    location: true,
    recurrence: false,
    visibility: false,
    pricing: false,
    vibes: false,
    themes: false,
  });

  const toggleSection = useCallback((section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const { data: vibeTags = [] } = useQuery({
    queryKey: ['vibe-tags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vibe_tags').select('*').order('category');
      if (error) throw new Error(resolveAdminErrorMessage(error, "Could not load vibe tags"));
      return data || [];
    },
  });
  const { data: eventCategories = [] } = useEventCategories({ includeInactive: true });

  // ── Basic Info ──
  const [title, setTitle] = useState(event?.title || "");
  const [description, setDescription] = useState(event?.description || "");
  const [language, setLanguage] = useState<string>(event?.language || "");
  const [coverImage, setCoverImage] = useState(event?.cover_image || "");
  const [currentCoverAssetId, setCurrentCoverAssetId] = useState<string | null>(event?.cover_media_asset_id ?? null);
  const [eventDate, setEventDate] = useState(
    event?.event_date ? format(new Date(event.event_date), "yyyy-MM-dd") : ""
  );
  const [eventTime, setEventTime] = useState(
    event?.event_date ? format(new Date(event.event_date), "HH:mm") : ""
  );
  const [duration, setDuration] = useState(String(event?.duration_minutes || 60));
  const [selectedTags] = useState<string[]>(event?.tags || []);
  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<string[]>(
    event?.category_keys?.length
      ? event.category_keys
      : inferEventCategoryKeysFromLegacyTags(event?.tags || [])
  );
  const [selectedVibes, setSelectedVibes] = useState<string[]>(event?.vibes || []);
  const [newCategoryEmoji, setNewCategoryEmoji] = useState("✨");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);

  // ── Capacity ──
  const [maxMaleAttendees, setMaxMaleAttendees] = useState(String(event?.max_male_attendees || ""));
  const [maxFemaleAttendees, setMaxFemaleAttendees] = useState(String(event?.max_female_attendees || ""));
  const [maxNonbinaryAttendees, setMaxNonbinaryAttendees] = useState(String(event?.max_nonbinary_attendees || ""));

  // ── Scope & Location ──
  const [scope, setScope] = useState<Scope>(event?.scope || "global");
  const [cityQuery, setCityQuery] = useState(event?.city || "");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [geoSearchError, setGeoSearchError] = useState<string | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [resolvedLat, setResolvedLat] = useState<number | null>(event?.latitude ?? null);
  const [resolvedLng, setResolvedLng] = useState<number | null>(event?.longitude ?? null);
  const [resolvedCity, setResolvedCity] = useState<string>(event?.city || "");
  const [resolvedCountry, setResolvedCountry] = useState<string>(event?.country || "");
  const [radiusKm, setRadiusKm] = useState<number>(event?.radius_km || 50);
  const [customRadius, setCustomRadius] = useState("");

  // ── Visibility ──
  const [visibility, setVisibility] = useState(event?.visibility || "all");

  // ── Pricing ──
  const [isFree, setIsFree] = useState(event?.is_free !== false);
  const [priceAmount, setPriceAmount] = useState(String(event?.price_amount || "0"));
  const [priceCurrency, setPriceCurrency] = useState(event?.price_currency || "EUR");

  // ── Recurrence ──
  const [isRecurring, setIsRecurring] = useState(event?.is_recurring || false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(event?.recurrence_type || "weekly");
  const [selectedDays, setSelectedDays] = useState<number[]>(
    event?.recurrence_days || (eventDate ? [new Date(eventDate + "T00:00").getDay()] : [3])
  );
  const [recurrenceEnd, setRecurrenceEnd] = useState<RecurrenceEnd>("never");
  const [endsAfterCount, setEndsAfterCount] = useState("8");
  const [endsOnDate, setEndsOnDate] = useState("");
  const [generateCount, setGenerateCount] = useState(8);
  const [isGenerating, setIsGenerating] = useState(false);
  const [timeNowMs, setTimeNowMs] = useState(Date.now());
  const todayDateInput = useMemo(() => formatDateInputValue(new Date(timeNowMs)), [timeNowMs]);
  const eventStart = useMemo(() => parseLocalEventStart(eventDate, eventTime), [eventDate, eventTime]);
  const eventStartsInPast = Boolean(eventStart && eventStart.getTime() <= timeNowMs);
  const isWeeklyCadence = recurrenceType === "weekly" || recurrenceType === "biweekly";
  const eventStartWeekday = eventStart?.getDay() ?? null;
  const effectiveWeeklyRecurrenceDays = useMemo(
    () => (isWeeklyCadence ? (eventStartWeekday == null ? selectedDays.slice(0, 1) : [eventStartWeekday]) : selectedDays),
    [eventStartWeekday, isWeeklyCadence, selectedDays],
  );
  const recurrencePreviewCount = useMemo(() => {
    const requestedCount = Number.isFinite(generateCount) ? generateCount : 5;
    if (recurrenceEnd !== "after") return requestedCount;
    const endCount = parseInt(endsAfterCount, 10);
    return Number.isFinite(endCount) ? Math.min(requestedCount, endCount) : requestedCount;
  }, [endsAfterCount, generateCount, recurrenceEnd]);
  const recurrencePreviewEndsAt = useMemo(
    () => (recurrenceEnd === "on_date" ? parseLocalEndOfDay(endsOnDate) : null),
    [endsOnDate, recurrenceEnd],
  );
  const dateTimeWarningId = `${formId}-date-time-warning`;
  const recurrencePreview = useMemo(
    () =>
      isRecurring
        ? buildRecurrencePreview({
            eventDate,
            eventTime,
            recurrenceType,
            generateCount: recurrencePreviewCount,
            recurrenceEndsAt: recurrencePreviewEndsAt,
          })
        : [],
    [eventDate, eventTime, isRecurring, recurrencePreviewCount, recurrencePreviewEndsAt, recurrenceType],
  );

  const totalCapacity = (parseInt(maxMaleAttendees, 10) || 0) +
    (parseInt(maxFemaleAttendees, 10) || 0) +
    (parseInt(maxNonbinaryAttendees, 10) || 0);

  /** Matches save payload: empty gender fields fall back to default max (50). */
  const effectiveMaxAttendees = totalCapacity > 0 ? totalCapacity : 50;
  const confirmedHeadcount = isEditing ? (event?.current_attendees ?? 0) : 0;
  const capacityBelowConfirmed =
    isEditing && effectiveMaxAttendees < confirmedHeadcount;

  const { data: genderRpc } = useQuery({
    queryKey: ["admin-event-gender-counts", event?.id],
    enabled: isEditing && !!event?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_event_confirmed_gender_counts", {
        p_event_id: event!.id,
      });
      if (error) throw new Error(resolveAdminErrorMessage(error, "Could not load event gender counts"));
      return data as {
        ok?: boolean;
        male?: number;
        female?: number;
        nonbinary?: number;
        other_or_unspecified?: number;
        error?: string;
      };
    },
  });

  const genderCountsOk = genderRpc?.ok === true;
  const confirmedMale = genderCountsOk ? (genderRpc.male ?? 0) : 0;
  const confirmedFemale = genderCountsOk ? (genderRpc.female ?? 0) : 0;
  const confirmedNonbinary = genderCountsOk ? (genderRpc.nonbinary ?? 0) : 0;
  const confirmedOtherGender = genderCountsOk ? (genderRpc.other_or_unspecified ?? 0) : 0;

  const parseGenderCapInput = (raw: string): number | null => {
    const t = raw.trim();
    if (t === "") return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  };

  const capMale = parseGenderCapInput(maxMaleAttendees);
  const capFemale = parseGenderCapInput(maxFemaleAttendees);
  const capNonbinary = parseGenderCapInput(maxNonbinaryAttendees);

  const genderCapWarnings: string[] = [];
  if (genderCountsOk) {
    if (capMale !== null && confirmedMale > capMale) {
      genderCapWarnings.push(
        `Male cap (${capMale}) is below currently confirmed men (${confirmedMale}).`
      );
    }
    if (capFemale !== null && confirmedFemale > capFemale) {
      genderCapWarnings.push(
        `Female cap (${capFemale}) is below currently confirmed women (${confirmedFemale}).`
      );
    }
    if (capNonbinary !== null && confirmedNonbinary > capNonbinary) {
      genderCapWarnings.push(
        `Non-binary cap (${capNonbinary}) is below currently confirmed non-binary attendees (${confirmedNonbinary}).`
      );
    }
  }

  useEffect(() => {
    setTimeNowMs(Date.now());
    const timer = window.setInterval(() => setTimeNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isRecurring || !isWeeklyCadence || eventStartWeekday == null) return;
    setSelectedDays((prev) => (prev.length === 1 && prev[0] === eventStartWeekday ? prev : [eventStartWeekday]));
  }, [eventStartWeekday, isRecurring, isWeeklyCadence]);

  // City search debounce
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestGeoQueryRef = useRef("");
  const handleCitySearch = useCallback(async (q: string) => {
    setCityQuery(q);
    latestGeoQueryRef.current = q;
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    if (q.length < 2) { setGeoResults([]); setGeoSearchError(null); return; }
    geocodeTimeout.current = setTimeout(async () => {
      const requestedQuery = q;
      setIsGeocoding(true);
      try {
        const { data, error } = await supabase.functions.invoke('forward-geocode', { body: { query: q } });
        if (latestGeoQueryRef.current !== requestedQuery) return;
        if (error || !Array.isArray(data)) {
          setGeoResults([]);
          setGeoSearchError(await resolveAdminFunctionErrorMessage(error, data, "City search is unavailable"));
          return;
        }
        setGeoResults(data);
        setGeoSearchError(null);
      } catch (geocodeError) {
        if (latestGeoQueryRef.current !== requestedQuery) return;
        setGeoResults([]);
        setGeoSearchError(resolveAdminErrorMessage(geocodeError, "City search is unavailable"));
      } finally {
        if (latestGeoQueryRef.current === requestedQuery) setIsGeocoding(false);
      }
    }, 300);
  }, []);

  const selectGeoResult = (r: GeoResult) => {
    setResolvedLat(r.lat);
    setResolvedLng(r.lng);
    setResolvedCity(r.city);
    setResolvedCountry(r.country);
    setCityQuery(r.city);
    setGeoResults([]);
  };

  // Image upload — Bunny CDN
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isSupportedCoverImageFile(file)) {
      adminToast.error({ id: "admin-event-cover-type", title: "Please upload an image file" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      adminToast.error({ id: "admin-event-cover-size", title: "Image must be less than 20MB" });
      return;
    }
    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const { uploadEventCoverWithMediaSdk } = await import("@/lib/mediaSdk/webStorageUploads");
      const clientRequestId = clientRequestIdForUploadFile(file, `event-cover:${event?.id ?? "new"}`);
      const uploaded = await uploadEventCoverWithMediaSdk({
        file,
        accessToken: session.access_token,
        eventId: event?.id ?? undefined,
        clientRequestId,
        expectedCurrentCoverAssetId: event?.id ? currentCoverAssetId : undefined,
      });
      setCoverImage(uploaded.url);
      if (uploaded.assetId) setCurrentCoverAssetId(uploaded.assetId);
      adminToast.success({ id: "admin-event-cover-uploaded", title: "Cover image uploaded" });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "stale_cover_update") {
        const nextCoverAssetId = "currentCoverAssetId" in error && typeof error.currentCoverAssetId === "string"
          ? error.currentCoverAssetId
          : null;
        setCurrentCoverAssetId(nextCoverAssetId);
      }
      adminToast.error({
        id: "admin-event-cover-upload-error",
        title: "Failed to upload image",
        description: resolveAdminErrorMessage(error, "Please try again."),
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Recurrence label
  const getRecurrenceLabel = () => {
    if (!eventDate) return "";
    const d = new Date(eventDate + "T00:00");
    switch (recurrenceType) {
      case 'weekly': return `Every ${DAYS_FULL[d.getDay()]}`;
      case 'biweekly': return `Every other ${DAYS_FULL[d.getDay()]}`;
      case 'monthly_day': return `Monthly on the ${d.getDate()}${ordinalSuffix(d.getDate())}`;
      case 'monthly_weekday': {
        const nth = Math.ceil(d.getDate() / 7);
        const sfx = ordinalSuffix(nth);
        return `Monthly on the ${nth}${sfx} ${DAYS_FULL[d.getDay()]}`;
      }
      case 'yearly': return `Yearly on ${format(d, 'MMM d')}`;
      default: return "";
    }
  };

  // Save mutation
  const saveEvent = useMutation({
    mutationFn: async () => {
      const eventDateTime = parseLocalEventStart(eventDate, eventTime);
      if (!eventDateTime) throw new Error("Choose a valid event date and time.");
      const eventData: EventSavePayload = {
        title, description,
        cover_image: coverImage,
        language: language || null,
        event_date: eventDateTime.toISOString(),
        duration_minutes: parseInt(duration, 10),
        max_attendees: totalCapacity || 50,
        tags: selectedTags,
        category_keys: selectedCategoryKeys,
        vibes: selectedVibes,
        max_male_attendees: maxMaleAttendees ? parseInt(maxMaleAttendees, 10) : null,
        max_female_attendees: maxFemaleAttendees ? parseInt(maxFemaleAttendees, 10) : null,
        max_nonbinary_attendees: maxNonbinaryAttendees ? parseInt(maxNonbinaryAttendees, 10) : null,
        visibility, is_free: isFree,
        price_amount: isFree ? 0 : parseFloat(priceAmount),
        price_currency: priceCurrency,
        scope,
        latitude: scope === 'local' ? resolvedLat : null,
        longitude: scope === 'local' ? resolvedLng : null,
        radius_km: scope === 'local' ? radiusKm : null,
        city: scope === 'local' ? resolvedCity : null,
        country: scope !== 'global' ? resolvedCountry : null,
        is_location_specific: scope === 'local',
        is_recurring: isRecurring,
        recurrence_type: isRecurring ? recurrenceType : null,
        recurrence_days: isRecurring && ['weekly', 'biweekly'].includes(recurrenceType) ? effectiveWeeklyRecurrenceDays : null,
        recurrence_count: isRecurring && recurrenceEnd === 'after' ? parseInt(endsAfterCount, 10) : null,
        recurrence_ends_at: isRecurring && recurrenceEnd === 'on_date' && endsOnDate ? parseLocalEndOfDay(endsOnDate)?.toISOString() ?? null : null,
      };

      if (!isEditing) eventData.status = 'upcoming';

      if (isEditing) {
        const payload = await callAdminRpc("admin_update_event", {
          p_event_id: event.id,
          p_payload: eventData,
          p_idempotency_key: createAdminTargetIdempotencyKey("admin_update_event", event.id, {
            before: {
              title: event.title ?? null,
              event_date: event.event_date ?? null,
              duration_minutes: event.duration_minutes ?? null,
              current_attendees: event.current_attendees ?? null,
              is_recurring: event.is_recurring ?? null,
              recurrence_type: event.recurrence_type ?? null,
            },
            after: eventData,
          }),
        });
        return { id: event.id, action: 'edit_event', eventData: (payload.event || eventData) as EventSavePayload };
      } else {
        const payload = await callAdminRpc("admin_create_event", {
          p_payload: eventData,
          p_idempotency_key: createAdminTargetIdempotencyKey(
            "admin_create_event",
            createEventIntentIdRef.current,
            eventData,
          ),
        });
        return { id: String(payload.event_id), action: 'create_event', eventData: (payload.event || eventData) as EventSavePayload };
      }
    },
    onSuccess: async (result) => {
      if (result.action === 'create_event') {
        try {
          const { data, error } = await supabase.functions.invoke('event-notifications', {
            body: { type: 'event_created', eventId: result.id, eventTitle: title, eventDate: result.eventData.event_date, eventDescription: description }
          });
          if (error || !data?.success) {
            adminToast.warning({
              id: `admin-event-notification-warning-${result.id}`,
              title: "Event created, but announcement email did not complete",
              description: await resolveAdminFunctionErrorMessage(error, data, "Announcement email failed"),
            });
          }
        } catch (notificationError) {
          adminToast.warning({
            id: `admin-event-notification-warning-${result.id}`,
            title: "Event created, but announcement email did not complete",
            description: resolveAdminErrorMessage(notificationError, "Announcement email failed"),
          });
        }

        if (isRecurring) {
          setIsGenerating(true);
          try {
            const recurringPayload = await callAdminRpc("admin_generate_recurring_events", {
              p_parent_event_id: result.id,
              p_count: generateCount,
              p_idempotency_key: createAdminTargetIdempotencyKey("admin_generate_recurring_events", result.id, {
                count: generateCount,
              }),
            });
            adminToast.success({
              id: `admin-event-save-${result.id}`,
              title: `Created recurring event + ${Number(recurringPayload.generated_count || 0)} upcoming occurrences`,
              description: "The event list and discover feeds are refreshing.",
            });
          } catch (_) {
            adminToast.success({
              id: `admin-event-save-${result.id}`,
              title: "Event created successfully",
              description: "Recurring occurrence generation did not report additional rows.",
            });
          } finally {
            setIsGenerating(false);
          }
        } else {
          adminToast.success({
            id: `admin-event-save-${result.id}`,
            title: "Event created successfully",
            description: "The event list and discover feeds are refreshing.",
          });
        }
      } else {
        adminToast.success({
          id: `admin-event-save-${result.id}`,
          title: "Event updated successfully",
          description: "The event list and discover feeds are refreshing.",
        });
      }

      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      queryClient.invalidateQueries({ queryKey: ['visible-events'] });
      queryClient.invalidateQueries({ queryKey: ['events-discover'] });
      onClose();
    },
    onError: (error) => {
      adminToast.error({
        id: "admin-event-save-error",
        title: "Failed to save event",
        description: resolveAdminErrorMessage(error, "Please try again."),
      });
    },
  });

  const toggleCategory = (categoryKey: string) => setSelectedCategoryKeys(prev => prev.includes(categoryKey) ? prev.filter(t => t !== categoryKey) : [...prev, categoryKey]);
  const toggleVibe = (vibeLabel: string) => setSelectedVibes(prev => prev.includes(vibeLabel) ? prev.filter(v => v !== vibeLabel) : [...prev, vibeLabel]);
  const selectWeeklyRecurrenceDay = (day: number) => {
    setSelectedDays([day]);
    const dateForWeekday = eventDate
      ? parseLocalEventStart(eventDate, eventTime || "00:00")
      : null;
    if (!dateForWeekday) return;
    const dayOffset = (day - dateForWeekday.getDay() + 7) % 7;
    const nextDate = new Date(dateForWeekday);
    nextDate.setDate(dateForWeekday.getDate() + dayOffset);
    setEventDate(formatDateInputValue(nextDate));
  };

  const createCategory = useMutation({
    mutationFn: async () => {
      return callAdminRpc<{ category: { key: string; label: string; emoji: string } }>("admin_create_event_category", {
        p_label: newCategoryLabel,
        p_emoji: newCategoryEmoji,
      });
    },
    onSuccess: async (payload) => {
      const key = payload.category?.key;
      if (key) {
        setSelectedCategoryKeys(prev => prev.includes(key) ? prev : [...prev, key]);
      }
      setNewCategoryLabel("");
      setNewCategoryEmoji("✨");
      setShowNewCategory(false);
      await queryClient.invalidateQueries({ queryKey: ["event-categories"] });
      adminToast.success({ id: "admin-event-category-created", title: "Category created" });
    },
    onError: (error) => {
      adminToast.error({
        id: "admin-event-category-create-error",
        title: "Failed to create category",
        description: resolveAdminErrorMessage(error, "Failed to create category"),
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !coverImage || !eventDate || !eventTime) {
      adminToast.error({ id: "admin-event-required-fields", title: "Please fill in all required fields" });
      return;
    }

    if (!eventStart) {
      adminToast.error({
        id: "admin-event-invalid-start",
        title: "Choose a valid event date and time",
      });
      return;
    }

    if (eventStart.getTime() <= Date.now()) {
      if (!isEditing) {
        adminToast.error({
          id: "admin-event-past-start",
          title: "Choose a future start time",
          description: "New events cannot be scheduled in the past because web, native, and mobile clients hide or finalize past event rows differently.",
        });
        return;
      }

      const ok = window.confirm(
        [
          "This event start time is already in the past.",
          "",
          "Saving can affect admin reporting, discovery visibility, and client-side event lifecycle handling.",
          "",
          "Save anyway?",
        ].join("\n"),
      );
      if (!ok) return;
    }

    const durationMinutes = parseInt(duration, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      adminToast.error({ id: "admin-event-duration-invalid", title: "Duration must be between 15 and 480 minutes" });
      return;
    }

    if (effectiveMaxAttendees < 1 || effectiveMaxAttendees > 10000) {
      adminToast.error({ id: "admin-event-capacity-invalid", title: "Capacity must be between 1 and 10000 attendees" });
      return;
    }

    for (const [label, raw] of [
      ["Male spots", maxMaleAttendees],
      ["Female spots", maxFemaleAttendees],
      ["Non-binary spots", maxNonbinaryAttendees],
    ] as const) {
      if (!raw.trim()) continue;
      const cap = parseInt(raw, 10);
      if (!Number.isFinite(cap) || cap < 0 || cap > 10000) {
        adminToast.error({ id: `admin-event-gender-cap-${label}`, title: `${label} must be a number from 0 to 10000` });
        return;
      }
    }

    if (!isFree) {
      const price = parseFloat(priceAmount);
      if (!Number.isFinite(price) || price <= 0) {
        adminToast.error({ id: "admin-event-price-invalid", title: "Paid events require a price greater than 0" });
        return;
      }
    }

    if (scope === "regional" && !resolvedCountry.trim()) {
      adminToast.error({ id: "admin-event-regional-country-required", title: "Regional events require a country" });
      return;
    }

    if (scope === "local") {
      const hasValidCoordinates =
        resolvedLat != null &&
        resolvedLng != null &&
        Number.isFinite(resolvedLat) &&
        Number.isFinite(resolvedLng) &&
        resolvedLat >= -90 &&
        resolvedLat <= 90 &&
        resolvedLng >= -180 &&
          resolvedLng <= 180;
      if (!hasValidCoordinates || !resolvedCity.trim()) {
        adminToast.error({ id: "admin-event-local-city-required", title: "Local events require a selected city with coordinates" });
        return;
      }
      if (!Number.isFinite(radiusKm) || radiusKm < 5 || radiusKm > 500) {
        adminToast.error({ id: "admin-event-radius-invalid", title: "Local event radius must be between 5 and 500 km" });
        return;
      }
    }

    if (isRecurring) {
      if (["weekly", "biweekly"].includes(recurrenceType) && effectiveWeeklyRecurrenceDays.length === 0) {
        adminToast.error({ id: "admin-event-recurrence-day-required", title: "Recurring weekly events require at least one day" });
        return;
      }
      if (recurrenceEnd === "after") {
        const count = parseInt(endsAfterCount, 10);
        if (!Number.isFinite(count) || count < 1 || count > 100) {
          adminToast.error({ id: "admin-event-recurrence-count-invalid", title: "Recurrence end count must be between 1 and 100" });
          return;
        }
      }
      if (recurrenceEnd === "on_date") {
        const recurrenceEndDate = parseLocalEndOfDay(endsOnDate);
        if (!recurrenceEndDate || Number.isNaN(recurrenceEndDate.getTime())) {
          adminToast.error({ id: "admin-event-recurrence-end-invalid", title: "Choose a valid recurrence end date" });
          return;
        }
        if (recurrenceEndDate.getTime() < eventStart.getTime()) {
          adminToast.error({ id: "admin-event-recurrence-end-before-start", title: "Recurrence end date must be on or after the event start" });
          return;
        }
      }
      if (generateCount < 1 || generateCount > 52) {
        adminToast.error({ id: "admin-event-generate-count-invalid", title: "Generated occurrence count must be between 1 and 52" });
        return;
      }
    }

    if (genderCapWarnings.length > 0) {
      const ok = window.confirm(
        [
          "Per-gender caps are below current confirmed counts for at least one bucket:",
          "",
          ...genderCapWarnings,
          "",
          "Admission paths still use total max_attendees only — these caps are planning hints and are not auto-enforced on the server.",
          "Lowering caps does not remove or rebalance confirmed attendees.",
          "",
          "Save anyway?",
        ].join("\n")
      );
      if (!ok) return;
    }

    if (capacityBelowConfirmed) {
      const ok = window.confirm(
        [
          `Save with total capacity ${effectiveMaxAttendees} while ${confirmedHeadcount} user(s) still have confirmed seats?`,
          '',
          'The backend does not automatically remove or demote confirmed attendees when capacity goes down.',
          'To enforce the new cap, remove specific people from the Attendees panel after saving.',
          '',
          'Save anyway?',
        ].join('\n')
      );
      if (!ok) return;
    }
    saveEvent.mutate();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-display text-foreground">
              {isEditing ? 'Edit Event' : 'Create New Event'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isEditing ? 'Update event details' : 'Fill in the event details below'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto">
        <form id={formId} onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4 space-y-4 pb-32">

          {/* Basic Info */}
          <div className="rounded-xl border border-border p-4 space-y-4 bg-card">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground uppercase tracking-wider">Basic Info</span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Event Title *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Tech Founders Speed Dating" className="bg-secondary/50" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell guests what to expect..." className="bg-secondary/50 min-h-[80px]" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">Language (optional)</Label>
              <Select value={language || "none"} onValueChange={(v) => setLanguage(v === "none" ? "" : v)}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="Any language / Multilingual" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No preference</SelectItem>
                  {EVENT_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="coverImage">Cover Image *</Label>
              <div className="flex gap-2">
                <Input id="coverImage" value={coverImage} onChange={(e) => setCoverImage(e.target.value)}
                  placeholder="https://... or upload below" className="bg-secondary/50" />
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                <Button type="button" variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                </Button>
              </div>
              {coverImage && (
                <div className="w-full h-32 rounded-lg overflow-hidden bg-secondary/50">
                  <img src={coverImage} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>

          {/* Date & Time */}
          <CollapsibleSection title="Date & Time" icon={Calendar} isOpen={openSections.dateTime}
            onToggle={() => toggleSection('dateTime')}
            badge={eventDate && eventTime ? `${eventDate} ${eventTime}` : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${formId}-event-date`}>Date (local admin time) *</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id={`${formId}-event-date`}
                    type="date"
                    value={eventDate}
                    min={!isEditing ? todayDateInput : undefined}
                    onChange={(e) => setEventDate(e.target.value)}
                    aria-describedby={eventStartsInPast ? dateTimeWarningId : undefined}
                    className="pl-10 bg-secondary/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-event-time`}>Time (local admin time) *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id={`${formId}-event-time`}
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    aria-describedby={eventStartsInPast ? dateTimeWarningId : undefined}
                    className="pl-10 bg-secondary/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Duration (min)</Label>
                <Input type="number" min="15" max="480" step="15" value={duration}
                  onChange={(e) => setDuration(e.target.value)} className="bg-secondary/50" />
              </div>
            </div>
            {eventStartsInPast && (
              <div
                id={dateTimeWarningId}
                role="alert"
                className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm"
              >
                <p className="font-medium text-amber-200">
                  {isEditing ? "This event starts in the past" : "New events must start in the future"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved event timestamps are stored in UTC. The fields above use this admin device&apos;s local time.
                </p>
              </div>
            )}
          </CollapsibleSection>

          {/* Recurrence */}
          <CollapsibleSection title="🔁 Recurrence" icon={RefreshCw} isOpen={openSections.recurrence}
            onToggle={() => toggleSection('recurrence')}
            badge={isRecurring ? getRecurrenceLabel() : 'One-time'}>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
              <Switch id="recurringToggle" checked={isRecurring} onCheckedChange={setIsRecurring} />
              <Label htmlFor="recurringToggle" className="text-sm">Recurring Event</Label>
            </div>

            {isRecurring && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Repeat</Label>
                  <Select value={recurrenceType} onValueChange={(v) => setRecurrenceType(v as RecurrenceType)}>
                    <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                      <SelectItem value="monthly_day">Monthly (same date)</SelectItem>
                      <SelectItem value="monthly_weekday">Monthly (same weekday)</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {['weekly', 'biweekly'].includes(recurrenceType) && (
                  <div className="space-y-2">
                    <Label>On weekday</Label>
                    <div className="flex gap-1">
                      {DAYS_SHORT.map((d, i) => {
                        const daySelected = effectiveWeeklyRecurrenceDays.includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => selectWeeklyRecurrenceDay(i)}
                            aria-label={`${DAYS_FULL[i]} recurrence day ${daySelected ? "selected" : "not selected"}`}
                            aria-pressed={daySelected}
                            title={`Set recurrence day to ${DAYS_FULL[i]}`}
                            className={`w-9 h-9 rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${daySelected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'}`}
                          >
                            <span aria-hidden="true">{d}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {['monthly_day', 'monthly_weekday', 'yearly'].includes(recurrenceType) && eventDate && (
                  <p className="text-sm text-muted-foreground italic">{getRecurrenceLabel()}</p>
                )}

                <div className="space-y-2">
                  <Label>Ends</Label>
                  <div className="space-y-2">
                    {(['never', 'after', 'on_date'] as RecurrenceEnd[]).map((opt) => (
                      <label key={opt} className="flex items-center gap-3 cursor-pointer">
                        <input type="radio" name="recurrenceEnd" value={opt}
                          checked={recurrenceEnd === opt} onChange={() => setRecurrenceEnd(opt)}
                          className="accent-primary" />
                        <span className="text-sm text-foreground">
                          {opt === 'never' && 'Never'}
                          {opt === 'after' && (
                            <span className="flex items-center gap-2">
                              After
                              <Input type="number" value={endsAfterCount} onChange={(e) => setEndsAfterCount(e.target.value)}
                                className="w-20 h-7 text-sm bg-secondary/50" min="1" max="100" />
                              occurrences
                            </span>
                          )}
                          {opt === 'on_date' && (
                            <span className="flex items-center gap-2">
                              On date
                              <Input type="date" value={endsOnDate} min={eventDate || todayDateInput} onChange={(e) => setEndsOnDate(e.target.value)}
                                className="h-7 text-sm bg-secondary/50" />
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                  <span className="text-sm text-muted-foreground">{isEditing ? "Preview next" : "Generate next"}</span>
                  <Input type="number" value={generateCount} onChange={(e) => setGenerateCount(parseInt(e.target.value) || 8)}
                    className="w-20 h-8 text-sm bg-secondary/50" min="1" max="52" />
                  <span className="text-sm text-muted-foreground">{isEditing ? "occurrences" : "occurrences on save"}</span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/20 p-3">
                  <p className="text-sm font-medium text-foreground">Recurrence preview</p>
                  {recurrencePreview.length > 0 ? (
                    <>
                      <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {recurrencePreview.map((previewDate) => (
                          <li key={previewDate.toISOString()}>
                            {formatAdminUtcDateTime(previewDate)}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Preview follows the backend recurrence cadence and is shown as stored UTC timestamps; form inputs use local admin time.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Add a valid date and time to preview generated occurrences.
                    </p>
                  )}
                </div>
              </div>
            )}
          </CollapsibleSection>

          {/* Capacity */}
          <CollapsibleSection title="Capacity" icon={UserCircle} isOpen={openSections.capacity}
            onToggle={() => toggleSection('capacity')}
            badge={totalCapacity > 0 ? `${totalCapacity} spots` : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Male Spots</Label>
                <Input type="number" value={maxMaleAttendees} onChange={(e) => setMaxMaleAttendees(e.target.value)}
                  placeholder="25" className="bg-secondary/50" />
              </div>
              <div className="space-y-2">
                <Label>Female Spots</Label>
                <Input type="number" value={maxFemaleAttendees} onChange={(e) => setMaxFemaleAttendees(e.target.value)}
                  placeholder="25" className="bg-secondary/50" />
              </div>
              <div className="space-y-2">
                <Label>Non-Binary</Label>
                <Input type="number" value={maxNonbinaryAttendees} onChange={(e) => setMaxNonbinaryAttendees(e.target.value)}
                  placeholder="10" className="bg-secondary/50" />
              </div>
            </div>
            {totalCapacity > 0 && (
              <p className="text-sm text-muted-foreground">
                Total Capacity: <span className="text-foreground font-medium">{totalCapacity}</span>
              </p>
            )}
            {isEditing && (
              <p className="text-xs text-muted-foreground">
                Saved <code className="text-[10px]">max_attendees</code>:{" "}
                <span className="text-foreground font-medium">{effectiveMaxAttendees}</span> (defaults to 50 if
                all gender caps are empty). Confirmed headcount:{" "}
                <span className="text-foreground font-medium">{confirmedHeadcount}</span>.
              </p>
            )}
            {isEditing && genderCountsOk && (
              <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Confirmed by profile gender (server)</p>
                <p>
                  Men: <strong className="text-foreground">{confirmedMale}</strong>
                  {" · "}Women: <strong className="text-foreground">{confirmedFemale}</strong>
                  {" · "}Non-binary: <strong className="text-foreground">{confirmedNonbinary}</strong>
                  {confirmedOtherGender > 0 && (
                    <>
                      {" · "}Other/unspecified:{" "}
                      <strong className="text-foreground">{confirmedOtherGender}</strong>
                    </>
                  )}
                </p>
                <p>
                  Empty male/female/non-binary fields mean <strong className="text-foreground">no separate cap</strong>{" "}
                  for that bucket in this form (we won&apos;t warn on that bucket).{" "}
                  <strong className="text-foreground">Admission still uses total max_attendees only</strong> — per-gender
                  numbers are not enforced on register in this codebase.
                </p>
              </div>
            )}
            {genderCapWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-200">Per-gender cap below confirmed distribution</p>
                <ul className="text-xs text-muted-foreground mt-1 list-disc pl-4 space-y-1">
                  {genderCapWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {capacityBelowConfirmed && (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-200">Capacity is below confirmed headcount</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Confirmed seats: <strong className="text-foreground">{confirmedHeadcount}</strong>. New
                  cap: <strong className="text-foreground">{effectiveMaxAttendees}</strong>. The system does
                  not auto-demote confirmed attendees—you can still save, then adjust the roster in Attendees if
                  needed.
                </p>
              </div>
            )}
          </CollapsibleSection>

          {/* Location & Scope */}
          <CollapsibleSection title="Location & Scope" icon={MapPin} isOpen={openSections.location}
            onToggle={() => toggleSection('location')}
            badge={scope === 'local' ? `📍 ${resolvedCity || 'Set city'} · ${radiusKm}km` : scope === 'regional' ? `🏳️ ${resolvedCountry || 'Regional'}` : '🌍 Global'}>

            {/* Scope Selector */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'global', icon: '🌍', label: 'Global', sub: 'Everyone can join' },
                { value: 'regional', icon: '🏳️', label: 'Regional', sub: 'Country based' },
                { value: 'local', icon: '📍', label: 'Local', sub: 'City + Range' },
              ] as { value: Scope; icon: string; label: string; sub: string }[]).map((opt) => (
                <motion.button key={opt.value} type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={() => setScope(opt.value)}
                  className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-1 ${scope === opt.value
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'}`}>
                  <span className="text-2xl">{opt.icon}</span>
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground text-center">{opt.sub}</span>
                </motion.button>
              ))}
            </div>

            {scope === 'global' && (
              <p className="text-sm text-muted-foreground">This event is visible to all users worldwide.</p>
            )}

            {scope === 'regional' && (
              <div className="space-y-2">
                <Label>Country</Label>
                <Input value={resolvedCountry} onChange={(e) => setResolvedCountry(e.target.value)}
                  placeholder="e.g., Turkey" className="bg-secondary/50" />
                <p className="text-xs text-muted-foreground">Only users in this country will see this event.</p>
              </div>
            )}

            {scope === 'local' && (
              <div className="space-y-4">
                {/* City Search */}
                <div className="space-y-2 relative">
                  <Label>City</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    {isGeocoding && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
                    <Input value={cityQuery} onChange={(e) => handleCitySearch(e.target.value)}
                      placeholder="Search city name..." className="pl-10 pr-10 bg-secondary/50" />
                  </div>
                  {geoSearchError && (
                    <p role="alert" className="text-xs text-destructive">{geoSearchError}</p>
                  )}
                  {geoResults.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                      {geoResults.map((r, i) => (
                        <button key={i} type="button" onClick={() => selectGeoResult(r)}
                          className="w-full text-left px-4 py-2.5 hover:bg-secondary/50 transition-colors border-b border-border/50 last:border-0">
                          <p className="text-sm font-medium text-foreground">{r.city}, {r.country}</p>
                          <p className="text-xs text-muted-foreground truncate">{r.display_name}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {resolvedLat != null && resolvedCity && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm text-foreground font-medium">{resolvedCity}, {resolvedCountry}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{resolvedLat.toFixed(3)}, {resolvedLng?.toFixed(3)}</span>
                  </div>
                )}

                {/* Radius */}
                <div className="space-y-2">
                  <Label>Radius</Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[10, 25, 50, 100].map((r) => (
                      <button key={r} type="button" onClick={() => { setRadiusKm(r); setCustomRadius(""); }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${radiusKm === r && !customRadius
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'}`}>
                        {r}km
                      </button>
                    ))}
                    <div className="flex items-center gap-1">
                      <Input type="number" value={customRadius} min="5" max="500"
                        onChange={(e) => { setCustomRadius(e.target.value); if (e.target.value) setRadiusKm(parseInt(e.target.value, 10)); }}
                        placeholder="Custom" className="w-24 h-8 text-sm bg-secondary/50" />
                      <span className="text-sm text-muted-foreground">km</span>
                    </div>
                  </div>
                  {resolvedCity && (
                    <p className="text-xs text-muted-foreground">
                      📍 {resolvedCity} · {radiusKm}km radius
                    </p>
                  )}
                </div>
              </div>
            )}
          </CollapsibleSection>

          {/* Visibility */}
          <CollapsibleSection title="Visibility" icon={Eye} isOpen={openSections.visibility}
            onToggle={() => toggleSection('visibility')}
            badge={visibility === 'all' ? 'All Users' : visibility === 'premium' ? 'Premium' : 'VIP'}>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'all', label: 'All Users', icon: Users },
                { value: 'premium', label: 'Premium', icon: Crown },
                { value: 'vip', label: 'VIP Only', icon: Sparkles },
              ].map((option) => {
                const Icon = option.icon;
                return (
                  <motion.button key={option.value} type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={() => setVisibility(option.value)}
                    className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-2 ${visibility === option.value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'}`}>
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{option.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </CollapsibleSection>

          {/* Pricing */}
          <CollapsibleSection title="Pricing" icon={DollarSign} isOpen={openSections.pricing}
            onToggle={() => toggleSection('pricing')}
            badge={isFree ? 'Free' : `${priceAmount} ${priceCurrency}`}>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
              <Switch id="freeToggle" checked={isFree} onCheckedChange={setIsFree} />
              <Label htmlFor="freeToggle" className="text-sm">Free Event</Label>
            </div>
            {!isFree && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Price</Label>
                  <Input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)}
                    placeholder="0.00" className="bg-secondary/50" />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={priceCurrency} onValueChange={setPriceCurrency}>
                    <SelectTrigger className="bg-secondary/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {currencies.map((curr) => (
                        <SelectItem key={curr.id} value={curr.id}>{curr.symbol} {curr.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CollapsibleSection>

          {/* Vibes */}
          <CollapsibleSection title="Target Vibes" icon={Sparkles} isOpen={openSections.vibes}
            onToggle={() => toggleSection('vibes')}
            badge={selectedVibes.length > 0 ? `${selectedVibes.length} selected` : undefined}>
            <div className="flex flex-wrap gap-2">
              {(vibeTags as VibeTagRow[]).map((vibe) => (
                <motion.button key={vibe.id} type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => toggleVibe(vibe.label)}
                  className={`px-3 py-2 rounded-full border transition-all text-sm ${selectedVibes.includes(vibe.label)
                    ? 'border-primary bg-primary/20 text-foreground'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'}`}>
                  <span className="mr-1">{vibe.emoji}</span>{vibe.label}
                </motion.button>
              ))}
            </div>
          </CollapsibleSection>

          {/* Categories */}
          <CollapsibleSection title="Categories" icon={Sparkles} isOpen={openSections.themes}
            onToggle={() => toggleSection('themes')}
            badge={selectedCategoryKeys.length > 0 ? `${selectedCategoryKeys.length} selected` : undefined}>
            <div className="flex flex-wrap gap-2">
              {eventCategories
                .filter((category) => category.active !== false || selectedCategoryKeys.includes(category.key))
                .map((category) => (
                <motion.button key={category.key} type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => toggleCategory(category.key)}
                  className={`px-3 py-2 rounded-full border transition-all text-sm ${selectedCategoryKeys.includes(category.key)
                    ? 'border-primary bg-primary/20 text-foreground'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'} ${category.active === false ? 'opacity-60' : ''}`}>
                  <span className="mr-1">{category.emoji}</span>{category.label}
                  {category.active === false && <span className="ml-1 text-xs">(inactive)</span>}
                </motion.button>
              ))}
            </div>
            {showNewCategory ? (
              <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-3">
                <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Icon</Label>
                    <Input
                      value={newCategoryEmoji}
                      onChange={(e) => setNewCategoryEmoji(e.target.value)}
                      maxLength={8}
                      className="bg-secondary/50 text-center text-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category name</Label>
                    <Input
                      value={newCategoryLabel}
                      onChange={(e) => setNewCategoryLabel(e.target.value)}
                      placeholder="e.g., Theater Night"
                      className="bg-secondary/50"
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={createCategory.isPending || !newCategoryLabel.trim() || !newCategoryEmoji.trim()}
                    onClick={() => createCategory.mutate()}
                    className="gap-2"
                  >
                    {createCategory.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Save
                  </Button>
                </div>
                <div className="inline-flex items-center rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 text-sm">
                  <span className="mr-1.5">{newCategoryEmoji || "✨"}</span>{newCategoryLabel.trim() || "New category"}
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNewCategory(true)} className="gap-2">
                <Plus className="w-4 h-4" />New category
              </Button>
            )}
          </CollapsibleSection>
        </form>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} disabled={saveEvent.isPending || isGenerating}
            className="bg-gradient-primary text-primary-foreground gap-2">
            {(saveEvent.isPending || isGenerating) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Update Event' : 'Create Event'}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminEventFormModal;
