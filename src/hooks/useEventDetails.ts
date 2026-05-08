import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addMinutes } from "date-fns";
import { calculateVibeScoreStable } from "@/utils/vibeScoreUtils";
import { useUserProfile } from "@/contexts/AuthContext";
import type { EventCategory } from "@clientShared/eventCategories";

export interface EventDetails {
  id: string;
  title: string;
  description: string | null;
  coverImage: string;
  category: string;
  vibeMatch: number;
  eventDate: Date;
  time: string;
  durationMinutes: number;
  isVirtual: boolean;
  venue: string;
  address: string;
  price: number;
  /** Total cap from DB; admission/FIFO logic uses this (and current_attendees), not per-gender fields. */
  maxAttendees: number;
  /** Confirmed headcount only (matches events.current_attendees). */
  currentAttendees: number;
  /** DB row status — use for cancelled / ended truth. */
  status: string | null;
  /** DB terminal/archive markers — backend active-event truth also honors these. */
  archivedAt: Date | null;
  endedAt: Date | null;
  tags: string[];
  categoryKeys: string[];
  categories: EventCategory[];
  isFree: boolean;
  eventVibes: string[];
  // New geo/series fields
  parentEventId: string | null;
  occurrenceNumber: number | null;
  scope: string | null;
  city: string | null;
  country: string | null;
  visibility: string | null;
  language: string | null;
}

export interface EventAttendee {
  id: string;
  name: string;
  age: number;
  avatar: string;
  vibeTag: string;
  matchPercent: number;
  about_me: string;
  photos: string[];
  vibeTags?: string[];
  photoVerified?: boolean;
}

export const useEventDetails = (eventId: string | undefined) => {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ["event-details", eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventDetails | null> => {
      if (!eventId) return null;

      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching event:", error);
        throw error;
      }

      if (!data) return null;

      const eventDate = new Date(data.event_date);
      const endTime = addMinutes(eventDate, data.duration_minutes || 60);

      // Format time range
      const startTimeStr = format(eventDate, "h:mm a");
      const endTimeStr = format(endTime, "h:mm a");

      // Determine category from vibes/tags
      const vibes = data.vibes || [];
      const tags = data.tags || [];
      const categoryKeys: string[] = data.category_keys || [];
      let categories: EventCategory[] = [];
      if (categoryKeys.length > 0) {
        const { data: categoryRows, error: categoryError } = await supabase
          .from("event_categories")
          .select("key,label,emoji,active,sort_order")
          .in("key", categoryKeys);

        if (!categoryError && categoryRows) {
          const byKey = new Map(categoryRows.map((category) => [category.key, category as EventCategory]));
          categories = categoryKeys
            .map((key) => byKey.get(key))
            .filter(Boolean) as EventCategory[];
        }
      }
      const category =
        categories.length > 0
          ? `${categories[0].emoji} ${categories[0].label}`
          : vibes.length > 0
          ? `🎯 ${vibes[0]}`
          : tags.length > 0
            ? tags[0]
            : "🎉 Social";

      // Get user's vibe tags for match calculation
      let userVibes: string[] = [];
      if (user?.id) {
        const { data: userVibesData } = await supabase
          .from("profile_vibes")
          .select("vibe_tags(label)")
          .eq("profile_id", user.id);

        if (userVibesData) {
          type VibeRow = { vibe_tags: { label: string } | { label: string }[] | null };
          userVibes =
            (userVibesData as VibeRow[])
              .map((v) => {
                const vt = v.vibe_tags;
                if (!vt) return undefined;
                if (Array.isArray(vt)) {
                  return vt[0]?.label as string | undefined;
                }
                return (vt as { label: string }).label;
              })
              .filter(Boolean) as string[];
        }
      }

      // Calculate stable match percentage for this event
      const eventVibeLabels = [...vibes, ...tags];
      const vibeMatch = user?.id
        ? calculateVibeScoreStable(user.id, eventId, userVibes, eventVibeLabels, eventId)
        : 75; // Default for non-logged-in users

      return {
        id: data.id,
        title: data.title,
        description: data.description,
        coverImage: data.cover_image,
        category,
        vibeMatch,
        eventDate,
        time: `${startTimeStr} - ${endTimeStr}`,
        durationMinutes: data.duration_minutes || 60,
        isVirtual: !data.is_location_specific,
        venue: data.location_name || (data.is_location_specific ? "TBA" : "Digital Lobby"),
        address: data.location_address || (data.is_location_specific ? "" : "Video Speed Dating"),
        price: data.price_amount || 0,
        maxAttendees: data.max_attendees ?? 50,
        currentAttendees: data.current_attendees ?? 0,
        status: data.status ?? null,
        archivedAt: data.archived_at ? new Date(data.archived_at) : null,
        endedAt: data.ended_at ? new Date(data.ended_at) : null,
        tags: tags.map((t: string) => {
          if (t.includes("Electronic") || t.includes("Music")) return "🎧 " + t;
          if (t.includes("Tech") || t.includes("Gaming")) return "💻 " + t;
          if (t.includes("Speed")) return "⚡ " + t;
          if (t.includes("Food") || t.includes("Drink")) return "🍸 " + t;
          return t;
        }),
        categoryKeys,
        categories,
        isFree: data.is_free || false,
        eventVibes: eventVibeLabels,
        parentEventId: data.parent_event_id ?? null,
        occurrenceNumber: data.occurrence_number ?? null,
        scope: data.scope ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        visibility: data.visibility ?? null,
        language: data.language ?? null,
      };
    },
  });
};

/** Server admission: only `confirmed` may use lobby/deck; `waitlisted` is paid without capacity. */
export type EventRegistrationSnapshot = {
  isConfirmed: boolean;
  isWaitlisted: boolean;
};

export const useIsRegisteredForEvent = (
  eventId: string | undefined,
  userId: string | undefined
) => {
  return useQuery({
    queryKey: ["event-registration-check", eventId, userId],
    enabled: !!eventId && !!userId,
    queryFn: async (): Promise<EventRegistrationSnapshot | null> => {
      if (!eventId || !userId) return null;

      const { data, error } = await supabase
        .from("event_registrations")
        .select("admission_status")
        .eq("event_id", eventId)
        .eq("profile_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error checking registration:", error);
        return { isConfirmed: false, isWaitlisted: false };
      }

      if (!data?.admission_status) {
        return { isConfirmed: false, isWaitlisted: false };
      }

      return {
        isConfirmed: data.admission_status === "confirmed",
        isWaitlisted: data.admission_status === "waitlisted",
      };
    },
  });
};
