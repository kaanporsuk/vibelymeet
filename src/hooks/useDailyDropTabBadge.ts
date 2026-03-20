import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/** After 18:00, show home quick-action when user has an unviewed active daily_drop (parity with mobile). */
const DROP_HOUR = 18;

export function useDailyDropTabBadge(userId: string | undefined | null): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userId) {
      setShow(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      if (new Date().getHours() < DROP_HOUR) {
        if (!cancelled) setShow(false);
        return;
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("daily_drops")
        .select("id, user_a_id, user_a_viewed, user_b_viewed, expires_at")
        .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
        .gt("expires_at", nowIso)
        .order("drop_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        setShow(false);
        return;
      }
      const isA = data.user_a_id === userId;
      const viewed = isA ? data.user_a_viewed : data.user_b_viewed;
      setShow(!viewed);
    };
    void check();
    const t = setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [userId]);

  return show;
}
