/**
 * Report user — insert user_reports; optionally block. Parity with web ReportWizard.
 */
import { supabase } from '@/lib/supabase';

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'fake', label: 'Fake profile / catfish' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'vibe', label: 'Did not match vibe check' },
] as const;

export type ReportReasonId = (typeof REPORT_REASONS)[number]['id'];

export async function submitReport(params: {
  reporterId: string;
  reportedId: string;
  reason: ReportReasonId;
  details?: string | null;
  alsoBlock: boolean;
}): Promise<void> {
  const { error: reportError } = await supabase.from('user_reports').insert({
    reporter_id: params.reporterId,
    reported_id: params.reportedId,
    reason: params.reason,
    details: params.details || null,
    also_blocked: params.alsoBlock,
  });
  if (reportError) throw reportError;

  if (params.alsoBlock) {
    const { error: blockError } = await supabase.from('blocked_users').insert({
      blocker_id: params.reporterId,
      blocked_id: params.reportedId,
      reason: `Reported: ${params.reason}`,
    });
    if (blockError && blockError.code !== '23505') {
      throw blockError;
    }
  }
}
