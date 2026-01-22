import { useState, useRef } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Calendar,
  Clock,
  Users,
  Image,
  Save,
  Sparkles,
  MapPin,
  DollarSign,
  Eye,
  Crown,
  UserCircle,
  ChevronDown,
  ChevronUp,
  Upload,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAdminActivityLog } from "@/hooks/useAdminActivityLog";

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

const AdminEventFormModal = ({ event, onClose }: AdminEventFormModalProps) => {
  const queryClient = useQueryClient();
  const { logActivity } = useAdminActivityLog();
  const isEditing = !!event;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Collapsible section states
  const [openSections, setOpenSections] = useState({
    dateTime: true,
    capacity: false,
    location: false,
    visibility: false,
    pricing: false,
    vibes: false,
    themes: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Fetch vibe tags from database
  const { data: vibeTags = [] } = useQuery({
    queryKey: ['vibe-tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vibe_tags')
        .select('*')
        .order('category', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Form state - Basic
  const [title, setTitle] = useState(event?.title || "");
  const [description, setDescription] = useState(event?.description || "");
  const [coverImage, setCoverImage] = useState(event?.cover_image || "");
  const [eventDate, setEventDate] = useState(
    event?.event_date ? format(new Date(event.event_date), "yyyy-MM-dd") : ""
  );
  const [eventTime, setEventTime] = useState(
    event?.event_date ? format(new Date(event.event_date), "HH:mm") : ""
  );
  const [duration, setDuration] = useState(String(event?.duration_minutes || 60));
  const [selectedTags, setSelectedTags] = useState<string[]>(event?.tags || []);
  const [status, setStatus] = useState(event?.status || "upcoming");

  // Form state - Vibes
  const [selectedVibes, setSelectedVibes] = useState<string[]>(event?.vibes || []);

  // Form state - Gender Capacity
  const [maxMaleAttendees, setMaxMaleAttendees] = useState(String(event?.max_male_attendees || ""));
  const [maxFemaleAttendees, setMaxFemaleAttendees] = useState(String(event?.max_female_attendees || ""));
  const [maxNonbinaryAttendees, setMaxNonbinaryAttendees] = useState(String(event?.max_nonbinary_attendees || ""));

  // Form state - Location
  const [isLocationSpecific, setIsLocationSpecific] = useState(event?.is_location_specific || false);
  const [locationName, setLocationName] = useState(event?.location_name || "");
  const [locationAddress, setLocationAddress] = useState(event?.location_address || "");

  // Form state - Visibility
  const [visibility, setVisibility] = useState(event?.visibility || "all");

  // Form state - Pricing
  const [isFree, setIsFree] = useState(event?.is_free !== false);
  const [priceAmount, setPriceAmount] = useState(String(event?.price_amount || "0"));
  const [priceCurrency, setPriceCurrency] = useState(event?.price_currency || "EUR");

  // Calculate total capacity from gender-specific settings
  const totalCapacity = (parseInt(maxMaleAttendees) || 0) + 
                        (parseInt(maxFemaleAttendees) || 0) + 
                        (parseInt(maxNonbinaryAttendees) || 0);

  // Handle image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `event-covers/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload to profile-photos bucket (reusing existing bucket)
      const { data, error } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (error) throw error;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(data.path);

      setCoverImage(urlData.publicUrl);
      toast.success('Image uploaded successfully');
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Failed to upload image', { description: error.message });
    } finally {
      setIsUploading(false);
    }
  };

  // Create/Update mutation
  const saveEvent = useMutation({
    mutationFn: async () => {
      const eventDateTime = new Date(`${eventDate}T${eventTime}`);
      
      const eventData = {
        title,
        description,
        cover_image: coverImage,
        event_date: eventDateTime.toISOString(),
        duration_minutes: parseInt(duration),
        max_attendees: totalCapacity || 50,
        tags: selectedTags,
        status,
        vibes: selectedVibes,
        max_male_attendees: maxMaleAttendees ? parseInt(maxMaleAttendees) : null,
        max_female_attendees: maxFemaleAttendees ? parseInt(maxFemaleAttendees) : null,
        max_nonbinary_attendees: maxNonbinaryAttendees ? parseInt(maxNonbinaryAttendees) : null,
        is_location_specific: isLocationSpecific,
        location_name: isLocationSpecific ? locationName : null,
        location_address: isLocationSpecific ? locationAddress : null,
        visibility,
        is_free: isFree,
        price_amount: isFree ? 0 : parseFloat(priceAmount),
        price_currency: priceCurrency,
      };

      if (isEditing) {
        const { error } = await supabase
          .from('events')
          .update(eventData)
          .eq('id', event.id);
        if (error) throw error;
        return { id: event.id, action: 'edit_event' };
      } else {
        const { data, error } = await supabase
          .from('events')
          .insert(eventData)
          .select()
          .single();
        if (error) throw error;
        return { id: data.id, action: 'create_event' };
      }
    },
    onSuccess: async (result) => {
      // Log activity
      await logActivity({
        actionType: result.action as 'create_event' | 'edit_event',
        targetType: 'event',
        targetId: result.id,
        details: { title }
      });
      
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      toast.success(isEditing ? 'Event updated successfully' : 'Event created successfully');
      onClose();
    },
    onError: (error) => {
      toast.error('Failed to save event', { description: error.message });
    },
  });

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(t => t !== tagId)
        : [...prev, tagId]
    );
  };

  const toggleVibe = (vibeLabel: string) => {
    setSelectedVibes(prev =>
      prev.includes(vibeLabel)
        ? prev.filter(v => v !== vibeLabel)
        : [...prev, vibeLabel]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !coverImage || !eventDate || !eventTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    saveEvent.mutate();
  };

  // Section Component with proper toggle
  const Section = ({ 
    title, 
    icon: Icon, 
    sectionKey,
    badge,
    children 
  }: { 
    title: string; 
    icon: any; 
    sectionKey: keyof typeof openSections;
    badge?: string;
    children: React.ReactNode;
  }) => {
    const isOpen = openSections[sectionKey];
    
    return (
      <div className="rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(sectionKey)}
          className="w-full flex items-center justify-between p-4 bg-secondary/30 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground uppercase tracking-wider">{title}</span>
            {badge && (
              <Badge variant="secondary" className="text-xs">{badge}</Badge>
            )}
          </div>
          {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-4 bg-card">
                {children}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-50 flex flex-col"
    >
      {/* Header - Fixed */}
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
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Form - Scrollable */}
      <div className="flex-1 overflow-auto">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4 space-y-4 pb-32">
          
          {/* Basic Info - Always visible (not collapsible) */}
          <div className="rounded-xl border border-border p-4 space-y-4 bg-card">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground uppercase tracking-wider">Basic Info</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Event Title *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Tech Founders Speed Dating"
                  className="bg-secondary/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="bg-secondary/50">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell guests what to expect..."
                className="bg-secondary/50 min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="coverImage">Cover Image URL *</Label>
              <div className="flex gap-2">
                <Input
                  id="coverImage"
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  placeholder="https://..."
                  className="bg-secondary/50"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
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
          <Section 
            title="Date & Time" 
            icon={Calendar} 
            sectionKey="dateTime"
            badge={eventDate && eventTime ? `${eventDate} ${eventTime}` : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date *</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="date"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="pl-10 bg-secondary/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="time"
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="pl-10 bg-secondary/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (min)</Label>
                <Input
                  id="duration"
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="bg-secondary/50"
                />
              </div>
            </div>
          </Section>

          {/* Gender-Specific Capacity */}
          <Section 
            title="Capacity" 
            icon={UserCircle} 
            sectionKey="capacity"
            badge={totalCapacity > 0 ? `${totalCapacity} spots` : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="maxMale">Male Spots</Label>
                <Input
                  id="maxMale"
                  type="number"
                  value={maxMaleAttendees}
                  onChange={(e) => setMaxMaleAttendees(e.target.value)}
                  placeholder="25"
                  className="bg-secondary/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxFemale">Female Spots</Label>
                <Input
                  id="maxFemale"
                  type="number"
                  value={maxFemaleAttendees}
                  onChange={(e) => setMaxFemaleAttendees(e.target.value)}
                  placeholder="25"
                  className="bg-secondary/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxNonbinary">Non-Binary</Label>
                <Input
                  id="maxNonbinary"
                  type="number"
                  value={maxNonbinaryAttendees}
                  onChange={(e) => setMaxNonbinaryAttendees(e.target.value)}
                  placeholder="10"
                  className="bg-secondary/50"
                />
              </div>
            </div>
            {totalCapacity > 0 && (
              <p className="text-sm text-muted-foreground">
                Total Capacity: <span className="text-foreground font-medium">{totalCapacity}</span>
              </p>
            )}
          </Section>

          {/* Location */}
          <Section 
            title="Location" 
            icon={MapPin} 
            sectionKey="location"
            badge={isLocationSpecific ? 'Physical' : 'Virtual'}
          >
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
              <Switch
                id="locationToggle"
                checked={isLocationSpecific}
                onCheckedChange={setIsLocationSpecific}
              />
              <Label htmlFor="locationToggle" className="text-sm">Physical Location</Label>
            </div>
            {isLocationSpecific && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="locationName">Venue Name</Label>
                  <Input
                    id="locationName"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="e.g., The Rooftop Bar"
                    className="bg-secondary/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationAddress">Address</Label>
                  <Input
                    id="locationAddress"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    placeholder="e.g., 123 Main St, NYC"
                    className="bg-secondary/50"
                  />
                </div>
              </div>
            )}
          </Section>

          {/* Visibility */}
          <Section 
            title="Visibility" 
            icon={Eye} 
            sectionKey="visibility"
            badge={visibility === 'all' ? 'All Users' : visibility === 'premium' ? 'Premium' : 'VIP'}
          >
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'all', label: 'All Users', icon: Users },
                { value: 'premium', label: 'Premium', icon: Crown },
                { value: 'vip', label: 'VIP Only', icon: Sparkles },
              ].map((option) => {
                const Icon = option.icon;
                return (
                  <motion.button
                    key={option.value}
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setVisibility(option.value)}
                    className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-2 ${
                      visibility === option.value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{option.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </Section>

          {/* Pricing */}
          <Section 
            title="Pricing" 
            icon={DollarSign} 
            sectionKey="pricing"
            badge={isFree ? 'Free' : `${priceAmount} ${priceCurrency}`}
          >
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
              <Switch
                id="freeToggle"
                checked={isFree}
                onCheckedChange={setIsFree}
              />
              <Label htmlFor="freeToggle" className="text-sm">Free Event</Label>
            </div>
            {!isFree && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="priceAmount">Price</Label>
                  <Input
                    id="priceAmount"
                    type="number"
                    step="0.01"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(e.target.value)}
                    placeholder="0.00"
                    className="bg-secondary/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priceCurrency">Currency</Label>
                  <Select value={priceCurrency} onValueChange={setPriceCurrency}>
                    <SelectTrigger className="bg-secondary/50">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((curr) => (
                        <SelectItem key={curr.id} value={curr.id}>
                          {curr.symbol} {curr.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </Section>

          {/* Vibes Selection */}
          <Section 
            title="Target Vibes" 
            icon={Sparkles} 
            sectionKey="vibes"
            badge={selectedVibes.length > 0 ? `${selectedVibes.length} selected` : undefined}
          >
            <div className="flex flex-wrap gap-2">
              {vibeTags.map((vibe) => (
                <motion.button
                  key={vibe.id}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => toggleVibe(vibe.label)}
                  className={`px-3 py-2 rounded-full border transition-all text-sm ${
                    selectedVibes.includes(vibe.label)
                      ? 'border-primary bg-primary/20 text-foreground'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <span className="mr-1">{vibe.emoji}</span>
                  {vibe.label}
                </motion.button>
              ))}
            </div>
          </Section>

          {/* Event Theme Tags */}
          <Section 
            title="Event Themes" 
            icon={Sparkles} 
            sectionKey="themes"
            badge={selectedTags.length > 0 ? `${selectedTags.length} selected` : undefined}
          >
            <div className="flex flex-wrap gap-2">
              {eventThemes.map((theme) => (
                <motion.button
                  key={theme.id}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => toggleTag(theme.id)}
                  className={`px-3 py-2 rounded-full border transition-all text-sm ${
                    selectedTags.includes(theme.id)
                      ? 'border-primary bg-primary/20 text-foreground'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <span className="mr-1">{theme.emoji}</span>
                  {theme.label}
                </motion.button>
              ))}
            </div>
          </Section>
        </form>
      </div>

      {/* Footer - Fixed */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveEvent.mutate()}
            disabled={saveEvent.isPending}
            className="bg-gradient-to-r from-primary to-accent gap-2"
          >
            {saveEvent.isPending ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
              />
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isEditing ? 'Update Event' : 'Create Event'}
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminEventFormModal;
