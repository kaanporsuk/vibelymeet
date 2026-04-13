import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

/**
 * Web `/ready/:readyId` entry: parity with native standalone Ready Gate (`app/ready/[id].tsx`).
 * Validates session row, participation, not ended, and `in_ready_gate` before sending the user
 * to the event lobby (canonical web surface for Ready Gate UI). Invalid/stale links get a safe
 * fallback (events home or lobby) instead of blindly treating the param as an event id.
 */
const ReadyRedirect = () => {
  const navigate = useNavigate();
  const { readyId } = useParams<{ readyId: string }>();
  const { user } = useUserProfile();

  useEffect(() => {
    let cancelled = false;

    const redirect = async () => {
      if (!readyId?.trim()) {
        navigate("/events", { replace: true });
        return;
      }
      if (!user?.id) {
        return;
      }

      const candidate = readyId.trim();

      const { data: session, error } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, event_id, ended_at")
        .eq("id", candidate)
        .maybeSingle();

      if (cancelled) return;

      if (error || !session) {
        navigate("/events", { replace: true });
        return;
      }

      const isParticipant =
        session.participant_1_id === user.id || session.participant_2_id === user.id;
      if (!isParticipant) {
        navigate("/events", { replace: true });
        return;
      }

      if (session.ended_at) {
        if (session.event_id) {
          navigate(`/event/${encodeURIComponent(session.event_id)}/lobby`, { replace: true });
        } else {
          navigate("/home", { replace: true });
        }
        return;
      }

      if (!session.event_id) {
        navigate("/events", { replace: true });
        return;
      }

      const { data: reg } = await supabase
        .from("event_registrations")
        .select("queue_status")
        .eq("event_id", session.event_id)
        .eq("profile_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (reg?.queue_status !== "in_ready_gate") {
        navigate(`/event/${encodeURIComponent(session.event_id)}/lobby`, { replace: true });
        return;
      }

      navigate(`/event/${encodeURIComponent(session.event_id)}/lobby`, { replace: true });
    };

    void redirect();

    return () => {
      cancelled = true;
    };
  }, [readyId, navigate, user?.id]);

  return null;
};

export default ReadyRedirect;
