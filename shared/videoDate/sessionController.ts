import {
  isVideoDateEntryPhase,
} from "../matching/videoDateEntryCompatibility";
import {
  videoSessionHasPostDateSurveyTruth,
} from "../matching/activeSession";
import {
  normalizeVideoDateReadyGateStatus,
  videoDateRouteTruthHasProviderRoom,
  videoDateRouteTruthIsEnded,
  videoDateRouteTruthReadyGateEligible,
} from "../matching/videoDateRouteDecision";
import { buildVideoDateSignalIdempotencyKey } from "../matching/videoDateSignalRetry";
import type { VideoDateNavigationIntents } from "./navigationIntents";
import type {
  VideoDateControllerCommand,
  VideoDateControllerCommandKind,
  VideoDateControllerEffects,
  VideoDateControllerInput,
  VideoDateControllerRouteDecision,
  VideoDateControllerRouteIntent,
  VideoDateControllerSessionSnapshot,
  VideoDateControllerViewState,
  VideoDateSessionControllerPhase,
} from "./types";

/**
 * Platform-agnostic Video Date session state machine.
 *
 * The controller owns client-side phase truth between server snapshots:
 * hydrate → ready_gate → preparing_entry → joining → entry → date → ending →
 * survey_required → done, with reconnecting / parked_remount as explicit
 * states and terminal-survey recovery as a transition available from every
 * non-terminal state.
 *
 * Server truth always wins: a session snapshot may move the controller to any
 * phase. Daily adapter events, broadcast events (seq-aware), timers, and route
 * intents move the client-side phases in between. The controller performs no
 * IO; it emits explicit commands for the platform adapter to execute.
 */

export type VideoDateSessionControllerOptions = {
  sessionId: string;
  profileId: string | null;
  /** Optional shared navigation-intents store; manual-exit / terminal transitions apply intents when present. */
  intents?: VideoDateNavigationIntents | null;
  now?: () => number;
};

type ReconnectReturnPhase = Extract<
  VideoDateSessionControllerPhase,
  "joining" | "entry" | "date"
>;

const CLIENT_PHASES: ReadonlySet<VideoDateSessionControllerPhase> = new Set([
  "preparing_entry",
  "joining",
  "entry",
  "date",
  "reconnecting",
  "parked_remount",
]);

const TERMINAL_PHASES: ReadonlySet<VideoDateSessionControllerPhase> = new Set([
  "survey_required",
  "done",
]);

function isReconnectReturnPhase(
  phase: VideoDateSessionControllerPhase,
): phase is ReconnectReturnPhase {
  return phase === "joining" || phase === "entry" || phase === "date";
}

export class VideoDateSessionController {
  readonly sessionId: string;
  readonly profileId: string | null;

  private readonly intents: VideoDateNavigationIntents | null;
  private phase: VideoDateSessionControllerPhase = "hydrate";
  private returnPhase: ReconnectReturnPhase = "joining";
  private seqCursor: number | null = null;
  private surveyRequired = false;
  private surveySubmitted = false;
  private endRequested = false;
  private manualExitRequested = false;
  private dailyJoined = false;
  private remoteSeenIssued = false;
  private lastSnapshot: VideoDateControllerSessionSnapshot | null = null;
  private inFlight = new Set<VideoDateControllerCommandKind>();

  constructor(options: VideoDateSessionControllerOptions) {
    this.sessionId = options.sessionId;
    this.profileId = options.profileId;
    this.intents = options.intents ?? null;
  }

  getPhase(): VideoDateSessionControllerPhase {
    return this.phase;
  }

  getView(): VideoDateControllerViewState {
    return {
      phase: this.phase,
      surveyRequired: this.surveyRequired,
      reconnecting: this.phase === "reconnecting",
      terminalSurveyRecovery: this.phase === "survey_required",
    };
  }

  getRoute(): VideoDateControllerRouteDecision {
    return this.routeForPhase();
  }

  apply(input: VideoDateControllerInput): VideoDateControllerEffects {
    const commands: VideoDateControllerCommand[] = [];

    switch (input.kind) {
      case "session_snapshot":
        this.applySnapshot(input.snapshot, commands);
        break;
      case "registration_snapshot":
        // Registration truth participates through the route decision; survey
        // continuity (`queue_status = in_survey`) pins survey recovery.
        if (
          input.registration?.queue_status === "in_survey" &&
          !this.surveySubmitted &&
          (input.registration.current_room_id == null ||
            input.registration.current_room_id === this.sessionId)
        ) {
          this.enterTerminalSurvey(commands);
        }
        break;
      case "broadcast":
        this.applyBroadcast(input.seq, input.phase ?? null, commands);
        break;
      case "daily":
        this.applyDaily(input.event.kind, commands);
        break;
      case "timer":
        this.applyTimer(input.event.kind, commands);
        break;
      case "route_intent":
        this.applyRouteIntent(input.intent.kind, commands, input.intent);
        break;
      case "command_result":
        this.applyCommandResult(input, commands);
        break;
    }

    return {
      state: this.phase,
      commands,
      route: this.routeForPhase(),
      view: this.getView(),
    };
  }

