import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { markVideoDateEntryPipelineStarted } from "@/lib/dateEntryTransitionLatch";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { fetchVideoDateSnapshot } from "@/lib/videoDateSnapshot";
import { persistReadyGateSuppressionV2 } from "@/lib/videoDateReadiness";
import ReadyGateOverlay from "@/components/lobby/ReadyGateOverlay";
import {
  adviseVideoDateSnapshotRecovery,
} from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE,
  READY_GATE_STALE_OR_ENDED_USER_MESSAGE,
} from "@shared/matching/videoSessionFlow";
import {
  canonicalVideoDateRouteLogDetail,
  decideCanonicalVideoDateRoute,
  webPathForCanonicalVideoDateRoute,
} from "@clientShared/matching/videoDateRouteDecision";

const READY_GATE_MANUAL_EXIT_SUPPRESS_MS = 45_000;

type ReadyRouteState =
  | { kind: "loading" }
  | { kind: "hosting"; eventId: string }
  | { kind: "redirecting" };

/**
 * Web `/ready/:readyId` is now a real standalone Ready Gate host.
 * It still performs the same canonical participant/session recovery before
 * rendering, but ready sessions no longer need to bounce through event lobby.
 */
const ReadyRedirect = () => {
  const navigate = useNavigate();
  const { readyId } = useParams<{ readyId: string }>();
  const { user } = useUserProfile();
  const snapshotV2 = useFeatureFlag("video_date.snapshot_v2");
  const readinessV2 = useFeatureFlag("video_date.readiness_v2");
  const toastShownForReadyKeyRef = useRef<string | null>(null);
  const [routeState, setRouteState] = useState<ReadyRouteState>({ kind: "loading" });

  useEffect(() => {
    toastShownForReadyKeyRef.current = null;
    setRouteState({ kind: "loading" });
  }, [readyId]);

  const notifyOnce = useCallback(
    (message: string) => {
      const key = `${readyId ?? ""}:${message.slice(0, 24)}`;
      if (toastShownForReadyKeyRef.current === key) return;
      toastShownForReadyKeyRef.current = key;
      toast.info(message, { duration: 3600 });
    },
    [readyId],
  );

  const navigateToEventLobby = useCallback(
    (eventId: string) => {
      navigate(`/event/${encodeURIComponent(eventId)}/lobby`, { replace: true });
    },
    [navigate],
  );

  const navigateToDate = useCallback(
    (sessionId: string) => {
      markVideoDateEntryPipelineStarted(sessionId);
      navigate(`/date/${encodeURIComponent(sessionId)}`, { replace: true });
    },
    [navigate],
  );

  const suppressReadyGateSessionAfterManualExit = useCallback(
    (sessionId: string) => {
      if (!readinessV2.enabled) return;
      void persistReadyGateSuppressionV2(sessionId, Date.now() + READY_GATE_MANUAL_EXIT_SUPPRESS_MS);
    },
    [readinessV2.enabled],
  );

  useEffect(() => {
    let cancelled = false;

    const resolveRoute = async () => {
      if (!readyId?.trim()) {
        setRouteState({ kind: "redirecting" });
        navigate("/events", { replace: true });
        return;
      }
      if (!user?.id) return;

      const candidate = readyId.trim();

      if (snapshotV2.enabled) {
        const snapshot = await fetchVideoDateSnapshot(candidate, { includeToken: false });
        if (cancelled) return;
        const recovery = adviseVideoDateSnapshotRecovery(snapshot, {
          expectedSessionId: candidate,
          platform: "web",
          surface: "ready_redirect",
        });
        const snapshotEventId = snapshot.ok ? snapshot.eventId : null;

        if (recovery.action === "go_date" || recovery.action === "go_survey") {
          setRouteState({ kind: "redirecting" });
          navigateToDate(recovery.sessionId);
          return;
        }

        if (recovery.action === "go_ready_gate") {
          setRouteState({ kind: "hosting", eventId: recovery.eventId });
          return;
        }

        if (recovery.action === "go_lobby") {
          if (recovery.reason === "ended") {
            notifyOnce(READY_GATE_STALE_OR_ENDED_USER_MESSAGE);
          }
          setRouteState({ kind: "redirecting" });
          navigateToEventLobby(snapshotEventId ?? recovery.eventId);
          return;
        }

        if (recovery.action === "go_home" && recovery.reason === "missing_event") {
          notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
          setRouteState({ kind: "redirecting" });
          navigate("/events", { replace: true });
          return;
        }

        if (recovery.action === "invalid") {
          notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
          setRouteState({ kind: "redirecting" });
          navigate("/events", { replace: true });
          return;
        }
      }

      const { data: session, error } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, participant_1_joined_at, participant_2_joined_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url")
        .eq("id", candidate)
        .maybeSingle();

      if (cancelled) return;

      if (error || !session) {
        notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
        setRouteState({ kind: "redirecting" });
        navigate("/events", { replace: true });
        return;
      }

      const isParticipant =
        session.participant_1_id === user.id || session.participant_2_id === user.id;
      if (!isParticipant) {
        notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
        setRouteState({ kind: "redirecting" });
        navigate("/events", { replace: true });
        return;
      }

      if (!session.event_id) {
        notifyOnce(READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE);
        setRouteState({ kind: "redirecting" });
        navigate("/events", { replace: true });
        return;
      }

      const { data: readyGateRegistration } = await supabase
        .from("event_registrations")
        .select("queue_status, current_room_id")
        .eq("event_id", session.event_id)
        .eq("profile_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const canonicalRoute = decideCanonicalVideoDateRoute({
        sessionId: candidate,
        eventId: session.event_id,
        truth: session,
        registration: {
          queue_status: readyGateRegistration?.queue_status ?? null,
          current_room_id: readyGateRegistration?.current_room_id ?? null,
          event_id: session.event_id,
        },
      });
      if (import.meta.env.DEV) {
        console.debug("[ReadyRedirect] canonical route decision", canonicalVideoDateRouteLogDetail(canonicalRoute, {
          sourceSurface: "ready_redirect",
          sourceAction: "standalone_ready_recovery",
        }));
      }
      if (canonicalRoute.target === "date" || canonicalRoute.target === "survey") {
        setRouteState({ kind: "redirecting" });
        navigateToDate(candidate);
        return;
      }

      if (canonicalRoute.target === "ready_gate") {
        setRouteState({ kind: "hosting", eventId: session.event_id });
        return;
      }

      notifyOnce(READY_GATE_STALE_OR_ENDED_USER_MESSAGE);
      setRouteState({ kind: "redirecting" });
      navigate(webPathForCanonicalVideoDateRoute(canonicalRoute), { replace: true });
    };

    void resolveRoute();

    return () => {
      cancelled = true;
    };
  }, [navigate, navigateToDate, navigateToEventLobby, notifyOnce, readyId, snapshotV2.enabled, user?.id]);

  if (routeState.kind === "hosting" && readyId?.trim()) {
    const sessionId = readyId.trim();
    return (
      <div className="min-h-screen bg-background">
        <ReadyGateOverlay
          sessionId={sessionId}
          eventId={routeState.eventId}
          onClose={() => navigateToEventLobby(routeState.eventId)}
          onNavigateToDate={(nextSessionId) => navigateToDate(nextSessionId)}
          onManualExitConfirmed={suppressReadyGateSessionAfterManualExit}
        />
      </div>
    );
  }

  if (routeState.kind === "redirecting") return null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
      <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-muted-foreground">Opening Ready Gate...</p>
    </div>
  );
};

export default ReadyRedirect;
