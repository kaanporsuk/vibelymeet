import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Minimum interval between typing broadcasts. Caps per-keystroke churn. */
const TYPING_BROADCAST_INTERVAL_MS = 600;

/**
 * Mirrors native `useTypingBroadcast` (apps/mobile/lib/chatApi.ts): broadcast when the
 * local user types, subscribe for partner typing on `chat-typing-${matchId}`.
 *
 * Uses Supabase Realtime broadcast with `extras: { httpSend: true }` to silence the
 * deprecation warning about implicit REST fallback. Per-keystroke calls are coalesced
 * by a fixed-interval rate limiter so we don't queue dozens of postMessage tasks per
 * second while the user is typing — the previous version sent a broadcast on every
 * change of the `isTyping` state, which churned the React scheduler hard enough to
 * make call-button presses feel laggy.
 */
export function useTypingBroadcast(
  matchId: string | null,
  currentUserId: string | null | undefined,
  isTyping: boolean,
  enabled: boolean
) {
  const [partnerTyping, setPartnerTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isTypingRef = useRef(isTyping);
  const lastSendAtRef = useRef(0);
  const lastSentValueRef = useRef<boolean | null>(null);
  const trailingSendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    if (!matchId || !currentUserId || !enabled) {
      setPartnerTyping(false);
      return;
    }
    const channelName = `chat-typing-${matchId}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        const { userId, typing } = (payload.payload as { userId?: string; typing?: boolean }) ?? {};
        if (userId && userId !== currentUserId) setPartnerTyping(typing === true);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && isTypingRef.current) {
          void (channel.send as (
            args: Record<string, unknown>,
          ) => Promise<unknown>)({
            type: "broadcast",
            event: "typing",
            payload: { userId: currentUserId, typing: true },
            extras: { httpSend: true },
          });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setPartnerTyping(false);
      if (trailingSendTimeoutRef.current) {
        clearTimeout(trailingSendTimeoutRef.current);
        trailingSendTimeoutRef.current = null;
      }
      lastSentValueRef.current = null;
    };
  }, [matchId, currentUserId, enabled]);

  const dispatchSend = useCallback(
    (typing: boolean) => {
      if (!matchId || !currentUserId || !channelRef.current) return;
      lastSendAtRef.current = Date.now();
      lastSentValueRef.current = typing;
      void (channelRef.current.send as (
        args: Record<string, unknown>,
      ) => Promise<unknown>)({
        type: "broadcast",
        event: "typing",
        payload: { userId: currentUserId, typing },
        extras: { httpSend: true },
      });
    },
    [matchId, currentUserId],
  );

  const sendTyping = useCallback(
    (typing: boolean) => {
      if (!matchId || !currentUserId || !channelRef.current) return;
      // Suppress no-op duplicates (same value as last sent) to avoid scheduler churn.
      if (lastSentValueRef.current === typing) return;
      const now = Date.now();
      const elapsed = now - lastSendAtRef.current;
      if (elapsed >= TYPING_BROADCAST_INTERVAL_MS) {
        dispatchSend(typing);
        return;
      }
      // Within the rate-limit window: schedule a trailing send so the final state
      // (especially `false` after typing stops) is always delivered.
      if (trailingSendTimeoutRef.current) clearTimeout(trailingSendTimeoutRef.current);
      trailingSendTimeoutRef.current = setTimeout(() => {
        trailingSendTimeoutRef.current = null;
        // Re-read the latest value so we don't deliver a stale typing=true after the
        // user has already stopped.
        dispatchSend(isTypingRef.current);
      }, TYPING_BROADCAST_INTERVAL_MS - elapsed);
    },
    [matchId, currentUserId, dispatchSend],
  );

  useEffect(() => {
    if (!enabled) return;
    sendTyping(isTyping);
  }, [isTyping, enabled, sendTyping]);

  return { partnerTyping };
}
