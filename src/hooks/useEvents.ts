import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface Event {
  id: string;
  title: string;
  description: string | null;
  image: string;
  date: string;
  time: string;
  attendees: number;
  tags: string[];
  status: string;
  eventDate: Date;
}

export const useEvents = () => {
  return useQuery({
    queryKey: ["events"],
    queryFn: async (): Promise<Event[]> => {
      const now = new Date().toISOString();
      
      const { data, error } = await supabase
        .from("events")
        .select("id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees")
        .gte("event_date", now) // Only fetch future events
        .order("event_date", { ascending: true });

      if (error) throw error;

      return (data || []).map((event) => {
        const eventDate = new Date(event.event_date);
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          image: event.cover_image,
          date: format(eventDate, "MMM d"),
          time: format(eventDate, "h a"),
          attendees: event.current_attendees || 0,
          tags: event.tags || [],
          status: event.status || "upcoming",
          eventDate,
        };
      });
    },
  });
};

export const useNextEvent = () => {
  return useQuery({
    queryKey: ["next-event"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees")
        .gte("event_date", new Date().toISOString())
        .order("event_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const eventDate = new Date(data.event_date);
      return {
        id: data.id,
        title: data.title,
        emoji: "🎵",
        date: format(eventDate, "EEEE 'at' h a"),
        eventDate,
      };
    },
  });
};
