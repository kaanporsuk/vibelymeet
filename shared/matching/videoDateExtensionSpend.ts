/**
 * Client-side parsing + copy for spend_video_date_credit_extension (JSONB).
 * Spend remains authoritative on the server; this module is UX-only.
 */

export type VideoDateExtendOutcome =
  | { ok: true; minutesAdded: number; secondsAdded: number; dateExtraSeconds?: number }
  | { ok: false; userMessage: string; silent?: boolean };

export type ParsedExtensionSpend =
  | { success: true; addedSeconds?: number; dateExtraSeconds?: number; idempotent?: boolean }
  | { success: false; error: string };

/** Total allowed date-phase length after server-owned extensions (`video_sessions.date_extra_seconds`). */
export function effectiveDateDurationSeconds(
  baseDateSeconds: number,
  dateExtraSeconds: number | null | undefined,
): number {
  const extra =
    typeof dateExtraSeconds === "number" && Number.isFinite(dateExtraSeconds)
      ? Math.max(0, Math.floor(dateExtraSeconds))
      : 0;
  return baseDateSeconds + extra;
}

/** Remaining date-phase seconds from monotonic elapsed time since `date_started_at`; full effective budget if start missing. */
export function remainingDatePhaseSeconds(args: {
  dateStartedAtIso: string | null | undefined;
  baseDateSeconds: number;
  dateExtraSeconds: number | null | undefined;
  nowMs?: number;
}): number {
  const effective = effectiveDateDurationSeconds(args.baseDateSeconds, args.dateExtraSeconds);
  if (!args.dateStartedAtIso) return effective;
  const elapsed =
    ((args.nowMs ?? Date.now()) - new Date(args.dateStartedAtIso).getTime()) / 1000;
  return Math.max(0, Math.ceil(effective - elapsed));
}

export function parseSpendVideoDateCreditExtensionPayload(data: unknown): ParsedExtensionSpend {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: "invalid_response" };
  }
  const row = data as Record<string, unknown>;
  if (row.success === true) {
    return {
      success: true,
      addedSeconds: typeof row.added_seconds === "number" ? row.added_seconds : undefined,
      dateExtraSeconds: typeof row.date_extra_seconds === "number" ? row.date_extra_seconds : undefined,
      idempotent: row.idempotent === true,
    };
  }
  const err = typeof row.error === "string" ? row.error : "unknown";
  return { success: false, error: err };
}

export function userMessageForExtensionSpendFailure(error: string): string {
  switch (error) {
    case "rpc_transport":
    case "invalid_response":
    case "unknown":
      return "Couldn't add time. Try again.";
    case "insufficient_credits":
      return "Not enough credits to add time. Get credits to keep going.";
    case "not_in_date_phase":
    case "session_ended":
      return "Can't add time right now.";
    case "session_not_found":
    case "forbidden":
    case "unauthorized":
      return "Couldn't add time. Check you're still in this date.";
    case "invalid_credit_type":
      return "Couldn't add time. Try again.";
    default:
      return "Couldn't add time. Try again.";
  }
}
