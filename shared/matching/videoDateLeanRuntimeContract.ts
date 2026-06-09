import {
  decideCanonicalVideoDateRoute,
  nativePathForCanonicalVideoDateRoute,
  webPathForCanonicalVideoDateRoute,
  type DecideVideoDateCanonicalRouteInput,
  type VideoDateCanonicalRouteDecision,
  type VideoDateCanonicalRouteTarget,
} from "./videoDateRouteDecision";
import type { VideoDateSnapshot } from "./videoDateSnapshot";

export type VideoDateLeanScreen =
  | "lobby"
  | "ready_gate"
  | "date"
  | "survey"
  | "done"
  | "blocked";

export type VideoDateLeanCommand =
  | "enter_lobby"
  | "get_deck"
  | "swipe"
  | "mark_ready"
  | "forfeit_ready_gate"
  | "prepare_date"
  | "join_date"
  | "end_date"
  | "submit_survey"
  | "return_to_lobby"
  | "retry";

export type VideoDateLeanOwner = "client" | "server" | "mixed";

export const VIDEO_DATE_LEAN_COMMAND_OWNERS: Record<VideoDateLeanCommand, VideoDateLeanOwner> = {
  enter_lobby: "server",
  get_deck: "server",
  swipe: "server",
  mark_ready: "server",
  forfeit_ready_gate: "server",
  prepare_date: "mixed",
  join_date: "mixed",
  end_date: "mixed",
  submit_survey: "server",
  return_to_lobby: "client",
  retry: "client",
};

export type VideoDateLeanRuntime = {
  ok: boolean;
  screen: VideoDateLeanScreen;
  reason: string;
  sessionId: string | null;
  eventId: string | null;
  webPath: string;
  nativePath: string;
  allowedCommands: VideoDateLeanCommand[];
  commandOwners: Record<VideoDateLeanCommand, VideoDateLeanOwner>;
  sessionState: string | null;
  participantState: string | null;
  canonicalDecision: VideoDateCanonicalRouteDecision;
  snapshotPhase: string | null;
  snapshotError: string | null;
};

export type ResolveVideoDateLeanRuntimeInput =
  DecideVideoDateCanonicalRouteInput & {
    snapshot?: VideoDateSnapshot | null;
  };

const LOBBY_COMMANDS: VideoDateLeanCommand[] = ["enter_lobby", "get_deck", "swipe"];
const READY_GATE_COMMANDS: VideoDateLeanCommand[] = ["mark_ready", "forfeit_ready_gate"];
const PREPARE_DATE_COMMANDS: VideoDateLeanCommand[] = ["prepare_date", "join_date", "end_date"];
const ACTIVE_DATE_COMMANDS: VideoDateLeanCommand[] = ["join_date", "end_date"];
const SURVEY_COMMANDS: VideoDateLeanCommand[] = ["submit_survey"];
const DONE_COMMANDS: VideoDateLeanCommand[] = ["return_to_lobby"];
const BLOCKED_COMMANDS: VideoDateLeanCommand[] = ["retry"];

export function leanScreenFromCanonicalRouteTarget(
  target: VideoDateCanonicalRouteTarget,
): VideoDateLeanScreen {
  switch (target) {
    case "ready_gate":
      return "ready_gate";
    case "date":
      return "date";
    case "survey":
      return "survey";
    case "chat":
    case "ended":
      return "done";
    case "home":
    case "lobby":
      return "lobby";
  }
}

export function allowedLeanCommandsForDecision(
  decision: VideoDateCanonicalRouteDecision,
): VideoDateLeanCommand[] {
  const screen = leanScreenFromCanonicalRouteTarget(decision.target);
  switch (screen) {
    case "lobby":
      return [...LOBBY_COMMANDS];
    case "ready_gate":
      return [...READY_GATE_COMMANDS];
    case "date":
      return decision.canAttemptDaily || decision.hasProviderRoom
        ? [...ACTIVE_DATE_COMMANDS]
        : [...PREPARE_DATE_COMMANDS];
    case "survey":
      return [...SURVEY_COMMANDS];
    case "done":
      return [...DONE_COMMANDS];
    case "blocked":
      return [...BLOCKED_COMMANDS];
  }
}

export function commandOwnersFor(
  commands: readonly VideoDateLeanCommand[],
): Record<VideoDateLeanCommand, VideoDateLeanOwner> {
  return commands.reduce((owners, command) => {
    owners[command] = VIDEO_DATE_LEAN_COMMAND_OWNERS[command];
    return owners;
  }, {} as Record<VideoDateLeanCommand, VideoDateLeanOwner>);
}

export function participantStateForLeanScreen(
  screen: VideoDateLeanScreen,
): string {
  switch (screen) {
    case "lobby":
      return "browsing";
    case "ready_gate":
      return "in_ready_gate";
    case "date":
      return "in_date_route";
    case "survey":
      return "in_survey";
    case "done":
      return "complete";
    case "blocked":
      return "blocked";
  }
}

export function resolveVideoDateLeanRuntime(
  input: ResolveVideoDateLeanRuntimeInput,
): VideoDateLeanRuntime {
  const canonicalDecision = decideCanonicalVideoDateRoute(input);
  const screen = leanScreenFromCanonicalRouteTarget(canonicalDecision.target);
  const allowedCommands = allowedLeanCommandsForDecision(canonicalDecision);
  const snapshot = input.snapshot ?? null;
  const snapshotOk = snapshot?.ok === true ? snapshot : null;
  const snapshotError = snapshot?.ok === false ? snapshot.error : null;
  const sessionState =
    input.truth?.state ??
    input.truth?.phase ??
    snapshotOk?.phase ??
    null;

  return {
    ok: true,
    screen,
    reason: canonicalDecision.reason,
    sessionId: canonicalDecision.sessionId,
    eventId: canonicalDecision.eventId,
    webPath: webPathForCanonicalVideoDateRoute(canonicalDecision),
    nativePath: nativePathForCanonicalVideoDateRoute(canonicalDecision),
    allowedCommands,
    commandOwners: commandOwnersFor(allowedCommands),
    sessionState,
    participantState: participantStateForLeanScreen(screen),
    canonicalDecision,
    snapshotPhase: snapshotOk?.phase ?? null,
    snapshotError,
  };
}
