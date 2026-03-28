import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mirrors native `useTypingBroadcast` (apps/mobile/lib/chatApi.ts): broadcast when the
 * local user types, subscribe for partner typing on `chat-typing-${matchId}`.
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
          void channel.send({
            type: "broadcast",
            event: "typing",
            payload: { userId: currentUserId, typing: true },
          });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setPartnerTyping(false);
    };
  }, [matchId, currentUserId, enabled]);

  const sendTyping = useCallback(
    (typing: boolean) => {
      if (!matchId || !currentUserId || !channelRef.current) return;
      void channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: currentUserId, typing },
      });
    },
    [matchId, currentUserId]
  );

  useEffect(() => {
    if (!enabled) return;
    sendTyping(isTyping);
  }, [isTyping, enabled, sendTyping]);

  return { partnerTyping };
}
