/**
 * Report user — canonical `submit_user_report` RPC (parity with web ReportWizard).
 */
import { supabase } from '@/lib/supabase';

import { REPORT_REASONS, type ReportReasonId } from '../../../shared/safety/reportReasons';
import { submitUserReportRpc } from '../../../shared/safety/submitUserReportRpc';

export { REPORT_REASONS, type ReportReasonId };

export async function submitReport(params: {
  reporterId: string;
  reportedId: string;
  reason: ReportReasonId;
  details?: string | null;
  alsoBlock: boolean;
}): Promise<void> {
  const result = await submitUserReportRpc(supabase, {
    reportedId: params.reportedId,
    reason: params.reason,
    details: params.details ?? null,
    alsoBlock: params.alsoBlock,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
}
