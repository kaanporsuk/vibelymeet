export type SessionUploadSummary = {
  enqueued: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  queued: number;
};

export function getSessionUploadSummary(input: {
  enqueued: number;
  succeeded: number;
  failed: number;
  failedInQueue: number;
  inFlight: number;
  queued: number;
}): SessionUploadSummary {
  return {
    enqueued: Math.max(0, input.enqueued),
    succeeded: Math.max(0, input.succeeded),
    failed: Math.max(Math.max(0, input.failed), Math.max(0, input.failedInQueue)),
    inFlight: Math.max(0, input.inFlight),
    queued: Math.max(0, input.queued),
  };
}
