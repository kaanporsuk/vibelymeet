/**
 * Vibe Schedule — parity with web src/hooks/useSchedule.ts
 *
 * Schedule rows are loaded via React Query (`SCHEDULE_QUERY_KEY`) so Profile Studio and
 * the full Schedule screen share one cache — edits on either surface update the mini-grid immediately.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export type ScheduleTimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';
export type ScheduleSlotState = 'busy' | 'open' | 'locked' | 'saving';

export interface ScheduleSlot {
  isoDate: string;
  bucket: ScheduleTimeBucket;
  state: ScheduleSlotState;
}

export interface ScheduleDay {
  isoDate: string;
  date: Date;
  weekdayShort: string;
  dayNumber: string;
  isToday: boolean;
}

export type ScheduleRecord = Record<string, { status: 'open' | 'busy' }>;

/** Shared React Query key — use for invalidation from any screen */
export const SCHEDULE_QUERY_KEY = (userId: string) => ['user-schedule', userId] as const;

export const TIME_BLOCK_INFO: Record<ScheduleTimeBucket, { label: string; hours: string }> = {
  morning: { label: 'Morning', hours: '08:00 – 12:00' },
  afternoon: { label: 'Afternoon', hours: '12:00 – 17:00' },
  evening: { label: 'Evening', hours: '17:00 – 21:00' },
  night: { label: 'Night', hours: '21:00 – 00:00' },
};

const BUCKETS: ScheduleTimeBucket[] = ['morning', 'afternoon', 'evening', 'night'];

function slotKey(isoDate: string, bucket: ScheduleTimeBucket): string {
  return `${isoDate}_${bucket}`;
}

const RANGE_DAYS = 14;

async function loadUserSchedule(userId: string): Promise<ScheduleRecord> {
  const { data, error } = await supabase
    .from('user_schedules')
    .select('slot_key, slot_date, time_block, status')
    .eq('user_id', userId);
  if (error) throw error;
  const next: ScheduleRecord = {};
  (data ?? []).forEach((row) => {
    next[row.slot_key] = { status: (row.status as 'open' | 'busy') || 'open' };
  });
  return next;
}

