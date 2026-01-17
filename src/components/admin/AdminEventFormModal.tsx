import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  X,
  Calendar,
  Clock,
  Users,
  Image,
  Save,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const AdminEventFormModal = ({ event, onClose }: AdminEventFormModalProps) => {
  const queryClient = useQueryClient();
  const isEditing = !!event;

  // Form state
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
  const [maxAttendees, setMaxAttendees] = useState(String(event?.max_attendees || 50));
  const [selectedTags, setSelectedTags] = useState<string[]>(event?.tags || []);
  const [status, setStatus] = useState(event?.status || "upcoming");

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
        max_attendees: parseInt(maxAttendees),
        tags: selectedTags,
        status,
      };

      if (isEditing) {
        const { error } = await supabase
          .from('events')
          .update(eventData)
          .eq('id', event.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('events')
          .insert(eventData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !coverImage || !eventDate || !eventTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    saveEvent.mutate();
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] bg-card border border-border rounded-3xl z-50 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
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
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell guests what to expect..."
                className="bg-secondary/50 min-h-[100px]"
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
                <Button type="button" variant="outline" size="icon">
                  <Image className="w-4 h-4" />
                </Button>
              </div>
              {coverImage && (
                <div className="w-32 h-20 rounded-lg overflow-hidden bg-secondary/50">
                  <img src={coverImage} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="time"
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="pl-10 bg-secondary/50"
                />
              </div>
            </div>
          </div>

          {/* Duration & Capacity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxAttendees">Max Attendees</Label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="maxAttendees"
                  type="number"
                  value={maxAttendees}
                  onChange={(e) => setMaxAttendees(e.target.value)}
                  className="pl-10 bg-secondary/50"
                />
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Event Tags</Label>
            <div className="flex flex-wrap gap-2">
              {eventThemes.map((theme) => (
                <motion.button
                  key={theme.id}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => toggleTag(theme.id)}
                  className={`px-3 py-2 rounded-full border transition-all ${
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
          </div>

          {/* Status */}
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
        </form>

        {/* Footer */}
        <div className="p-6 border-t border-border flex justify-end gap-3">
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
      </motion.div>
    </>
  );
};

export default AdminEventFormModal;