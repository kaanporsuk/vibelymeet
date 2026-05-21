import { buildVideoDateSignalIdempotencyKey } from "./videoDateSignalRetry";

export type VideoDatePhase3TransitionAction = "mark_ready" | "forfeit" | "continue_handshake";
export type VideoDatePhase3DeadlineAction = "handshake_auto_promote" | "date_timeout";
export type VideoDatePhase3CreditExtensionType = "extra_time" | "extended_vibe";

export function buildVideoDateTransitionIdempotencyKey(
  sessionId: string,
  action: VideoDatePhase3TransitionAction | VideoDatePhase3DeadlineAction,
): string {
  return buildVideoDateSignalIdempotencyKey(sessionId, `phase3:${action}`);
}

export function buildVideoDateExtensionIdempotencyKey(
  sessionId: string,
  creditType: VideoDatePhase3CreditExtensionType,
  clientRequestId: string,
): string {
  return buildVideoDateSignalIdempotencyKey(sessionId, `phase3:extension:${creditType}:${clientRequestId}`);
}
