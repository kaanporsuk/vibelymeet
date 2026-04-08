import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  buildScheduleHubItem,
  partitionScheduleHubItems,
  toScheduleReminderSources,
  type ScheduleHubPlan,
  type ScheduleHubRevision,
  type ScheduleHubSuggestionRecord,
} from '../../../shared/schedule/planningHub';

type SuggestionRow = {
  id: string;
  match_id: string;
  proposer_id: string;
  recipient_id: string;
  status: string;
  current_revision_id: string | null;
  expires_at: string | null;
  schedule_share_expires_at: string | null;
  date_plan_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

async function loadScheduleHubSuggestions(userId: string): Promise<ScheduleHubSuggestionRecord[]> {
  const { data: suggestions, error: suggestionError } = await supabase
    .from('date_suggestions')
    .select(
      `
        id,
        match_id,
        proposer_id,
        recipient_id,
        status,
        current_revision_id,
        expires_at,
        schedule_share_expires_at,
        date_plan_id,
        created_at,
        updated_at
      `
    )
    .or(`proposer_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('updated_at', { ascending: false });

  if (suggestionError) throw suggestionError;

  const list = (suggestions ?? []) as SuggestionRow[];
  if (list.length === 0) return [];

  const suggestionIds = list.map((row) => row.id);
  const planIds = list.map((row) => row.date_plan_id).filter(Boolean) as string[];
  const partnerIds = Array.from(
    new Set(
      list.map((row) => (row.proposer_id === userId ? row.recipient_id : row.proposer_id)).filter(Boolean)
    )
  );

  const [{ data: revisions }, { data: plans }, { data: profiles }] = await Promise.all([
    supabase
      .from('date_suggestion_revisions')
      .select('*')
      .in('date_suggestion_id', suggestionIds)
      .order('revision_number', { ascending: true }),
    planIds.length > 0
      ? supabase.from('date_plans').select('*').in('id', planIds)
      : Promise.resolve({ data: [] as ScheduleHubPlan[], error: null }),
    partnerIds.length > 0
      ? supabase.from('profiles').select('id, name, avatar_url').in('id', partnerIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
  ]);

  const revisionsBySuggestion = new Map<string, ScheduleHubRevision[]>();
  for (const revision of (revisions ?? []) as ScheduleHubRevision[]) {
    const suggestionId = revision.date_suggestion_id;
    if (!revisionsBySuggestion.has(suggestionId)) revisionsBySuggestion.set(suggestionId, []);
    revisionsBySuggestion.get(suggestionId)?.push(revision);
  }

  const plansById = new Map<string, ScheduleHubPlan>();
  for (const plan of (plans ?? []) as ScheduleHubPlan[]) {
    plansById.set(plan.id, plan);
  }

  const profilesById = new Map<string, ProfileRow>();
  for (const profile of (profiles ?? []) as ProfileRow[]) {
    profilesById.set(profile.id, profile);
  }

  return list.map((row) => {
    const partnerUserId = row.proposer_id === userId ? row.recipient_id : row.proposer_id;
    const partner = profilesById.get(partnerUserId);
    return {
      ...row,
      revisions: revisionsBySuggestion.get(row.id) ?? [],
      date_plan: row.date_plan_id ? plansById.get(row.date_plan_id) ?? null : null,
      partner_name: partner?.name?.trim() || 'Your match',
      partner_user_id: partnerUserId,
      partner_avatar: partner?.avatar_url ?? null,
    };
  });
}

export function useScheduleHub() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const query = useQuery({
    queryKey: ['schedule-hub', userId],
    queryFn: () => loadScheduleHubSuggestions(userId!),
    enabled: !!userId,
  });

  const items = useMemo(() => {
    if (!userId) return [];
    return (query.data ?? [])
      .map((record) => buildScheduleHubItem(record, userId))
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [query.data, userId]);

  const buckets = useMemo(() => partitionScheduleHubItems(items), [items]);
  const reminderSources = useMemo(() => toScheduleReminderSources(items), [items]);

  return {
    items,
    pendingItems: buckets.pending,
    upcomingItems: buckets.upcoming,
    historyItems: buckets.history,
    reminderSources,
    ...query,
  };
}
