export const VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS = 3_000;
export const VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

export type VideoDateEntryHandoffStatus = "idle" | "preparing" | "slow" | "retrying" | "failed";

export type VideoDateEntryHandoffStatusCopy = {
  title: string;
  body: string;
};

export const VIDEO_DATE_ENTRY_HANDOFF_STATUS_COPY: Record<
  VideoDateEntryHandoffStatus,
  VideoDateEntryHandoffStatusCopy
> = {
  idle: {
    title: "Joining your date...",
    body: "This should only take a moment.",
  },
  preparing: {
    title: "Joining your date...",
    body: "This should only take a moment.",
  },
  slow: {
    title: "Holding your date...",
    body: "Still connecting. Thanks for staying with it.",
  },
  retrying: {
    title: "Retrying connection...",
    body: "Holding your date while video setup catches up.",
  },
  failed: {
    title: "Connection needs a retry",
    body: "We couldn't finish video setup. Please try again.",
  },
};

export type VideoDateEntryHandoffFailure = {
  code?: string;
  httpStatus?: number;
  retryable?: boolean;
};

const RETRYABLE_PREPARE_ENTRY_CODES = new Set([
  "READY_GATE_NOT_READY",
  "RPC_ERROR",
  "DAILY_RATE_LIMIT",
  "DAILY_PROVIDER_UNAVAILABLE",
  "DAILY_PROVIDER_ERROR",
]);

export function shouldRetryVideoDateEntryHandoffFailure(result: VideoDateEntryHandoffFailure): boolean {
  if (result.retryable === true) return true;
  if (typeof result.code === "string" && RETRYABLE_PREPARE_ENTRY_CODES.has(result.code)) return true;
  return typeof result.httpStatus === "number" && result.httpStatus >= 500;
}

export function getVideoDateEntryHandoffMaxAttempts(
  retryDelaysMs: readonly number[] = VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS,
): number {
  return retryDelaysMs.length + 1;
}

export function getVideoDateEntryHandoffStatusCopy(
  status: VideoDateEntryHandoffStatus,
  failureMessage?: string | null,
): VideoDateEntryHandoffStatusCopy {
  if (status === "failed" && failureMessage) {
    return {
      title: VIDEO_DATE_ENTRY_HANDOFF_STATUS_COPY.failed.title,
      body: failureMessage,
    };
  }
  return VIDEO_DATE_ENTRY_HANDOFF_STATUS_COPY[status];
}