  private command(
    kind: VideoDateControllerCommandKind,
    commands: VideoDateControllerCommand[],
    options: { reason?: string; idempotencyAction?: string; dedupe?: boolean } = {},
  ) {
    const dedupe = options.dedupe ?? true;
    if (dedupe && this.inFlight.has(kind)) return;
    if (dedupe) this.inFlight.add(kind);
    commands.push({
      kind,
      sessionId: this.sessionId,
      reason: options.reason,
      idempotencyKey: options.idempotencyAction
        ? buildVideoDateSignalIdempotencyKey(
            this.sessionId,
            options.idempotencyAction,
          )
        : undefined,
    });
  }

  private setPhase(next: VideoDateSessionControllerPhase) {
    if (isReconnectReturnPhase(next)) this.returnPhase = next;
    this.phase = next;
  }

  private enterTerminalSurvey(commands: VideoDateControllerCommand[]) {
    if (this.phase === "done") return;
    if (this.phase !== "survey_required") {
      const hadLiveCall = this.dailyJoined || CLIENT_PHASES.has(this.phase);
      this.surveyRequired = true;
      this.setPhase("survey_required");
      this.intents?.markVideoDateRouteOwned(this.sessionId, this.profileId);
      if (hadLiveCall) {
        this.command("daily_leave", commands, {
          reason: "terminal_survey_hard_stop",
          dedupe: false,
        });
      }
      this.command("stop_daily_alive_heartbeat", commands, {
        reason: "terminal_survey_hard_stop",
        dedupe: false,
      });
      this.dailyJoined = false;
    }
  }

  private enterDone(commands: VideoDateControllerCommand[], reason: string) {
    if (this.phase === "done") return;
    if (this.dailyJoined || CLIENT_PHASES.has(this.phase)) {
      this.command("daily_leave", commands, { reason, dedupe: false });
      this.command("stop_daily_alive_heartbeat", commands, {
        reason,
        dedupe: false,
      });
      this.dailyJoined = false;
    }
    this.setPhase("done");
    this.intents?.clearDateEntryTransition(this.sessionId);
    this.intents?.clearVideoDateRouteOwnership(this.sessionId, this.profileId);
  }

  private applySnapshot(
    snapshot: VideoDateControllerSessionSnapshot | null,
    commands: VideoDateControllerCommand[],
  ) {
    if (!snapshot) return;
    this.lastSnapshot = snapshot;
    if (typeof snapshot.seq === "number" && Number.isFinite(snapshot.seq)) {
      this.seqCursor = Math.max(this.seqCursor ?? 0, snapshot.seq);
    }

    if (videoDateRouteTruthIsEnded(snapshot)) {
      const surveyTruth =
        snapshot.survey_required === false
          ? false
          : videoSessionHasPostDateSurveyTruth(snapshot);
      if (surveyTruth && !this.surveySubmitted) {
        this.enterTerminalSurvey(commands);
      } else {
        this.enterDone(commands, "session_snapshot_terminal");
      }
      return;
    }

    if (TERMINAL_PHASES.has(this.phase)) {
      // Terminal client truth holds until server truth says otherwise above;
      // a live snapshot for a session we already terminalized is stale-vs-
      // recovered ambiguity, resolved by an explicit refetch.
      this.command("refetch_snapshot", commands, {
        reason: "terminal_phase_live_snapshot",
      });
      return;
    }

    const state = snapshot.state ?? null;
    const dateActive = state === "date" || Boolean(snapshot.date_started_at);
    const entryActive =
      !dateActive &&
      (Boolean(snapshot.entry_started_at) ||
        isVideoDateEntryPhase(state?.toLowerCase() ?? null));
    const bothReady =
      normalizeVideoDateReadyGateStatus(snapshot.ready_gate_status) ===
      "both_ready";

    if (this.phase === "reconnecting" || this.phase === "parked_remount") {
      // Server phase progression still applies while the transport recovers;
      // remember where to return.
      if (dateActive) this.returnPhase = "date";
      else if (entryActive && this.dailyJoined) this.returnPhase = "entry";
      return;
    }

    if (dateActive) {
      this.setPhase("date");
      return;
    }

    if (entryActive) {
      this.setPhase(this.dailyJoined ? "entry" : "joining");
      if (!this.dailyJoined) {
        this.command("daily_join", commands, { reason: "entry_truth" });
      }
      return;
    }

    if (bothReady) {
      const hasRoom = videoDateRouteTruthHasProviderRoom(snapshot);
      this.setPhase(hasRoom && this.dailyJoined ? "entry" : "preparing_entry");
      if (this.phase === "preparing_entry") {
        this.intents?.markVideoDateEntryPipelineStarted(this.sessionId);
        this.command("prepare_entry", commands, {
          reason: hasRoom ? "both_ready_room_known" : "both_ready",
          idempotencyAction: "controller:prepare_entry",
        });
      }
      return;
    }

    if (videoDateRouteTruthReadyGateEligible(snapshot)) {
      this.setPhase("ready_gate");
      return;
    }

    if (this.phase === "hydrate") {
      // Not routeable: stay in hydrate; the route decision sends the surface
      // back to canonical surfaces.
      return;
    }
  }

