import { useState, useRef, useCallback, useEffect, memo } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Calendar, Clock, Users, Image, Save, Sparkles, MapPin, DollarSign,
  Eye, Crown, UserCircle, ChevronDown, ChevronUp, Upload, Loader2,
  Globe, Flag, RefreshCw, Search,
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
import { toast } from "sonner";
import { format } from "date-fns";
import { useAdminActivityLog } from "@/hooks/useAdminActivityLog";
import { EVENT_LANGUAGES } from "@/lib/eventLanguages";
import React from "react";

interface AdminEventFormModalProps {
  event?: any;
  onClose: () => void;
}

const eventThemes = [
  { id: "tech", label: "Tech Founders", emoji: "💻" },
  { id: "travel", label: "Travel Lovers", emoji: "✈️" },
  { id: "foodies", label: "Foodies", emoji: "🍷" },
  { id: "creatives", label: "Creatives", emoji: "🎨" },
  { id: "fitness", label: "Fitness & Wellness", emoji: "💪" },
  { id: "music", label: "Music & Nightlife", emoji: "🎵" },
];

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

interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  country: string;
  display_name: string;
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
  const { logActivity } = useAdminActivityLog();
  const isEditing = !!event;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

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
      if (error) throw error;
      return data || [];
    },
  });

  // ── Basic Info ──
  const [title, setTitle] = useState(event?.title || "");
  const [description, setDescription] = useState(event?.description || "");
  const [language, setLanguage] = useState<string>(event?.language || "");
  const [coverImage, setCoverImage] = useState(event?.cover_image || "");
  const [eventDate, setEventDate] = useState(
    event?.event_date ? format(new Date(event.event_date), "yyyy-MM-dd") : ""
  );
  const [eventTime, setEventTime] = useState(
    event?.event_date ? format(new Date(event.event_date), "HH:mm") : ""
  );
  const [duration, setDuration] = useState(String(event?.duration_minutes || 60));
  const [selectedTags, setSelectedTags] = useState<string[]>(event?.tags || []);
  const [selectedVibes, setSelectedVibes] = useState<string[]>(event?.vibes || []);

  // ── Capacity ──
  const [maxMaleAttendees, setMaxMaleAttendees] = useState(String(event?.max_male_attendees || ""));
  const [maxFemaleAttendees, setMaxFemaleAttendees] = useState(String(event?.max_female_attendees || ""));
  const [maxNonbinaryAttendees, setMaxNonbinaryAttendees] = useState(String(event?.max_nonbinary_attendees || ""));

  // ── Scope & Location ──
  const [scope, setScope] = useState<Scope>(event?.scope || "global");
  const [cityQuery, setCityQuery] = useState(event?.city || "");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
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

  const totalCapacity = (parseInt(maxMaleAttendees) || 0) +
    (parseInt(maxFemaleAttendees) || 0) +
    (parseInt(maxNonbinaryAttendees) || 0);

  // City search debounce
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCitySearch = useCallback(async (q: string) => {
    setCityQuery(q);
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    if (q.length < 2) { setGeoResults([]); return; }
    geocodeTimeout.current = setTimeout(async () => {
      setIsGeocoding(true);
      try {
        const { data, error } = await supabase.functions.invoke('forward-geocode', { body: { query: q } });
        if (!error && Array.isArray(data)) setGeoResults(data);
      } catch (_) {}
      setIsGeocoding(false);
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
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error('Image must be less than 20MB'); return; }
    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const { uploadEventCoverToBunny } = await import("@/services/eventCoverUploadService");
      const url = await uploadEventCoverToBunny(file, session.access_token, event?.id ?? undefined);
      setCoverImage(url);
      toast.success('Cover image uploaded');
    } catch (error: any) {
      toast.error('Failed to upload image', { description: error.message });
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
      case 'monthly_day': return `Monthly on the ${d.getDate()}${['th','st','nd','rd'][d.getDate()%10>3||Math.floor(d.getDate()/10)===1?0:d.getDate()%10]}`;
      case 'monthly_weekday': {
        const nth = Math.ceil(d.getDate() / 7);
        const sfx = ['th','st','nd','rd'][nth>3?0:nth];
        return `Monthly on the ${nth}${sfx} ${DAYS_FULL[d.getDay()]}`;
      }
      case 'yearly': return `Yearly on ${format(d, 'MMM d')}`;
      default: return "";
    }
  };

  // Save mutation
  const saveEvent = useMutation({
    mutationFn: async () => {
      const eventDateTime = new Date(`${eventDate}T${eventTime}`);
      const eventData: any = {
        title, description,
        cover_image: coverImage,
        language: language || null,
        event_date: eventDateTime.toISOString(),
        duration_minutes: parseInt(duration),
        max_attendees: totalCapacity || 50,
        tags: selectedTags,
        vibes: selectedVibes,
        max_male_attendees: maxMaleAttendees ? parseInt(maxMaleAttendees) : null,
        max_female_attendees: maxFemaleAttendees ? parseInt(maxFemaleAttendees) : null,
        max_nonbinary_attendees: maxNonbinaryAttendees ? parseInt(maxNonbinaryAttendees) : null,
        visibility, is_free: isFree,
        price_amount: isFree ? 0 : parseFloat(priceAmount),
        price_currency: priceCurrency,
        scope,
        latitude: scope === 'local' ? resolvedLat : null,
        longitude: scope === 'local' ? resolvedLng : null,
        radius_km: scope === 'local' ? radiusKm : null,
        city: scope === 'local' ? resolvedCity : null,
        country: scope !== 'global' ? resolvedCountry : null,
        is_recurring: isRecurring,
        recurrence_type: isRecurring ? recurrenceType : null,
        recurrence_days: isRecurring && ['weekly', 'biweekly'].includes(recurrenceType) ? selectedDays : null,
        recurrence_count: isRecurring && recurrenceEnd === 'after' ? parseInt(endsAfterCount) : null,
        recurrence_ends_at: isRecurring && recurrenceEnd === 'on_date' && endsOnDate ? new Date(endsOnDate).toISOString() : null,
      };

      if (!isEditing) eventData.status = 'upcoming';

      if (isEditing) {
        const { error } = await supabase.from('events').update(eventData).eq('id', event.id);
        if (error) throw error;
        return { id: event.id, action: 'edit_event', eventData };
      } else {
        const { data, error } = await supabase.from('events').insert(eventData).select().single();
        if (error) throw error;
        return { id: data.id, action: 'create_event', eventData: data };
      }
    },
    onSuccess: async (result) => {
      await logActivity({
        actionType: result.action as 'create_event' | 'edit_event',
        targetType: 'event', targetId: result.id, details: { title }
      });

      if (result.action === 'create_event') {
        try {
          await supabase.functions.invoke('event-notifications', {
            body: { type: 'new_event', eventId: result.id, eventTitle: title, eventDate: result.eventData.event_date, eventDescription: description }
          });
        } catch (_) {}

        if (isRecurring) {
          setIsGenerating(true);
          try {
            const { data: genCount } = await supabase.rpc('generate_recurring_events', {
              p_parent_id: result.id,
              p_count: generateCount,
            });
            toast.success(`Created recurring event + ${genCount} upcoming occurrences ✨`);
          } catch (_) {
            toast.success('Event created successfully');
          } finally {
            setIsGenerating(false);
          }
        } else {
          toast.success('Event created successfully');
        }
      } else {
        toast.success('Event updated successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      onClose();
    },
    onError: (error) => {
      toast.error('Failed to save event', { description: error.message });
    },
  });

  const toggleTag = (tagId: string) => setSelectedTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  const toggleVibe = (vibeLabel: string) => setSelectedVibes(prev => prev.includes(vibeLabel) ? prev.filter(v => v !== vibeLabel) : [...prev, vibeLabel]);
  const toggleDay = (d: number) => setSelectedDays(prev => prev.includes(d) ? (prev.length > 1 ? prev.filter(x => x !== d) : prev) : [...prev, d]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !coverImage || !eventDate || !eventTime) {
      toast.error('Please fill in all required fields');
      return;
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
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4 space-y-4 pb-32">

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
                <Label>Date *</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="pl-10 bg-secondary/50" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} className="pl-10 bg-secondary/50" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Duration (min)</Label>
                <Input type="number" min="15" max="480" step="15" value={duration}
                  onChange={(e) => setDuration(e.target.value)} className="bg-secondary/50" />
              </div>
            </div>
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
                    <Label>On days</Label>
                    <div className="flex gap-1">
                      {DAYS_SHORT.map((d, i) => (
                        <button key={i} type="button" onClick={() => toggleDay(i)}
                          className={`w-9 h-9 rounded-full text-sm font-medium transition-all ${selectedDays.includes(i)
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'}`}>
                          {d}
                        </button>
                      ))}
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
                              <Input type="date" value={endsOnDate} onChange={(e) => setEndsOnDate(e.target.value)}
                                className="h-7 text-sm bg-secondary/50" />
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                  <span className="text-sm text-muted-foreground">Generate next</span>
                  <Input type="number" value={generateCount} onChange={(e) => setGenerateCount(parseInt(e.target.value) || 8)}
                    className="w-20 h-8 text-sm bg-secondary/50" min="1" max="52" />
                  <span className="text-sm text-muted-foreground">occurrences on save</span>
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

                {resolvedLat && resolvedCity && (
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
                        onChange={(e) => { setCustomRadius(e.target.value); if (e.target.value) setRadiusKm(parseInt(e.target.value)); }}
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
              {vibeTags.map((vibe: any) => (
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

          {/* Themes */}
          <CollapsibleSection title="Event Themes" icon={Sparkles} isOpen={openSections.themes}
            onToggle={() => toggleSection('themes')}
            badge={selectedTags.length > 0 ? `${selectedTags.length} selected` : undefined}>
            <div className="flex flex-wrap gap-2">
              {eventThemes.map((theme) => (
                <motion.button key={theme.id} type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => toggleTag(theme.id)}
                  className={`px-3 py-2 rounded-full border transition-all text-sm ${selectedTags.includes(theme.id)
                    ? 'border-primary bg-primary/20 text-foreground'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'}`}>
                  <span className="mr-1">{theme.emoji}</span>{theme.label}
                </motion.button>
              ))}
            </div>
          </CollapsibleSection>
        </form>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveEvent.mutate()} disabled={saveEvent.isPending || isGenerating}
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
