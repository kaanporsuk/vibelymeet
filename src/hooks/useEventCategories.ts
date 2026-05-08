import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_EVENT_CATEGORIES,
  type EventCategory,
} from "@clientShared/eventCategories";

export type { EventCategory };

export function useEventCategories(options?: { includeInactive?: boolean }) {
  const includeInactive = options?.includeInactive ?? false;

  return useQuery({
    queryKey: ["event-categories", includeInactive],
    queryFn: async (): Promise<EventCategory[]> => {
      let query = supabase
        .from("event_categories")
        .select("key,label,emoji,active,sort_order")
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });

      if (!includeInactive) {
        query = query.eq("active", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as EventCategory[];
    },
    placeholderData: includeInactive ? undefined : DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category, active: true })),
    staleTime: 60_000,
  });
}
