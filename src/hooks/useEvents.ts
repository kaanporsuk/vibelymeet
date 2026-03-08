import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isEventVisible } from "@/utils/eventUtils";

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
  event_date_raw: string;
  duration_minutes: number;
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
      const now = new Date();
      
      const { data, error } = await supabase
        .from("events")
        .select("id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees")
        .order("event_date", { ascending: true });

      if (error) throw error;

      // Filter to include upcoming events AND currently live events (within duration)
      return (data || [])
        .filter((event) => {
          const eventStart = new Date(event.event_date);
          const durationMs = (event.duration_minutes || 60) * 60 * 1000;
          const eventEnd = new Date(eventStart.getTime() + durationMs);
          
          // Include if event hasn't ended yet (either upcoming or currently live)
          return now < eventEnd;
        })
        .map((event) => {
          const eventDate = new Date(event.event_date);
          const durationMs = (event.duration_minutes || 60) * 60 * 1000;
          const eventEnd = new Date(eventDate.getTime() + durationMs);
          const isLive = now >= eventDate && now < eventEnd;
          
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            image: event.cover_image,
            date: format(eventDate, "MMM d"),
            time: format(eventDate, "h a"),
            attendees: event.current_attendees || 0,
            tags: event.tags || [],
            status: isLive ? "live" : (event.status || "upcoming"),
            eventDate,
          };
        });
    },
  });
};

// Infinite scroll version - includes live events
export const useInfiniteEvents = () => {
  return useInfiniteQuery({
    queryKey: ["infinite-events"],
    queryFn: async ({ pageParam = 0 }): Promise<{ events: Event[]; nextCursor: number | null }> => {
      const now = new Date();
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from("events")
        .select("id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees")
        .order("event_date", { ascending: true })
        .range(from, to);

      if (error) throw error;

      // Filter to include upcoming AND live events
      const filteredData = (data || []).filter((event) => {
        const eventStart = new Date(event.event_date);
        const durationMs = (event.duration_minutes || 60) * 60 * 1000;
        const eventEnd = new Date(eventStart.getTime() + durationMs);
        return now < eventEnd;
      });

      const events = filteredData.map((event) => {
        const eventDate = new Date(event.event_date);
        const durationMs = (event.duration_minutes || 60) * 60 * 1000;
        const eventEnd = new Date(eventDate.getTime() + durationMs);
        const isLive = now >= eventDate && now < eventEnd;
        
        return {
          id: event.id,
          title: event.title,
          description: event.description,
          image: event.cover_image,
          date: format(eventDate, "MMM d"),
          time: format(eventDate, "h a"),
          attendees: event.current_attendees || 0,
          tags: event.tags || [],
          status: isLive ? "live" : (event.status || "upcoming"),
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
// Includes LIVE events (not just future ones)
export const useNextRegisteredEvent = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["next-registered-event", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!user?.id) return { event: null, isRegistered: false };

      const now = new Date();

      // First, try to find user's next registered event (including live ones)
      const { data: registeredEvents, error: regError } = await supabase
        .from("event_registrations")
        .select(`
          event_id,
          events:event_id (
            id, title, cover_image, event_date, current_attendees, duration_minutes,
            scope, city, country, latitude, longitude
          )
        `)
        .eq("profile_id", user.id);

      if (regError) throw regError;

      // Filter to include upcoming AND live events (not ended)
      const activeRegistered = (registeredEvents || [])
        .filter(r => {
          if (!r.events) return false;
          const eventStart = new Date(r.events.event_date);
          const durationMs = ((r.events as { duration_minutes?: number }).duration_minutes || 60) * 60 * 1000;
          const eventEnd = new Date(eventStart.getTime() + durationMs);
          return now < eventEnd; // Event hasn't ended yet
        })
        .sort((a, b) => new Date(a.events!.event_date).getTime() - new Date(b.events!.event_date).getTime());

      if (activeRegistered.length > 0) {
        const event = activeRegistered[0].events!;
        const eventDate = new Date(event.event_date);
        const durationMs = ((event as { duration_minutes?: number }).duration_minutes || 60) * 60 * 1000;
        const eventEnd = new Date(eventDate.getTime() + durationMs);
        const isLive = now >= eventDate && now < eventEnd;
        
        return {
          event: {
            id: event.id,
            title: event.title,
            emoji: isLive ? "🔴" : "🎵",
            date: isLive ? "LIVE NOW" : format(eventDate, "EEEE 'at' h a"),
            eventDate,
            image: event.cover_image,
            isLive,
          },
          isRegistered: true,
        };
      }

      // No registered events - fetch a recommended event (upcoming only)
      const { data: recommendedEvent, error: recError } = await supabase
        .from("events")
        .select("id, title, cover_image, event_date, current_attendees, duration_minutes")
        .order("event_date", { ascending: true })
        .limit(20); // Fetch more to filter

      if (recError) throw recError;
      
      // Filter to events that haven't ended
      const activeEvents = (recommendedEvent || []).filter(event => {
        const eventStart = new Date(event.event_date);
        const durationMs = (event.duration_minutes || 60) * 60 * 1000;
        const eventEnd = new Date(eventStart.getTime() + durationMs);
        return now < eventEnd;
      });

      if (!activeEvents.length) return { event: null, isRegistered: false };

      const event = activeEvents[0];
      const eventDate = new Date(event.event_date);
      const durationMs = (event.duration_minutes || 60) * 60 * 1000;
      const eventEnd = new Date(eventDate.getTime() + durationMs);
      const isLive = now >= eventDate && now < eventEnd;

      return {
        event: {
          id: event.id,
          title: event.title,
          emoji: isLive ? "🔴" : "🎵",
          date: isLive ? "LIVE NOW" : format(eventDate, "EEEE 'at' h a"),
          eventDate,
          image: event.cover_image,
          isLive,
        },
        isRegistered: false,
      };
    },
  });
};
