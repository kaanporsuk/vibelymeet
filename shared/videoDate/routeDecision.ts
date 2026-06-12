import {
  decideCanonicalVideoDateRoute,
  type DecideVideoDateCanonicalRouteInput,
  type VideoDateCanonicalRouteDecision,
} from "../matching/videoDateRouteDecision";
import { videoSessionHasPostDateSurveyTruth } from "../matching/activeSession";
import type { VideoDateNavigationIntents } from "./navigationIntents";
import type {
  VideoDateControllerRouteDecision,
  VideoDateRouteSuppression,
} from "./types";

/**
 * The single Video Date surface-route decision.
 *
 * Web previously re-derived this branching in four places with ad-hoc latch /
 * ownership reads (`SessionRouteHydration`, the `VideoDate` date guard,
 * `ReadyRedirect`, `EventLobby`). Each surface keeps its own navigation
 * side-effects, but the decision — including which navigation intents to mark
 * or clear — lives here.
 *
 * The function applies intent mutations (mark/clear) itself so consumers
 * cannot forget them; `appliedIntents` reports what changed for diagnostics.
 */

export type VideoDateRouteSurface =
  | "route_hydration"
  | "date_route"
  | "ready_redirect";

export type VideoDateSurfaceRouteInput = {
  surface: VideoDateRouteSurface;
  sessionId: string;
  profileId: string | null;
  intents: VideoDateNavigationIntents;
  /** Canonical decision inputs (session truth + registration + server next surface). */
  canonicalInput: Omit<DecideVideoDateCanonicalRouteInput, "sessionId">;
  /** True when the current route state already carries `forceSurvey`. */
  routeStateForceSurvey?: boolean;
  nowMs?: number;
};

export type VideoDateSurfaceRouteAppliedIntent =
  | "route_owned"
  | "entry_latch_cleared"
  | "route_ownership_cleared";

export type VideoDateSurfaceRouteDecision = VideoDateControllerRouteDecision & {
  appliedIntents: VideoDateSurfaceRouteAppliedIntent[];
};

function decision(
  base: Omit<VideoDateSurfaceRouteDecision, "appliedIntents" | "canonical"> & {
    canonical: VideoDateCanonicalRouteDecision | null;
  },
  appliedIntents: VideoDateSurfaceRouteAppliedIntent[],
): VideoDateSurfaceRouteDecision {
  return { ...base, appliedIntents };
}

export function decideVideoDateSurfaceRoute(
  input: VideoDateSurfaceRouteInput,
): VideoDateSurfaceRouteDecision {
  const { surface, sessionId, profileId, intents } = input;
  const nowMs = input.nowMs ?? Date.now();
  const canonical = decideCanonicalVideoDateRoute({
    ...input.canonicalInput,
    sessionId,
    nowMs,
  });
  const applied: VideoDateSurfaceRouteAppliedIntent[] = [];

  const ownRoute = () => {
    intents.markVideoDateRouteOwned(sessionId, profileId);
    applied.push("route_owned");
  };
  const clearLatch = () => {
    intents.clearDateEntryTransition(sessionId);
    applied.push("entry_latch_cleared");
  };
  const clearOwnership = () => {
    intents.clearVideoDateRouteOwnership(sessionId, profileId);
    applied.push("route_ownership_cleared");
  };

  const truth = input.canonicalInput.truth ?? null;
  const surveyTruth =
    canonical.target === "survey" ||
    (truth ? videoSessionHasPostDateSurveyTruth(truth) : false);

  // Terminal encounters: pending survey pins /date/:id as the survey owner;
  // terminal without survey truth releases the entry latch so canonical
  // surfaces stop suppressing redirects.
  if (canonical.target === "survey" || canonical.target === "ended") {
    if (surveyTruth && input.canonicalInput.userFeedbackSubmitted !== true) {
      ownRoute();
      const alreadyPinned =
        surface === "date_route" || input.routeStateForceSurvey === true;
      return decision(
        {
          target: "survey",
          navigate: !alreadyPinned,
          forceSurvey: true,
          reason: canonical.reason,
          suppressedBy: alreadyPinned ? "same_route" : null,
          canonical,
        },
        applied,
      );
    }
    clearLatch();
    return decision(
      {
        target: "ended",
        // The date-route surface owns its own terminal exit (verdict-checked
        // recovery flow); hydration-style surfaces simply stop bouncing.
        navigate: false,
        forceSurvey: false,
        reason: canonical.reason,
        suppressedBy: null,
        canonical,
      },
      applied,
    );
  }

  if (canonical.target === "date") {
    ownRoute();
    return decision(
      {
        target: "date",
        navigate: surface !== "date_route",
        forceSurvey: false,
        reason: canonical.reason,
        suppressedBy: surface === "date_route" ? "same_route" : null,
        canonical,
      },
      applied,
    );
  }

  // Not date-capable by truth. Suppression order preserved from the previous
  // owners: the hydration guard consulted the entry latch; the date guard
  // consulted route ownership; ReadyRedirect consulted route ownership before
  // hosting a Ready Gate.
  if (intents.isDateEntryTransitionActive(sessionId)) {
    ownRoute();
    return decision(
      {
        target: "date",
        navigate: surface === "ready_redirect",
        forceSurvey: false,
        reason: "date_entry_latch",
        suppressedBy: "entry_latch" satisfies VideoDateRouteSuppression,
        canonical,
      },
      applied,
    );
  }

  if (intents.isVideoDateRouteOwned(sessionId, profileId)) {
    return decision(
      {
        target: "date",
        navigate: surface === "ready_redirect",
        forceSurvey: false,
        reason: "date_route_ownership",
        suppressedBy: "route_ownership" satisfies VideoDateRouteSuppression,
        canonical,
      },
      applied,
    );
  }

  if (canonical.target === "ready_gate") {
    clearLatch();
    if (surface !== "ready_redirect") clearOwnership();
    return decision(
      {
        target: "ready",
        navigate: surface !== "ready_redirect",
        forceSurvey: false,
        reason: canonical.reason,
        suppressedBy: null,
        canonical,
      },
      applied,
    );
  }

  clearLatch();
  return decision(
    {
      target: "lobby",
      navigate: true,
      forceSurvey: false,
      reason: canonical.reason,
      suppressedBy: null,
      canonical,
    },
    applied,
  );
}
