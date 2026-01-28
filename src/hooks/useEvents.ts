import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

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

const PAGE_SIZE = 12;

// Hook to enable realtime updates for events
export const useRealtimeEvents = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("events-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["events"] });
          queryClient.invalidateQueries({ queryKey: ["next-event"] });
          queryClient.invalidateQueries({ queryKey: ["next-registered-event"] });
          queryClient.invalidateQueries({ queryKey: ["event-details"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_registrations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["events"] });
          queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
          queryClient.invalidateQueries({ queryKey: ["next-registered-event"] });
          queryClient.invalidateQueries({ queryKey: ["event-attendees"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
};

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

// Infinite scroll version
export const useInfiniteEvents = () => {
  return useInfiniteQuery({
    queryKey: ["infinite-events"],
    queryFn: async ({ pageParam = 0 }): Promise<{ events: Event[]; nextCursor: number | null }> => {
      const now = new Date().toISOString();
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from("events")
        .select("id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees")
        .gte("event_date", now)
        .order("event_date", { ascending: true })
        .range(from, to);

      if (error) throw error;

      const events = (data || []).map((event) => {
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

      return {
        events,
        nextCursor: data?.length === PAGE_SIZE ? pageParam + 1 : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
  });
};

// Legacy hook - gets ANY next event (not registration-based)
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
        image: data.cover_image,
      };
    },
  });
};

// New hook - gets user's next REGISTERED event (or recommended if none)
export const useNextRegisteredEvent = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["next-registered-event", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!user?.id) return { event: null, isRegistered: false };

      const now = new Date().toISOString();

      // First, try to find user's next registered event
      const { data: registeredEvents, error: regError } = await supabase
        .from("event_registrations")
        .select(`
          event_id,
          events:event_id (
            id, title, cover_image, event_date, current_attendees
          )
        `)
        .eq("profile_id", user.id);

      if (regError) throw regError;

      // Filter to future events and sort by date
      const futureRegistered = (registeredEvents || [])
        .filter(r => r.events && new Date(r.events.event_date) > new Date())
        .sort((a, b) => new Date(a.events!.event_date).getTime() - new Date(b.events!.event_date).getTime());

      if (futureRegistered.length > 0) {
        const event = futureRegistered[0].events!;
        const eventDate = new Date(event.event_date);
        return {
          event: {
            id: event.id,
            title: event.title,
            emoji: "🎵",
            date: format(eventDate, "EEEE 'at' h a"),
            eventDate,
            image: event.cover_image,
          },
          isRegistered: true,
        };
      }

      // No registered events - fetch a recommended event
      const { data: recommendedEvent, error: recError } = await supabase
        .from("events")
        .select("id, title, cover_image, event_date, current_attendees")
        .gte("event_date", now)
        .order("event_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (recError) throw recError;
      if (!recommendedEvent) return { event: null, isRegistered: false };

      const eventDate = new Date(recommendedEvent.event_date);
      return {
        event: {
          id: recommendedEvent.id,
          title: recommendedEvent.title,
          emoji: "🎵",
          date: format(eventDate, "EEEE 'at' h a"),
          eventDate,
          image: recommendedEvent.cover_image,
        },
        isRegistered: false,
      };
    },
  });
};