  private applyBroadcast(
    seq: number | null,
    phase: string | null,
    commands: VideoDateControllerCommand[],
  ) {
    if (typeof seq === "number" && Number.isFinite(seq)) {
      if (this.seqCursor !== null && seq <= this.seqCursor) return; // stale
      if (this.seqCursor !== null && seq > this.seqCursor + 1) {
        this.command("refetch_snapshot", commands, {
          reason: "broadcast_seq_gap",
        });
        return;
      }
      this.seqCursor = seq;
    }
    // Broadcast alone never terminalizes or promotes; it always reconciles
    // against fetched truth.
    if (phase === "ended" || phase === "verdict" || phase === "date") {
      this.command("refetch_snapshot", commands, {
        reason: `broadcast_phase_${phase}`,
      });
    }
  }

  private applyDaily(
    kind: string,
    commands: VideoDateControllerCommand[],
  ) {
    switch (kind) {
      case "join_started":
        if (this.phase === "preparing_entry" || this.phase === "hydrate") {
          this.setPhase("joining");
        }
        break;
      case "joined":
        this.dailyJoined = true;
        this.inFlight.delete("daily_join");
        if (
          this.phase === "joining" ||
          this.phase === "preparing_entry" ||
          this.phase === "reconnecting" ||
          this.phase === "parked_remount"
        ) {
          this.setPhase(
            this.phase === "reconnecting" || this.phase === "parked_remount"
              ? this.returnPhase === "joining"
                ? "entry"
                : this.returnPhase
              : "entry",
          );
        }
        if (!TERMINAL_PHASES.has(this.phase)) {
          this.command("mark_daily_joined", commands, {
            reason: "daily_joined",
            dedupe: false,
          });
          this.command("start_daily_alive_heartbeat", commands, {
            reason: "daily_joined",
            dedupe: false,
          });
        }
        break;
      case "remote_media_playable":
        if (
          (this.phase === "entry" || this.phase === "date") &&
          !this.remoteSeenIssued
        ) {
          this.remoteSeenIssued = true;
          this.command("mark_remote_seen", commands, {
            reason: "remote_media_playable",
            dedupe: false,
          });
        }
        break;
      case "remote_participant_left":
        if (this.phase === "entry" || this.phase === "date") {
          this.setPhase("reconnecting");
        }
        break;
      case "transport_interrupted":
        if (isReconnectReturnPhase(this.phase)) {
          this.setPhase("reconnecting");
        }
        break;
      case "transport_recovered":
      case "remote_participant_joined":
        if (this.phase === "reconnecting") {
          this.setPhase(this.returnPhase);
        }
        break;
      case "local_left":
        this.dailyJoined = false;
        if (
          isReconnectReturnPhase(this.phase) &&
          !this.endRequested &&
          !this.manualExitRequested
        ) {
          this.setPhase("reconnecting");
        }
        break;
      case "parked_for_remount":
        if (CLIENT_PHASES.has(this.phase) && this.phase !== "parked_remount") {
          this.setPhase("parked_remount");
        }
        break;
      case "park_consumed":
        if (this.phase === "parked_remount") {
          this.dailyJoined = true;
          this.setPhase(this.returnPhase);
        }
        break;
      case "fatal_error":
        if (!TERMINAL_PHASES.has(this.phase)) {
          this.command("daily_leave", commands, {
            reason: "daily_fatal_error",
            dedupe: false,
          });
          this.dailyJoined = false;
          this.command("refetch_snapshot", commands, {
            reason: "daily_fatal_error",
          });
          if (isReconnectReturnPhase(this.phase)) this.setPhase("reconnecting");
        }
        break;
    }
  }

