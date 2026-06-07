export type VideoDateLifecycleRpcPayload = Record<string, unknown> | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

export function videoDateLifecycleRpcCode(
  payload: VideoDateLifecycleRpcPayload,
): string | null {
  if (!isRecord(payload)) return null;
  return (
    normalizeText(payload.code) ??
    normalizeText(payload.error_code) ??
    normalizeText(payload.error)
  );
}

export function videoDateLifecycleRpcIndicatesTerminalStop(
  payload: VideoDateLifecycleRpcPayload,
): boolean {
  if (!isRecord(payload)) return false;
  const code = videoDateLifecycleRpcCode(payload);
  return (
    booleanValue(payload.terminal) ||
    booleanValue(payload.session_ended) ||
    code === "session_ended" ||
    normalizeText(payload.state) === "ended" ||
    normalizeText(payload.phase) === "ended" ||
    typeof payload.ended_at === "string"
  );
}

export function videoDateLifecycleRpcIndicatesTerminalSurvey(
  payload: VideoDateLifecycleRpcPayload,
): boolean {
  if (!isRecord(payload)) return false;
  const code = videoDateLifecycleRpcCode(payload);
  return (
    normalizeText(payload.queue_status) === "in_survey" ||
    booleanValue(payload.survey_required) ||
    booleanValue(payload.session_ended) ||
    code === "session_ended"
  );
}

export function videoDateLifecycleRpcRetryable(
  payload: VideoDateLifecycleRpcPayload,
): boolean | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.retryable === "boolean") return payload.retryable;
  if (videoDateLifecycleRpcIndicatesTerminalStop(payload)) return false;
  return undefined;
}