export function useSchedule() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const {
    data: schedule = {},
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: SCHEDULE_QUERY_KEY(userId ?? 'none'),
    queryFn: () => loadUserSchedule(userId!),
    enabled: !!userId,
  });

  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  const [rangeStart, setRangeStart] = useState<Date>(() => startOfDay(new Date()));
  const dateRange = useMemo(() => {
    return Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i));
  }, [rangeStart]);

  const dateRangeDisplay = useMemo(() => {
    if (dateRange.length === 0) return { start: rangeStart, end: rangeStart };
    return { start: dateRange[0], end: dateRange[dateRange.length - 1] };
  }, [dateRange, rangeStart]);

  const days: ScheduleDay[] = useMemo(() => {
    const today = startOfDay(new Date());
    return dateRange.map((d) => ({
      isoDate: format(d, 'yyyy-MM-dd'),
      date: d,
      weekdayShort: format(d, 'EEE'),
      dayNumber: format(d, 'd'),
      isToday: d.getTime() === today.getTime(),
    }));
  }, [dateRange]);

  const [lockedSlotKeys] = useState<Set<string>>(new Set());

  const getSlotState = useCallback(
    (isoDate: string, bucket: ScheduleTimeBucket): ScheduleSlotState => {
      const key = slotKey(isoDate, bucket);
      if (lockedSlotKeys.has(key)) return 'locked';
      if (pendingKeys.has(key)) return 'saving';
      const row = schedule[key];
      if (row?.status === 'open') return 'open';
      return 'busy';
    },
    [schedule, pendingKeys, lockedSlotKeys],
  );

  const toggleSlot = useCallback(
    async (isoDate: string, bucket: ScheduleTimeBucket): Promise<void> => {
      if (!userId) return;
      const qKey = SCHEDULE_QUERY_KEY(userId);
      const key = slotKey(isoDate, bucket);
      if (pendingKeys.has(key)) return;
      const prev = queryClient.getQueryData<ScheduleRecord>(qKey) ?? {};
      const current = prev[key];
      if (current?.status === 'open') {
        setPendingKeys((p) => new Set(p).add(key));
        queryClient.setQueryData<ScheduleRecord>(qKey, (old = {}) => {
          const next = { ...old };
          delete next[key];
          return next;
        });
        try {
          const { error } = await supabase
            .from('user_schedules')
            .delete()
            .eq('user_id', userId)
            .eq('slot_key', key);
          if (error) throw error;
        } catch (e) {
          queryClient.setQueryData<ScheduleRecord>(qKey, (old = {}) => ({
            ...old,
            [key]: { status: 'open' },
          }));
          throw e;
        } finally {
          setPendingKeys((p) => {
            const n = new Set(p);
            n.delete(key);
            return n;
          });
        }
      } else {
        setPendingKeys((p) => new Set(p).add(key));
        queryClient.setQueryData<ScheduleRecord>(qKey, (old = {}) => ({
          ...old,
          [key]: { status: 'open' },
        }));
        try {
          const { error } = await supabase.from('user_schedules').upsert(
            {
              user_id: userId,
              slot_key: key,
              slot_date: isoDate,
              time_block: bucket,
              status: 'open',
            },
            { onConflict: 'user_id,slot_key' },
          );
          if (error) throw error;
        } catch (e) {
          queryClient.setQueryData<ScheduleRecord>(qKey, (old = {}) => {
            const next = { ...old };
            delete next[key];
            return next;
          });
          throw e;
        } finally {
          setPendingKeys((p) => {
            const n = new Set(p);
            n.delete(key);
            return n;
          });
        }
      }
    },
    [userId, pendingKeys, queryClient],
  );

  const rollPreviousWeek = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const qKey = SCHEDULE_QUERY_KEY(userId);
    const today = startOfDay(new Date());
    const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const prev = queryClient.getQueryData<ScheduleRecord>(qKey) ?? {};
    const newSchedule = { ...prev };
    const newSlots: Array<{
      user_id: string;
      slot_key: string;
      slot_date: string;
      time_block: string;
      status: string;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const sourceDate = addDays(currentWeekStart, i);
      const targetDate = addDays(currentWeekStart, i + 7);
      const targetIso = format(targetDate, 'yyyy-MM-dd');
      for (const block of BUCKETS) {
        const sourceKey = slotKey(format(sourceDate, 'yyyy-MM-dd'), block);
        const targetKey = slotKey(targetIso, block);
        const sourceSlot = newSchedule[sourceKey];
        if (sourceSlot?.status === 'open') {
          newSchedule[targetKey] = { status: 'open' };
          newSlots.push({
            user_id: userId,
            slot_key: targetKey,
            slot_date: targetIso,
            time_block: block,
            status: 'open',
          });
        }
      }
    }
    queryClient.setQueryData(qKey, newSchedule);
    if (newSlots.length > 0) {
      await supabase.from('user_schedules').upsert(newSlots, { onConflict: 'user_id,slot_key' });
    }
  }, [userId, queryClient]);

  const setDateRange = useCallback((start: Date, _end: Date) => {
    setRangeStart(startOfDay(start));
  }, []);

  const shiftRange = useCallback((direction: -1 | 1) => {
    setRangeStart((s) => addDays(s, direction * RANGE_DAYS));
  }, []);

  const slotsForGrid = useMemo(() => {
    const out: ScheduleSlot[] = [];
    days.forEach((d) => {
      BUCKETS.forEach((bucket) => {
        out.push({
          isoDate: d.isoDate,
          bucket,
          state: getSlotState(d.isoDate, bucket),
        });
      });
    });
    return out;
  }, [days, getSlotState]);

  return {
    slots: slotsForGrid,
    days,
    schedule,
    isLoading: loading,
    toggleSlot,
    rollPreviousWeek,
    refetch,
    dateRange: dateRangeDisplay,
    setDateRange,
    shiftRange,
    getSlotState,
    pendingKeys,
    BUCKETS,
  };
}
