/**
 * Mystery Match when deck is empty — find_mystery_match RPC, optional periodic retry.
 * Reference: src/hooks/useMysteryMatch.ts
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type UseMysteryMatchOptions = {
  eventId: string | undefined;
  onMatchFound?: (sessionId: string, partnerId: string) => void;
  /** When false, stops polling and no-ops find (e.g. account on break). */
  enabled?: boolean;
};

export function useMysteryMatch({ eventId, onMatchFound, enabled = true }: UseMysteryMatchOptions) {
  const [isSearching, setIsSearching] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventIdRef = useRef(eventId);

  useEffect(() => {
    eventIdRef.current = eventId;
    if (!eventId && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      setIsWaiting(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!enabled) {
      setIsWaiting(false);
      setIsSearching(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [enabled]);

  const findMysteryMatch = useCallback(async () => {
    if (!enabled) return;
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
          if (!eventIdRef.current) {
            setIsWaiting(false);
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            return;
          }
          try {
            const { data: retryData, error: retryError } = await supabase.rpc('find_mystery_match', {
              p_event_id: eventIdRef.current!,
              p_user_id: user.id,
            });
            if (retryError) {
              if (__DEV__) console.warn('[useMysteryMatch] retry failed:', retryError.message);
              setIsWaiting(false);
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              return;
            }
            const retryResult = retryData as { success?: boolean; session_id?: string; partner_id?: string } | null;
            if (retryResult?.success && retryResult.session_id) {
              onMatchFound?.(retryResult.session_id, retryResult.partner_id ?? '');
              setIsWaiting(false);
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          } catch (err) {
            if (__DEV__) console.warn('[useMysteryMatch] retry error:', err);
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
  }, [eventId, onMatchFound, isWaiting, enabled]);

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
