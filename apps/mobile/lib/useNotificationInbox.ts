import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserNotificationRow } from '@clientShared/notifications';
import { isExpiredNotification, isUrgentNotification, normalizeNotificationAction } from '@clientShared/notifications';

const INBOX_LIMIT = 80;

function activeExpiryFilter() {
  return `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`;
}

function normalizeRow(row: Record<string, unknown>): UserNotificationRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    category: String(row.category),
    title: String(row.title),
    body: typeof row.body === 'string' ? row.body : null,
    priority: row.priority === 'low' || row.priority === 'high' || row.priority === 'urgent' ? row.priority : 'normal',
    action: normalizeNotificationAction(row.action),
    data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {},
    actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
    image_url: typeof row.image_url === 'string' ? row.image_url : null,
    group_key: typeof row.group_key === 'string' ? row.group_key : null,
    group_count: typeof row.group_count === 'number' ? row.group_count : 1,
    dedupe_key: typeof row.dedupe_key === 'string' ? row.dedupe_key : null,
    seen_at: typeof row.seen_at === 'string' ? row.seen_at : null,
    read_at: typeof row.read_at === 'string' ? row.read_at : null,
    opened_at: typeof row.opened_at === 'string' ? row.opened_at : null,
    dismissed_at: typeof row.dismissed_at === 'string' ? row.dismissed_at : null,
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

function groupRows(rows: UserNotificationRow[]) {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const needsAction: UserNotificationRow[] = [];
  const today: UserNotificationRow[] = [];
  const earlier: UserNotificationRow[] = [];

  for (const row of rows) {
    if (isExpiredNotification(row, now)) earlier.push(row);
    else if (row.priority === 'urgent' || row.priority === 'high') needsAction.push(row);
    else if (new Date(row.created_at).getTime() >= startOfToday.getTime()) today.push(row);
    else earlier.push(row);
  }

  return { needsAction, today, earlier };
}

export function useNotificationInbox(userId: string | null | undefined) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['user-notifications', userId], [userId]);
  const unseenKey = useMemo(() => ['user-notifications-unseen', userId], [userId]);
  const urgentKey = useMemo(() => ['user-notifications-urgent', userId], [userId]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: unseenKey });
    void qc.invalidateQueries({ queryKey: urgentKey });
  }, [qc, queryKey, unseenKey, urgentKey]);

  const rowsQuery = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [] as UserNotificationRow[];
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .or(activeExpiryFilter())
        .order('created_at', { ascending: false })
        .limit(INBOX_LIMIT);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeRow);
    },
  });

  const unseenQuery = useQuery({
    queryKey: unseenKey,
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return 0;
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('seen_at', null)
        .is('dismissed_at', null)
        .or(activeExpiryFilter());
      if (error) throw error;
      return count ?? 0;
    },
  });

  const urgentQuery = useQuery({
    queryKey: urgentKey,
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return 0;
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('priority', 'urgent')
        .is('seen_at', null)
        .is('dismissed_at', null)
        .or(activeExpiryFilter());
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`user-notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
        invalidate,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [invalidate, userId]);

  const markSeen = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    await supabase.rpc('mark_notifications_seen', { notification_ids: ids });
    invalidate();
  }, [invalidate]);

  const markOpened = useCallback(async (id: string) => {
    await supabase.rpc('mark_notification_opened', { notification_id: id });
    invalidate();
  }, [invalidate]);

  const dismiss = useCallback(async (id: string) => {
    await supabase.rpc('dismiss_notification', { notification_id: id });
    invalidate();
  }, [invalidate]);

  const markAllRead = useCallback(async () => {
    await supabase.rpc('mark_all_notifications_read');
    invalidate();
  }, [invalidate]);

  const rows = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const grouped = useMemo(() => groupRows(rows), [rows]);
  const urgentUnseenCount = urgentQuery.data ?? rows.filter((row) => !row.seen_at && !row.dismissed_at && isUrgentNotification(row.priority)).length;

  return {
    rows,
    grouped,
    unseenCount: unseenQuery.data ?? 0,
    urgentUnseenCount,
    isLoading: rowsQuery.isLoading,
    error: rowsQuery.error ?? unseenQuery.error ?? urgentQuery.error,
    refetch: invalidate,
    markSeen,
    markOpened,
    dismiss,
    markAllRead,
  };
}

export type NotificationInboxController = ReturnType<typeof useNotificationInbox>;
