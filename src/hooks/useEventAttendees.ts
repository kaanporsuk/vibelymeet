import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

export interface PreviewRevealedAttendee {
  profile_id: string;
  name: string;
  age: number;
  avatar_path: string | null;
  shared_vibe_count: number;
  super_vibe_toward_viewer: boolean;
  vibe_label: string | null;
}

export type EventAttendeePreviewPayload =
  | {
      success: true;
      viewer_admission: "confirmed" | "waitlisted" | "none";
      total_other_confirmed: number;
      visible_cohort_count: number;
      obscured_remaining: number;
      revealed: PreviewRevealedAttendee[];
    }
  | {
      success: false;
      error?: string;
      code?: string;
    };

export interface EventAttendee {
  id: string;
  name: string;
  avatar_url: string | null;
  photos: string[] | null;
}

function parsePreviewPayload(data: unknown): EventAttendeePreviewPayload {
  const row = data as Record<string, unknown> | null;
  if (!row || row.success === false) {
    return {
      success: false,
      error: typeof row?.error === "string" ? row.error : "unknown",
      code: typeof row?.code === "string" ? row.code : undefined,
    };
  }

  let revealed: PreviewRevealedAttendee[] = [];
  const raw = row.revealed;
  if (Array.isArray(raw)) {
    revealed = raw.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        profile_id: String(o.profile_id ?? ""),
        name: String(o.name ?? ""),
        age: Number(o.age ?? 0),
        avatar_path: o.avatar_path == null ? null : String(o.avatar_path),
        shared_vibe_count: Number(o.shared_vibe_count ?? 0),
        super_vibe_toward_viewer: o.super_vibe_toward_viewer === true,
        vibe_label: o.vibe_label == null ? null : String(o.vibe_label),
      };
    });
  }

  return {
    success: true,
    viewer_admission: row.viewer_admission as "confirmed" | "waitlisted" | "none",
    total_other_confirmed: Number(row.total_other_confirmed ?? 0),
    visible_cohort_count: Number(row.visible_cohort_count ?? 0),
    obscured_remaining: Number(row.obscured_remaining ?? 0),
    revealed,
  };
}

/** Server-owned attendee preview (top-2 + aggregates). */
export function useEventAttendeePreview(eventId: string | undefined) {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ["event-attendee-preview", eventId, user?.id],
    enabled: !!eventId && !!user?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<EventAttendeePreviewPayload> => {
      if (!eventId || !user?.id) {
        return { success: false, error: "missing_params" };
      }

      const { data, error } = await supabase.rpc("get_event_attendee_preview", {
        p_event_id: eventId,
        p_viewer_id: user.id,
      });

      if (error) {
        console.error("get_event_attendee_preview", error);
        return { success: false, error: error.message };
      }

      return parsePreviewPayload(data);
    },
  });
}

/**
 * Featured card: maps preview to slim attendee rows (max 2 revealed).
 * `limit` is unused; kept for call-site compatibility.
 */
export function useEventAttendees(eventId: string | undefined, _limit: number = 5) {
  const q = useEventAttendeePreview(eventId);
  const mapped: EventAttendee[] =
    q.data?.success === true
      ? q.data.revealed.map((r) => ({
          id: r.profile_id,
          name: r.name,
          avatar_url: r.avatar_path,
          photos: r.avatar_path ? [r.avatar_path] : null,
        }))
      : [];

  return {
    ...q,
    data: mapped,
    preview: q.data,
  };
}
