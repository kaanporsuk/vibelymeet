import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const ReadyRedirect = () => {
  const navigate = useNavigate();
  const { readyId } = useParams<{ readyId: string }>();

  useEffect(() => {
    let cancelled = false;

    const redirect = async () => {
      if (!readyId) {
        navigate("/events", { replace: true });
        return;
      }

      const candidate = readyId.trim();
      if (candidate.length === 0) {
        navigate("/events", { replace: true });
        return;
      }

      // Canonical web destination is event lobby. Support legacy session-id links
      // by resolving session -> event first, then falling back to event-id input.
      const { data: session, error } = await supabase
        .from("video_sessions")
        .select("event_id")
        .eq("id", candidate)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        navigate("/events", { replace: true });
        return;
      }

      const eventId = session?.event_id ?? candidate;
      navigate(`/event/${encodeURIComponent(eventId)}/lobby`, { replace: true });
    };

    void redirect();

    return () => {
      cancelled = true;
    };
  }, [readyId, navigate]);

  return null;
};

export default ReadyRedirect;

