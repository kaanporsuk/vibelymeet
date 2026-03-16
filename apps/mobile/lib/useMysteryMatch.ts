/**
 * Mystery Match when deck is empty — find_mystery_match RPC, optional periodic retry.
 * Reference: src/hooks/useMysteryMatch.ts
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type UseMysteryMatchOptions = {
  eventId: string | undefined;
  onMatchFound?: (sessionId: string, partnerId: string) => void;
};

export function useMysteryMatch({ eventId, onMatchFound }: UseMysteryMatchOptions) {
  const [isSearching, setIsSearching] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const findMysteryMatch = useCallback(async () => {
    if (intervalRef.current || isWaiting) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!eventId || !user?.id) return;

    setIsSearching(true);

    try {
      const { data, error } = await supabase.rpc('find_mystery_match', {
        p_event_id: eventId,
        p_user_id: user.id,
      });

      if (error) {
        setIsSearching(false);
        return;
      }

      const result = data as { success?: boolean; session_id?: string; partner_id?: string } | null;

      if (result?.success && result.session_id) {
        onMatchFound?.(result.session_id, result.partner_id ?? '');
        setIsSearching(false);
      } else {
        setIsSearching(false);
        setIsWaiting(true);
        intervalRef.current = setInterval(async () => {
          const { data: retryData } = await supabase.rpc('find_mystery_match', {
            p_event_id: eventId,
            p_user_id: user.id,
          });
          const retryResult = retryData as { success?: boolean; session_id?: string; partner_id?: string } | null;
          if (retryResult?.success && retryResult.session_id) {
            onMatchFound?.(retryResult.session_id, retryResult.partner_id ?? '');
            setIsWaiting(false);
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        }, 30000);
      }
    } catch {
      setIsSearching(false);
    }
  }, [eventId, onMatchFound]);

  const cancelSearch = useCallback(() => {
    setIsWaiting(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { findMysteryMatch, cancelSearch, isSearching, isWaiting };
}
