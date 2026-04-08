import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfWeek, startOfDay } from "date-fns";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type TimeBlock = "morning" | "afternoon" | "evening" | "night";
export type SlotStatus = "busy" | "open" | "event";

export interface TimeSlot {
  date: Date;
  block: TimeBlock;
  status: SlotStatus;
  eventName?: string;
  eventId?: string;
}

export interface ScheduleData {
  [key: string]: TimeSlot;
}

export interface DateProposal {
  id: string;
  date: Date;
  block: TimeBlock;
  mode: "video" | "in-person";
  message: string;
  status: "pending" | "accepted" | "declined";
  sentAt: Date;
  isIncoming?: boolean;
  senderName?: string;
  senderAvatar?: string;
  matchId?: string;
}

const TIME_BLOCK_INFO: Record<TimeBlock, { label: string; hours: string }> = {
  morning: { label: "Morning", hours: "08:00 - 12:00" },
  afternoon: { label: "Afternoon", hours: "12:00 - 17:00" },
  evening: { label: "Evening", hours: "17:00 - 21:00" },
  night: { label: "Night", hours: "21:00 - 00:00" },
};

export const getTimeBlockInfo = (block: TimeBlock) => TIME_BLOCK_INFO[block];

const generateSlotKey = (date: Date, block: TimeBlock): string => {
  return `${format(date, "yyyy-MM-dd")}_${block}`;
};

const SCHEDULE_QUERY_KEY = (userId: string) => ["user-schedule", userId] as const;

async function loadUserSchedule(userId: string): Promise<ScheduleData> {
  const { data, error } = await supabase
    .from("user_schedules")
    .select("slot_key, slot_date, time_block, status")
    .eq("user_id", userId);

  if (error) throw error;

  const schedule: ScheduleData = {};
  (data ?? []).forEach((row) => {
    const date = new Date(`${row.slot_date}T00:00:00`);
    schedule[row.slot_key] = {
      date,
      block: row.time_block as TimeBlock,
      status: row.status as SlotStatus,
    };
  });
  return schedule;
}

export const useSchedule = () => {
  const { user } = useUserProfile();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [pendingSlots, setPendingSlots] = useState<Set<string>>(new Set());
  const {
    data: mySchedule = {},
    isLoading,
    refetch,
  } = useQuery({
    queryKey: SCHEDULE_QUERY_KEY(userId ?? "none"),
    queryFn: () => loadUserSchedule(userId!),
    enabled: !!userId,
  });

  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  const toggleSlot = useCallback(async (date: Date, block: TimeBlock) => {
    const key = generateSlotKey(date, block);
    if (!userId) return;
    const queryKey = SCHEDULE_QUERY_KEY(userId);

    const previousSchedule = queryClient.getQueryData<ScheduleData>(queryKey) ?? {};
    const currentSlot = previousSchedule[key];
    if (currentSlot?.status === "event") return;

    setPendingSlots(prev => new Set(prev).add(key));

    const isRemoving = currentSlot?.status === "open";

    queryClient.setQueryData<ScheduleData>(queryKey, (prev = {}) => {
      if (isRemoving) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { date, block, status: "open" } };
    });

    try {
      if (isRemoving) {
        const { error } = await supabase
          .from("user_schedules")
          .delete()
          .eq("user_id", userId)
          .eq("slot_key", key);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_schedules")
          .upsert(
            {
              user_id: userId,
              slot_key: key,
              slot_date: format(date, "yyyy-MM-dd"),
              time_block: block,
              status: "open",
            },
            { onConflict: "user_id,slot_key" },
          );

        if (error) throw error;
      }
    } catch (error) {
      queryClient.setQueryData(queryKey, previousSchedule);
      console.error("Failed to sync schedule:", error);
      throw error;
    } finally {
      setPendingSlots(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [queryClient, userId]);

  const getSlotStatus = useCallback(
    (date: Date, block: TimeBlock): TimeSlot | null => {
      const key = generateSlotKey(date, block);
      return mySchedule[key] || null;
    },
    [mySchedule]
  );

  const copyPreviousWeek = useCallback(async () => {
    if (!userId) return;
    const queryKey = SCHEDULE_QUERY_KEY(userId);
    const previousSchedule = queryClient.getQueryData<ScheduleData>(queryKey) ?? {};

    const today = startOfDay(new Date());
    const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const nextSchedule = { ...previousSchedule };
    const newSlots: Array<{ user_id: string; slot_key: string; slot_date: string; time_block: string; status: string }> = [];

    for (let i = 0; i < 7; i++) {
      const sourceDate = addDays(currentWeekStart, i);
      const targetDate = addDays(currentWeekStart, i + 7);

      (["morning", "afternoon", "evening", "night"] as TimeBlock[]).forEach((block) => {
        const sourceKey = generateSlotKey(sourceDate, block);
        const targetKey = generateSlotKey(targetDate, block);
        const sourceSlot = previousSchedule[sourceKey];

        if (sourceSlot?.status === "open") {
          nextSchedule[targetKey] = { date: targetDate, block, status: "open" };
          newSlots.push({
            user_id: userId,
            slot_key: targetKey,
            slot_date: format(targetDate, "yyyy-MM-dd"),
            time_block: block,
            status: "open",
          });
        }
      });
    }

    queryClient.setQueryData(queryKey, nextSchedule);

    try {
      if (newSlots.length > 0) {
        const { error } = await supabase
          .from("user_schedules")
          .upsert(newSlots, { onConflict: "user_id,slot_key" });
        if (error) throw error;
      }
    } catch (error) {
      queryClient.setQueryData(queryKey, previousSchedule);
      throw error;
    }
  }, [queryClient, userId]);

  const isSlotPending = useCallback((date: Date, block: TimeBlock): boolean => {
    const key = generateSlotKey(date, block);
    return pendingSlots.has(key);
  }, [pendingSlots]);

  return {
    mySchedule,
    dateRange,
    toggleSlot,
    getSlotStatus,
    copyPreviousWeek,
    getTimeBlockInfo,
    isLoading,
    isSyncing: pendingSlots.size > 0,
    isSlotPending,
    refetch,
  };
};


// Hook for viewing mutual availability with a match
export const useMutualAvailability = (_matchId: string) => {
  const { mySchedule, dateRange } = useSchedule();
  // Empty schedule for now until we have actual match schedules from DB
  const [matchSchedule] = useState<ScheduleData>({});

  const getMutualSlots = useMemo(() => {
    const slots: Array<{
      date: Date;
      block: TimeBlock;
      type: "golden" | "available";
    }> = [];

    dateRange.forEach(date => {
      (['morning', 'afternoon', 'evening', 'night'] as TimeBlock[]).forEach(block => {
        const key = `${format(date, "yyyy-MM-dd")}_${block}`;
        const mySlot = mySchedule[key];
        const matchSlot = matchSchedule[key];

        // Only show slots where match is open
        if (matchSlot?.status === "open") {
          if (mySlot?.status === "open") {
            slots.push({ date, block, type: "golden" });
          } else if (!mySlot || mySlot.status === "busy") {
            slots.push({ date, block, type: "available" });
          }
        }
      });
    });

    return slots;
  }, [mySchedule, matchSchedule, dateRange]);

  return {
    mutualSlots: getMutualSlots,
    dateRange,
  };
};
