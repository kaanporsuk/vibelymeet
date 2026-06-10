import {
  normalizeServerPostDateNextSurface,
  type ServerPostDateNextSurface,
} from "./postDateContinuity";

export const POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS = 2_500;

export type PostDateVerdictUiState =
  | "idle"
  | "submitting"
  | "confirmed"
  | "awaiting_partner"
  | "retryable_failed";

export type PostDateVerdictState =
  | "awaiting_partner"
  | "resolved_mutual"
  | "resolved_not_mutual"
  | "safety_reported";

export type PostDateVerdictSurveyStep = "celebration" | "awaiting_partner" | "highlights";

export type PostDateVerdictConfirmationResult = {
  success: boolean;
  committed: boolean;
  sessionSeq: number | null;
  verdictState: PostDateVerdictState | null;
  nextSurface: ServerPostDateNextSurface | null;
  mutual: boolean;
  awaitingPartnerVerdict: boolean;
  partnerVerdictRecorded: boolean;
};

type VerdictBroadcastLike = {
  kind?: string | null;
  sessionSeq?: number | null;
  session_seq?: number | null;
  payload?: Record<string, unknown> | null;
};

export function isVideoDateVerdictConfirmEnabled(
  v2: { enabled?: boolean } | null | undefined,
): boolean {
  return v2?.enabled === true;
}

export function normalizePostDateVerdictConfirmationResult(
  result: unknown,
): PostDateVerdictConfirmationResult {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const verdictState = normalizeVerdictState(record.verdict_state ?? record.verdictState);
  const mutual = booleanValue(record.mutual);
  const awaitingPartnerVerdict = booleanValue(record.awaiting_partner_verdict ?? record.awaitingPartnerVerdict);
  return {
    success: record.success !== false && record.ok !== false,
    committed: booleanValue(record.committed),
    sessionSeq: numberValue(record.session_seq ?? record.sessionSeq),
    verdictState,
    nextSurface: normalizeServerPostDateNextSurface(record.next_surface ?? record.nextSurface),
    mutual,
    awaitingPartnerVerdict,
    partnerVerdictRecorded: booleanValue(record.partner_verdict_recorded ?? record.partnerVerdictRecorded),
  };
}

export function derivePostDateSurveyStepFromVerdict(
  result: unknown,
): PostDateVerdictSurveyStep {
  const normalized = normalizePostDateVerdictConfirmationResult(result);
  if (normalized.mutual || normalized.verdictState === "resolved_mutual") return "celebration";
  if (normalized.awaitingPartnerVerdict || normalized.verdictState === "awaiting_partner") {
    return "awaiting_partner";
  }
  return "highlights";
}

export function isConfirmingVerdictBroadcast(
  event: VerdictBroadcastLike | null | undefined,
  minSessionSeq: number | null | undefined,
): boolean {
  if (!event) return false;
  if (event.kind !== "post_date_verdict_recorded" && event.kind !== "post_date_verdict_resolved") {
    return false;
  }
  const sessionSeq = numberValue(event.sessionSeq ?? event.session_seq);
  const minSeq = numberValue(minSessionSeq);
  if (minSeq === null) return sessionSeq !== null;
  return sessionSeq !== null && sessionSeq >= minSeq;
}

export function isPostDateVerdictResultCommitted(result: unknown): boolean {
  return normalizePostDateVerdictConfirmationResult(result).committed;
}

export function confirmationResultFromVerdictBroadcast(
  event: VerdictBroadcastLike | null | undefined,
  minSessionSeq: number | null | undefined,
): Record<string, unknown> | null {
  if (!isConfirmingVerdictBroadcast(event, minSessionSeq)) return null;
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const mutual = booleanValue(payload.mutual);
  const awaitingPartnerVerdict = event?.kind === "post_date_verdict_recorded"
    ? true
    : booleanValue(payload.awaiting_partner_verdict ?? payload.awaitingPartnerVerdict);
  const verdictState: PostDateVerdictState = awaitingPartnerVerdict
    ? "awaiting_partner"
    : mutual
      ? "resolved_mutual"
      : "resolved_not_mutual";

  return {
    ...payload,
    success: true,
    committed: true,
    session_seq: numberValue(event?.sessionSeq ?? event?.session_seq),
    verdict_state: verdictState,
    awaiting_partner_verdict: awaitingPartnerVerdict,
    partner_verdict_recorded: booleanValue(payload.partner_verdict_recorded ?? payload.partnerVerdictRecorded) || !awaitingPartnerVerdict,
    mutual,
  };
}

function normalizeVerdictState(value: unknown): PostDateVerdictState | null {
  if (
    value === "awaiting_partner" ||
    value === "resolved_mutual" ||
    value === "resolved_not_mutual" ||
    value === "safety_reported"
  ) {
    return value;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
