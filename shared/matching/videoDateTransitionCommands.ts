import { generateIdempotencyKey } from "./idempotentRpc";
import { buildVideoDateSignalIdempotencyKey } from "./videoDateSignalRetry";

export type VideoDatePhase3TransitionAction = "mark_ready" | "forfeit" | "continue_handshake";
export type VideoDatePhase3DeadlineAction = "handshake_auto_promote" | "date_timeout";
export type VideoDatePhase3CreditExtensionType = "extra_time" | "extended_vibe";
export type VideoDatePhase3SafetyAction = "report" | "end_report";

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

export function buildVideoDateMutualExtensionIdempotencyKey(
  sessionId: string,
  creditType: VideoDatePhase3CreditExtensionType,
  clientRequestId: string,
): string {
  return buildVideoDateSignalIdempotencyKey(sessionId, `phase6:extension_mutual:${creditType}:${clientRequestId}`);
}

export function buildVideoDateSafetyIdempotencyKey(
  sessionId: string,
  action: VideoDatePhase3SafetyAction,
  clientRequestId: string,
): string {
  return buildVideoDateSignalIdempotencyKey(sessionId, `phase3:safety:${action}:${clientRequestId}`);
}

export function buildVideoDateQueueDrainIdempotencyKey(
  eventId: string,
  clientRequestId: string,
): string {
  return buildVideoDateSignalIdempotencyKey(eventId, `phase3:drain_match_queue:${clientRequestId}`);
}

export function createVideoDateClientRequestId(): string {
  return generateIdempotencyKey();
}
