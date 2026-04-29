import type { ReportReasonId } from "../safety/reportReasons";

export type PostDateOutboxQueueState =
  | "queued"
  | "waiting_for_network"
  | "sending"
  | "failed"
  | "sent"
  | "canceled";

export type PostDateSafetyReportPayload = {
  reason: ReportReasonId;
  details?: string | null;
  alsoBlock: boolean;
};

export type PostDateOutboxPayload =
  | {
      kind: "verdict";
      liked: boolean;
      report?: PostDateSafetyReportPayload | null;
    }
  | {
      kind: "report";
      report: PostDateSafetyReportPayload;
    };

export type PostDateOutboxItem = {
  id: string;
  userId: string;
  sessionId: string;
  eventId?: string | null;
  payload: PostDateOutboxPayload;
  state: PostDateOutboxQueueState;
  createdAtMs: number;
  updatedAtMs: number;
  attemptCount: number;
  lastError?: string;
  nextRetryAtMs?: number;
  lastResult?: PostDateOutboxResultPayload;
};

export type PostDateOutboxResultPayload = {
  success?: boolean;
  error?: string;
  code?: string;
  message?: string;
  mutual?: boolean;
  match_id?: string;
  persistent_match_created?: boolean | null;
  already_matched?: boolean;
  verdict_recorded?: boolean;
  awaiting_partner_verdict?: boolean;
  partner_verdict_recorded?: boolean;
  safety_report_recorded?: boolean;
  report_id?: string;
  idempotent?: boolean;
};

