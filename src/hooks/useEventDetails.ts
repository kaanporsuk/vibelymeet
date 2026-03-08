import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addMinutes } from "date-fns";
import { calculateVibeScoreStable } from "@/utils/vibeScoreUtils";
import { useAuth } from "@/contexts/AuthContext";

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
  priceMale: number;
  priceFemale: number;
  maxMen: number;
  maxWomen: number;
  currentMen: number;
  currentWomen: number;
  tags: string[];
  isFree: boolean;
  eventVibes: string[];
  // New geo/series fields
  parentEventId: string | null;
  occurrenceNumber: number | null;
  scope: string | null;
  city: string | null;
  country: string | null;
}

export interface EventAttendee {
  id: string;
  name: string;
  age: number;
  avatar: string;
  vibeTag: string;
  matchPercent: number;
  bio: string;
  photos: string[];
  vibeTags?: string[];
  photoVerified?: boolean;
  hasVibeVideo?: boolean;
  vibeVideoUrl?: string;
}

// Helper to resolve photo URL via centralized utility
import { getImageUrl } from "@/utils/imageUrl";

function resolvePhotoUrl(path: string): string {
  return getImageUrl(path);
}

export const useEventDetails = (eventId: string | undefined) => {
  const { user } = useAuth();

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
      const category =
        vibes.length > 0
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
          userVibes = userVibesData
            .map((v) => (v.vibe_tags as { label: string } | null)?.label)
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
        priceMale: data.price_amount || 0,
        priceFemale: (data.price_amount || 0) * 0.6, // 40% discount for women
        maxMen: data.max_male_attendees || Math.floor((data.max_attendees || 50) / 2),
        maxWomen: data.max_female_attendees || Math.floor((data.max_attendees || 50) / 2),
        currentMen: Math.floor((data.current_attendees || 0) / 2),
        currentWomen: Math.ceil((data.current_attendees || 0) / 2),
        tags: tags.map((t: string) => {
          if (t.includes("Electronic") || t.includes("Music")) return "🎧 " + t;
          if (t.includes("Tech") || t.includes("Gaming")) return "💻 " + t;
          if (t.includes("Speed")) return "⚡ " + t;
          if (t.includes("Food") || t.includes("Drink")) return "🍸 " + t;
          return t;
        }),
        isFree: data.is_free || false,
        eventVibes: eventVibeLabels,
        parentEventId: data.parent_event_id ?? null,
        occurrenceNumber: data.occurrence_number ?? null,
        scope: data.scope ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
      };
    },
  });
};

export const useEventAttendees = (eventId: string | undefined) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["event-attendees", eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventAttendee[]> => {
      if (!eventId) return [];

      // Fetch registrations with profile data
      const { data: registrations, error } = await supabase
        .from("event_registrations")
        .select(
          `
          profile_id,
          profiles:profile_id (
            id,
            name,
            age,
            avatar_url,
            bio,
            photos,
            photo_verified
          )
        `
        )
        .eq("event_id", eventId);

      if (error) {
        console.error("Error fetching attendees:", error);
        return [];
      }

      if (!registrations?.length) return [];

      // Fetch vibes for all attendees
      const profileIds = registrations.map((r) => r.profile_id);
      const { data: vibesData } = await supabase
        .from("profile_vibes")
        .select("profile_id, vibe_tags(label)")
        .in("profile_id", profileIds);

      // Group vibes by profile
      const vibesByProfile: Record<string, string[]> = {};
      if (vibesData) {
        for (const v of vibesData) {
          const label = (v.vibe_tags as { label: string } | null)?.label;
          if (label) {
            if (!vibesByProfile[v.profile_id]) {
              vibesByProfile[v.profile_id] = [];
            }
            vibesByProfile[v.profile_id].push(label);
          }
        }
      }

      // Get current user's vibes for match calculation
      let userVibes: string[] = [];
      if (user?.id) {
        const { data: userVibesData } = await supabase
          .from("profile_vibes")
          .select("vibe_tags(label)")
          .eq("profile_id", user.id);

        if (userVibesData) {
          userVibes = userVibesData
            .map((v) => (v.vibe_tags as { label: string } | null)?.label)
            .filter(Boolean) as string[];
        }
      }

      // Process each attendee with signed URLs
      const attendees = await Promise.all(
        registrations
          .filter((r) => r.profiles)
          .map(async (r) => {
            const profile = r.profiles as {
              id: string;
              name: string;
              age: number;
              avatar_url: string | null;
              bio: string | null;
              photos: string[] | null;
              photo_verified: boolean | null;
              video_intro_url: string | null;
            };
            const profileVibes = vibesByProfile[profile.id] || [];

            // Resolve photo URLs via centralized utility
            const avatarPath = profile.avatar_url || profile.photos?.[0] || "";
            const resolvedAvatar = resolvePhotoUrl(avatarPath);

            const resolvedPhotos = (profile.photos || []).map((p) => resolvePhotoUrl(p));

            // Calculate STABLE match percentage
            const matchPercent = user?.id
              ? calculateVibeScoreStable(user.id, profile.id, userVibes, profileVibes, eventId)
              : 75;

            return {
              id: profile.id,
              name: profile.name,
              age: profile.age,
              avatar: resolvedAvatar,
              vibeTag: profileVibes[0] || "New Vibe",
              matchPercent,
              bio: profile.bio || "",
              photos: resolvedPhotos,
              vibeTags: profileVibes.slice(0, 2),
              photoVerified: profile.photo_verified || false,
              hasVibeVideo: !!profile.video_intro_url,
              vibeVideoUrl: profile.video_intro_url || undefined,
            };
          })
      );

      return attendees;
    },
  });
};

export const useIsRegisteredForEvent = (
  eventId: string | undefined,
  userId: string | undefined
) => {
  return useQuery({
    queryKey: ["event-registration-check", eventId, userId],
    enabled: !!eventId && !!userId,
    queryFn: async (): Promise<boolean> => {
      if (!eventId || !userId) return false;

      const { data, error } = await supabase
        .from("event_registrations")
        .select("id")
        .eq("event_id", eventId)
        .eq("profile_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error checking registration:", error);
        return false;
      }

      return !!data;
    },
  });
};
