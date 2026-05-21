import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { markVideoDateEntryPipelineStarted } from "@/lib/dateEntryTransitionLatch";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { fetchVideoDateSnapshot } from "@/lib/videoDateSnapshot";
import { canAttemptDailyRoomFromVideoSessionTruth } from "@clientShared/matching/activeSession";
import {
  READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE,
  READY_GATE_STALE_OR_ENDED_USER_MESSAGE,
} from "@shared/matching/videoSessionFlow";

/**
 * Web `/ready/:readyId` entry: safe reconciliation fallback, not a standalone Ready Gate surface.
 * Snapshot v2 validates participation through the token-free Edge/Postgres path and recovers
 * the exact event lobby without minting Daily tokens. Legacy fallback still validates the
 * session row and registration state directly while the flag ramps.
 */
const ReadyRedirect = () => {
  const navigate = useNavigate();
  const { readyId } = useParams<{ readyId: string }>();
  const { user } = useUserProfile();
  const snapshotV2 = useFeatureFlag("video_date.snapshot_v2");
  const toastShownForReadyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    toastShownForReadyKeyRef.current = null;
  }, [readyId]);

  useEffect(() => {
    let cancelled = false;

    const notifyOnce = (message: string) => {
      const key = `${readyId ?? ""}:${message.slice(0, 24)}`;
      if (toastShownForReadyKeyRef.current === key) return;
      toastShownForReadyKeyRef.current = key;
      toast.info(message, { duration: 3600 });
    };

    const redirect = async () => {
      if (!readyId?.trim()) {
        navigate("/events", { replace: true });
        return;
      }
      if (!user?.id) {
        return;
      }

      const candidate = readyId.trim();

      if (snapshotV2.enabled) {
        const snapshot = await fetchVideoDateSnapshot(candidate, { includeToken: false });
        if (cancelled) return;
        if (snapshot.ok === true) {
          if ((snapshot.phase === "handshake" || snapshot.phase === "date") && snapshot.room?.url) {
            markVideoDateEntryPipelineStarted(candidate);
            navigate(`/date/${encodeURIComponent(candidate)}`, { replace: true });
            return;
          }

          if (!snapshot.eventId) {
            notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
            navigate("/events", { replace: true });
            return;
          }

          if (snapshot.phase === "ended" || snapshot.phase === "verdict") {
            notifyOnce(READY_GATE_STALE_OR_ENDED_USER_MESSAGE);
          }
          navigate(`/event/${encodeURIComponent(snapshot.eventId)}/lobby`, { replace: true });
          return;
        }

        if (
          snapshot.ok === false &&
          (
            snapshot.error === "not_participant" ||
            snapshot.error === "session_not_found" ||
            snapshot.error === "invalid_session_id"
          )
        ) {
          notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
          navigate("/events", { replace: true });
          return;
        }
      }

      const { data: session, error } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, event_id, ended_at, state, phase, handshake_started_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url")
        .eq("id", candidate)
        .maybeSingle();

      if (cancelled) return;

      if (error || !session) {
        notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
        navigate("/events", { replace: true });
        return;
      }

      const isParticipant =
        session.participant_1_id === user.id || session.participant_2_id === user.id;
      if (!isParticipant) {
        notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
        navigate("/events", { replace: true });
        return;
      }

      if (session.ended_at) {
        notifyOnce(READY_GATE_STALE_OR_ENDED_USER_MESSAGE);
        if (session.event_id) {
          navigate(`/event/${encodeURIComponent(session.event_id)}/lobby`, { replace: true });
        } else {
          navigate("/home", { replace: true });
        }
        return;
      }

      if (!session.event_id) {
        notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
        navigate("/events", { replace: true });
        return;
      }

      if (canAttemptDailyRoomFromVideoSessionTruth(session)) {
        markVideoDateEntryPipelineStarted(candidate);
        navigate(`/date/${encodeURIComponent(candidate)}`, { replace: true });
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
        notifyOnce(READY_GATE_STALE_OR_ENDED_USER_MESSAGE);
        navigate(`/event/${encodeURIComponent(session.event_id)}/lobby`, { replace: true });
        return;
      }

      navigate(`/event/${encodeURIComponent(session.event_id)}/lobby`, { replace: true });
    };

    void redirect();

    return () => {
      cancelled = true;
    };
  }, [readyId, navigate, snapshotV2.enabled, user?.id]);

  return null;
};

export default ReadyRedirect;
