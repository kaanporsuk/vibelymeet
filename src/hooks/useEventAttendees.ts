import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  parseEventAttendeePreviewRows,
  type EventAttendeePreview as PreviewRevealedAttendee,
} from "@shared/eventProfileAdapters";

export type { PreviewRevealedAttendee };

export type EventAttendeePreviewPayload =
  | {
      success: true;
      viewer_admission: "confirmed" | "waitlisted" | "none";
      visible_other_count: number;
      /** @deprecated Compatibility alias. Same privacy-safe value as visible_other_count. */
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

  const revealed = parseEventAttendeePreviewRows(row.revealed);
  const visibleOtherCount = Number(row.visible_other_count ?? row.total_other_confirmed ?? 0);

  return {
    success: true,
    viewer_admission: row.viewer_admission as "confirmed" | "waitlisted" | "none",
    visible_other_count: visibleOtherCount,
    total_other_confirmed: visibleOtherCount,
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
          id: r.id,
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
