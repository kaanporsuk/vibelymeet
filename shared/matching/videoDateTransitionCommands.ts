import { buildVideoDateSignalIdempotencyKey } from "./videoDateSignalRetry";

export type VideoDatePhase3TransitionAction = "mark_ready" | "forfeit" | "continue_handshake";

export function buildVideoDateTransitionIdempotencyKey(
  sessionId: string,
  action: VideoDatePhase3TransitionAction,
): string {
  return buildVideoDateSignalIdempotencyKey(sessionId, `phase3:${action}`);
}
