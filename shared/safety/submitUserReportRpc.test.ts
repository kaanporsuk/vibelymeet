import test from "node:test";
import assert from "node:assert/strict";
import { submitUserReportRpc, submitVideoDateSafetyReportRpc } from "./submitUserReportRpc";

test("video-date safety RPC preserves recorded-report failures for accurate client copy", async () => {
  const supabase = {
    rpc: async () => ({
      error: null,
      data: {
        success: false,
        error: "safety_end_transition_rejected",
        safety_report_recorded: true,
        report_id: "report-1",
        ended: false,
        survey_required: false,
        idempotent: false,
      },
    }),
  };

  const result = await submitVideoDateSafetyReportRpc(supabase, {
    sessionId: "session-1",
    reason: "harassment",
    details: null,
    alsoBlock: false,
    endSession: true,
    idempotencyKey: "safety:session-1:end_report:client-1",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "safety_end_transition_rejected",
    reportRecorded: true,
    reportId: "report-1",
    ended: false,
    surveyRequired: false,
    idempotent: false,
  });
});

test("legacy safety RPC keeps its original narrow failure contract", async () => {
  const supabase = {
    rpc: async () => ({
      error: null,
      data: {
        success: false,
        error: "rate_limited",
        safety_report_recorded: true,
        ended: true,
      },
    }),
  };

  const result = await submitUserReportRpc(supabase, {
    reportedId: "user-2",
    reason: "spam",
    details: null,
    alsoBlock: false,
  });

  assert.deepEqual(result, { ok: false, error: "rate_limited" });
});