  private applyTimer(kind: string, commands: VideoDateControllerCommand[]) {
    switch (kind) {
      case "entry_deadline_elapsed":
        if (this.phase === "entry") {
          this.command("complete_entry", commands, {
            reason: "entry_deadline_elapsed",
            idempotencyAction: "phase3:continue_entry",
          });
        }
        break;
      case "date_deadline_elapsed":
        if (this.phase === "date") {
          this.endRequested = true;
          this.setPhase("ending");
          this.command("end_date", commands, {
            reason: "date_timeout",
            idempotencyAction: "phase3:date_timeout",
          });
        }
        break;
      case "reconnect_grace_elapsed":
        if (this.phase === "reconnecting") {
          this.endRequested = true;
          this.setPhase("ending");
          this.command("end_date", commands, {
            reason: "reconnect_grace_elapsed",
            idempotencyAction: "controller:end:reconnect_grace",
          });
        }
        break;
    }
  }

  private applyRouteIntent(
    kind: string,
    commands: VideoDateControllerCommand[],
    intent: VideoDateControllerRouteIntent,
  ) {
    switch (kind) {
      case "mount":
        if (
          intent.kind === "mount" &&
          intent.forceSurvey &&
          !this.surveySubmitted
        ) {
          this.command("refetch_snapshot", commands, {
            reason: "mount_force_survey",
          });
        }
        break;
      case "unmount":
        // Live remount parking is the adapter's call (heartbeat transfer);
        // the controller only records it via `parked_for_remount`.
        break;
      case "manual_exit_requested":
        this.manualExitRequested = true;
        this.intents?.suppressDateNavigationAfterManualExit(this.sessionId);
        this.enterDone(commands, "manual_exit");
        break;
      case "end_date_requested":
        if (!TERMINAL_PHASES.has(this.phase) && this.phase !== "ending") {
          this.endRequested = true;
          this.setPhase("ending");
          this.command("end_date", commands, {
            reason: "ended_from_client",
            idempotencyAction: "controller:end:client",
          });
        }
        break;
      case "survey_submitted":
        if (this.phase === "survey_required") {
          // Own-row confirmation is required before advancing past the survey.
          this.command("confirm_survey_own_row", commands, {
            reason: "survey_submitted",
          });
        }
        break;
      case "survey_own_row_confirmed":
        if (this.phase === "survey_required") {
          this.surveySubmitted = true;
          this.surveyRequired = false;
          this.enterDone(commands, "survey_confirmed");
        }
        break;
    }
  }

  private applyCommandResult(
    input: Extract<VideoDateControllerInput, { kind: "command_result" }>,
    commands: VideoDateControllerCommand[],
  ) {
    this.inFlight.delete(input.command);

    if (input.terminalSurvey && !this.surveySubmitted) {
      this.enterTerminalSurvey(commands);
      return;
    }

    if (!input.ok) {
      if (input.retryable === false) {
        this.command("refetch_snapshot", commands, {
          reason: `${input.command}_failed_terminal_check`,
        });
      }
      return;
    }

    switch (input.command) {
      case "prepare_entry":
        if (this.phase === "preparing_entry") {
          this.setPhase("joining");
          this.command("daily_join", commands, { reason: "entry_prepared" });
        }
        break;
      case "complete_entry":
        this.command("refetch_snapshot", commands, {
          reason: "complete_entry_result",
        });
        break;
      case "end_date":
        if (this.phase === "ending") {
          // Survey eligibility is server truth; reconcile rather than assume.
          this.command("refetch_snapshot", commands, {
            reason: "end_date_result",
          });
        }
        break;
      default:
        break;
    }
  }

  private routeForPhase(): VideoDateControllerRouteDecision {
    const phase = this.phase;
    if (phase === "survey_required") {
      return {
        target: "survey",
        navigate: true,
        forceSurvey: true,
        reason: "terminal_survey_required",
        suppressedBy: null,
        canonical: null,
      };
    }
    if (phase === "done") {
      return {
        target: this.surveySubmitted ? "lobby" : "ended",
        navigate: true,
        forceSurvey: false,
        reason: this.surveySubmitted ? "survey_completed" : "session_done",
        suppressedBy: null,
        canonical: null,
      };
    }
    if (phase === "ready_gate") {
      return {
        target: "ready",
        navigate: true,
        forceSurvey: false,
        reason: "ready_gate_active",
        suppressedBy: null,
        canonical: null,
      };
    }
    if (phase === "hydrate" && !this.lastSnapshot) {
      return {
        target: "lobby",
        navigate: false,
        forceSurvey: false,
        reason: "hydrate_pending",
        suppressedBy: null,
        canonical: null,
      };
    }
    return {
      target: "date",
      navigate: false,
      forceSurvey: false,
      reason: `client_phase_${phase}`,
      suppressedBy: null,
      canonical: null,
    };
  }
}

export function createVideoDateSessionController(
  options: VideoDateSessionControllerOptions,
): VideoDateSessionController {
  return new VideoDateSessionController(options);
}
