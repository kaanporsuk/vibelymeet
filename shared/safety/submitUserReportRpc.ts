import type { ReportReasonId } from "./reportReasons";

export type SubmitUserReportRpcResult =
  | { ok: true; reportId?: string }
  | { ok: false; error: string };

export type SubmitVideoDateSafetyReportRpcResult =
  | {
      ok: true;
      reportId?: string;
      ended: boolean;
      surveyRequired: boolean;
      idempotent: boolean;
    }
  | { ok: false; error: string };

/**
 * Canonical server-owned report path (`submit_user_report` RPC): validation, rate limit, optional block.
 */
export async function submitUserReportRpc(
  supabase: unknown,
  params: {
    reportedId: string;
    reason: ReportReasonId;
    details?: string | null;
    alsoBlock: boolean;
  }
): Promise<SubmitUserReportRpcResult> {
  const client = supabase as {
    rpc: (
      name: string,
      args?: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("submit_user_report", {
    p_reported_id: params.reportedId,
    p_reason: params.reason,
    p_details: params.details ?? null,
    p_also_block: params.alsoBlock,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as { success?: boolean; error?: string; report_id?: string } | null;
  if (row && row.success === false) {
    return { ok: false, error: row.error ?? "unknown" };
  }

  return { ok: true, reportId: row?.report_id };
}

/**
 * Video-date in-call report path. Uses the v4 command ledger, stores raw details
 * only in user_reports, and can end the session without leaking report reasons
 * through participant-visible session events.
 */
export async function submitVideoDateSafetyReportRpc(
  supabase: unknown,
  params: {
    sessionId: string;
    reason: ReportReasonId;
    details?: string | null;
    alsoBlock: boolean;
    endSession: boolean;
    idempotencyKey: string;
  }
): Promise<SubmitVideoDateSafetyReportRpcResult> {
  const client = supabase as {
    rpc: (
      name: string,
      args?: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("submit_video_date_safety_report_v2", {
    p_session_id: params.sessionId,
    p_reason: params.reason,
    p_details: params.details ?? null,
    p_also_block: params.alsoBlock,
    p_end_session: params.endSession,
    p_idempotency_key: params.idempotencyKey,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as {
    success?: boolean;
    error?: string;
    report_id?: string;
    ended?: boolean;
    survey_required?: boolean;
    idempotent?: boolean;
  } | null;
  if (row && row.success === false) {
    return { ok: false, error: row.error ?? "unknown" };
  }

  return {
    ok: true,
    reportId: row?.report_id,
    ended: row?.ended === true,
    surveyRequired: row?.survey_required === true,
    idempotent: row?.idempotent === true,
  };
}

/** Map post-date SafetyScreen category labels to canonical `ReportReasonId` values. */
export function mapPostDateSafetyCategoryToReasonId(category: string): ReportReasonId {
  const m: Record<string, ReportReasonId> = {
    "Inappropriate behavior": "inappropriate",
    "Fake photos": "fake",
    Harassment: "harassment",
    Spam: "spam",
    Other: "other",
  };
  return m[category] ?? "other";
}
